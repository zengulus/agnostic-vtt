import { useEffect, useRef, useState } from 'react';
import {
  LocateFixed,
  Minus,
  Plus,
  RotateCw,
  Trash2,
  Copy,
  Pencil,
  Group,
  Ungroup,
  Save,
} from 'lucide-react';
import { useTable } from '../store.js';
import { launchDemo, liveAvailable, send, sendAndWait } from '../connection.js';
import {
  clampPoint,
  nudgePoint,
  screenToWorld,
  snapPoint,
  type Camera,
} from '../../shared/geometry.js';
import { canControl, type Point, type Token, type FogOperation } from '../../shared/model.js';
import { SceneRenderer, conePoints, type Draft } from '../rendering.js';
import { TokenResource } from './TokenResource.js';
import { ToolOptions } from './Workshop.js';
import { drawingsAlongBrush, zonesAlongBrush } from '../../shared/drawings.js';
interface Drag {
  kind: 'pan' | 'token' | 'measure' | 'zone' | 'fog' | 'draw' | 'select' | 'erase';
  start: Point;
  camera: Camera;
  token?: Token;
  tokens?: Token[];
  offset?: Point;
  lastSent: number;
  lastBrush: number;
  groupId: string;
  erased?: Set<string>;
  erasedZones?: Set<string>;
  erasePoint?: Point;
}
export function Tabletop() {
  const [compactControls, setCompactControls] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null),
    frame = useRef(0),
    dirty = useRef(true),
    dimensions = useRef({ w: 1, h: 1 }),
    drag = useRef<Drag | null>(null),
    space = useRef(false),
    nudging = useRef(false),
    draft = useRef<Draft | null>(null),
    renderer = useRef(new SceneRenderer()),
    pointers = useRef(new Map<number, Point>()),
    pinch = useRef<{ distance: number; world: Point; camera: Camera } | null>(null);
  const store = useTable(),
    scene = store.room.scenes[store.room.activeSceneId],
    selected = store.selected ? scene.tokens[store.selected] : undefined;
  const redraw = () => {
    dirty.current = true;
  };
  const clearDraft = () => {
    draft.current = null;
    drag.current = null;
    redraw();
  };
  function fog(operation: FogOperation, groupId?: string) {
    send({
      type: 'FOG_APPEND',
      sceneId: useTable.getState().room.activeSceneId,
      operation,
      ...(groupId ? { groupId } : {}),
    });
  }
  function eraseAlong(from: Point, to: Point, gesture: Drag) {
    const st = useTable.getState(),
      ctx = canvas.current!.getContext('2d')!;
    if (st.self?.role !== 'gm') return;
    ctx.save();
    const ids = drawingsAlongBrush(
      Object.values(st.room.scenes[st.room.activeSceneId].annotations || {}),
      from,
      to,
      st.eraserSize,
      (text, fontSize) => {
        ctx.font = `${fontSize}px Georgia`;
        return ctx.measureText(text).width;
      },
    );
    ctx.restore();
    for (const id of ids) gesture.erased!.add(id);
    for (const id of zonesAlongBrush(
      Object.values(st.room.scenes[st.room.activeSceneId].zones),
      from,
      to,
      st.eraserSize,
    ))
      gesture.erasedZones!.add(id);
    gesture.erasePoint = to;
    draft.current = {
      tool: 'erase',
      start: to,
      end: to,
      points: [],
      radius: st.eraserSize,
      erasedIds: [...gesture.erased!],
      erasedZoneIds: [...gesture.erasedZones!],
    };
    redraw();
  }
  function finishPolygon() {
    const d = draft.current,
      st = useTable.getState();
    if (!d) return;
    if (d.tool === 'measure') {
      d.end = d.points.at(-1) || d.start;
      d.completed = true;
      redraw();
      return;
    }
    if (d.points.length < 3) {
      st.set({ error: 'A polygon needs at least three points.' });
      return;
    }
    const xs = d.points.map((p) => p.x),
      ys = d.points.map((p) => p.y),
      x = Math.min(...xs),
      y = Math.min(...ys),
      width = Math.max(1, Math.max(...xs) - x),
      height = Math.max(1, Math.max(...ys) - y);
    if (d.tool === 'fog')
      fog({ id: crypto.randomUUID(), shape: 'polygon', mode: st.fogMode, x, y, points: d.points });
    else
      send({
        type: 'ZONE_UPDATE',
        sceneId: st.room.activeSceneId,
        zone: {
          id: crypto.randomUUID(),
          shape: 'polygon',
          x,
          y,
          width,
          height,
          points: d.points,
          label: 'Marked region',
          color: st.drawColor,
          opacity: 0.2,
          tags: [],
        },
      });
    clearDraft();
  }
  function deleteSelection() {
    const st = useTable.getState(),
      ids = st.selectedIds.length ? st.selectedIds : st.selected ? [st.selected] : [];
    if (!ids.length || st.self?.role !== 'gm') return;
    send({ type: 'TOKENS_DELETE', sceneId: st.room.activeSceneId, ids });
    st.set({ selected: null, selectedIds: [] });
  }
  function groupSelection(group: boolean) {
    const ids = store.selectedIds.length ? store.selectedIds : selected ? [selected.id] : [],
      groupId = group ? crypto.randomUUID() : undefined;
    send({
      type: 'TOKENS_UPDATE',
      sceneId: scene.id,
      tokens: ids.map((id) => ({ ...scene.tokens[id], groupId })),
    });
  }
  function duplicateSelection() {
    const st = useTable.getState(),
      sc = st.room.scenes[st.room.activeSceneId],
      ids = st.selectedIds.length ? st.selectedIds : st.selected ? [st.selected] : [],
      groupId = ids.length > 1 ? crypto.randomUUID() : undefined;
    if (st.self?.role !== 'gm' || !ids.length) return;
    send({
      type: 'TOKENS_UPDATE',
      sceneId: sc.id,
      tokens: ids.map((id) => ({
        ...sc.tokens[id],
        id: crypto.randomUUID(),
        groupId,
        name: `${sc.tokens[id].name.split(' · ')[0].slice(0, 43)} copy`,
        x: sc.tokens[id].x + sc.grid.size,
        y: sc.tokens[id].y + sc.grid.size,
      })),
    });
  }

  useEffect(() => {
    const element = canvas.current!;
    const fit = () => {
      const { w, h } = dimensions.current,
        s = useTable.getState().room.scenes[useTable.getState().room.activeSceneId];
      const zoom = Math.max(0.08, Math.min(3, (w - 70) / s.width, (h - 70) / s.height));
      useTable
        .getState()
        .set({ camera: { zoom, x: (w - s.width * zoom) / 2, y: (h - s.height * zoom) / 2 } });
    };
    const observer = new ResizeObserver((entries) => {
      const { width: w, height: h } = entries[0].contentRect;
      dimensions.current = { w, h };
      const dpr = Math.min(devicePixelRatio, 2);
      element.width = w * dpr;
      element.height = h * dpr;
      fit();
      redraw();
    });
    observer.observe(element);
    let previousFit = useTable.getState().fitNonce,
      previousTool = useTable.getState().tool;
    const unsubscribe = useTable.subscribe((s) => {
      if (s.fitNonce !== previousFit) {
        previousFit = s.fitNonce;
        fit();
        clearDraft();
      }
      if (s.tool !== previousTool) {
        previousTool = s.tool;
        clearDraft();
      }
      redraw();
    });
    const draw = () => {
      frame.current = requestAnimationFrame(draw);
      const s = useTable.getState(),
        animated = s.pings.some((p) => Date.now() - p.at < 2000);
      if (!dirty.current && !animated) return;
      dirty.current = false;
      const localDragging = new Set(drag.current?.tokens?.map((t) => t.id) || []);
      dirty.current = renderer.current.draw(element.getContext('2d')!, {
        scene: s.room.scenes[s.room.activeSceneId],
        roomId: s.room.id,
        camera: s.camera,
        width: dimensions.current.w,
        height: dimensions.current.h,
        dpr: Math.min(devicePixelRatio, 2),
        gm: s.self?.role === 'gm',
        selected: [...new Set([...s.selectedIds, ...(s.selected ? [s.selected] : [])])],
        previews: s.previews,
        localDragging,
        reducedMotion: s.reducedMotion,
        pings: s.pings,
        draft: draft.current,
        tool: s.tool,
        zoneShape: s.zoneShape,
        fogShape: s.fogShape,
        fogMode: s.fogMode,
        brushSize: s.brushSize,
        drawColor: s.drawColor,
        drawWidth: s.drawWidth,
        measurementShape: s.measurementShape,
        redraw,
      });
    };
    frame.current = requestAnimationFrame(draw);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = element.getBoundingClientRect(),
        p = { x: e.clientX - rect.left, y: e.clientY - rect.top },
        c = useTable.getState().camera,
        world = screenToWorld(p, c),
        zoom = Math.max(0.08, Math.min(3, c.zoom * Math.exp(-e.deltaY * 0.0015)));
      useTable
        .getState()
        .set({ camera: { zoom, x: p.x - world.x * zoom, y: p.y - world.y * zoom } });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    const down = (e: KeyboardEvent) => {
      const st = useTable.getState();
      if (
        e.isComposing ||
        st.dialog ||
        (e.target instanceof Element &&
          e.target.closest(
            'input,textarea,select,button,a[href],[contenteditable]:not([contenteditable="false"]),[role="button"]',
          ))
      )
        return;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (key === 'z' || key === 'y')) {
        e.preventDefault();
        if (st.self?.role === 'gm') send({ type: key === 'y' || e.shiftKey ? 'REDO' : 'UNDO' });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === 'd') {
        e.preventDefault();
        duplicateSelection();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (!st.self || !['live', 'demo'].includes(st.status)) return;
        const scene = st.room.scenes[st.room.activeSceneId];
        const tokens = [
          ...new Set([...st.selectedIds, ...(st.selected ? [st.selected] : [])]),
        ].flatMap((id) => (scene.tokens[id] ? [scene.tokens[id]] : []));
        if (!tokens.length || tokens.some((t) => !canControl(t, st.self!.id, st.self!.role)))
          return;
        e.preventDefault();
        if (nudging.current) return;
        nudging.current = true;
        const positions = tokens.map((t) => ({
          tokenId: t.id,
          position: clampPoint(nudgePoint(t, e.key, scene.grid), scene.width, scene.height, t.size),
        }));
        void sendAndWait({ type: 'TOKEN_MOVE_BATCH', sceneId: scene.id, positions })
          .catch((error) => useTable.getState().set({ error: error.message }))
          .finally(() => {
            nudging.current = false;
          });
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        space.current = true;
        return;
      }
      if (key === 'enter' && draft.current && !draft.current.completed) {
        e.preventDefault();
        finishPolygon();
        return;
      }
      if (key === 'escape') {
        clearDraft();
        st.set({ selected: null, selectedIds: [], tool: 'select' });
        return;
      }
      if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        deleteSelection();
        return;
      }
      const tools = {
        v: 'select',
        h: 'pan',
        m: 'measure',
        p: 'ping',
        z: 'zone',
        f: 'fog',
        d: 'draw',
        t: 'text',
        e: 'erase',
      } as const;
      if (key in tools) st.set({ tool: tools[key as keyof typeof tools] });
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') space.current = false;
    };
    const blur = () => {
      space.current = false;
      pointers.current.clear();
      pinch.current = null;
      clearDraft();
      useTable.getState().set({ previews: {} });
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      observer.disconnect();
      unsubscribe();
      cancelAnimationFrame(frame.current);
      element.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
  function pointer(e: React.PointerEvent): Point {
    const rect = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button === 2) return;
    e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    const st = useTable.getState(),
      s = st.room.scenes[st.room.activeSceneId],
      p = pointer(e),
      raw = screenToWorld(p, st.camera),
      world = clampPoint(
        st.tool === 'zone' && st.zoneSnap ? snapPoint(raw, { ...s.grid, snap: true }) : raw,
        s.width,
        s.height,
        0,
      );
    if (e.pointerType === 'touch') {
      pointers.current.set(e.pointerId, p);
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        pinch.current = {
          distance: Math.hypot(b.x - a.x, b.y - a.y),
          world: screenToWorld({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, st.camera),
          camera: st.camera,
        };
        drag.current = null;
        draft.current = null;
        st.set({ previews: {} });
        return;
      }
    }
    const base = {
      start: p,
      camera: st.camera,
      lastSent: 0,
      lastBrush: Date.now(),
      groupId: crypto.randomUUID(),
    };
    if (space.current || e.button === 1 || st.tool === 'pan') {
      drag.current = { ...base, kind: 'pan' };
      return;
    }
    if (st.status !== 'live' && st.status !== 'demo') {
      st.set({ dialog: 'launch' });
      return;
    }
    if (st.tool === 'ping' || e.shiftKey) {
      send({ type: 'PING', position: world });
      return;
    }
    if (
      (st.tool === 'zone' && st.zoneShape === 'polygon') ||
      (st.tool === 'fog' && st.fogShape === 'polygon') ||
      (st.tool === 'measure' && st.measurementShape === 'path')
    ) {
      if ((st.tool === 'zone' || st.tool === 'fog') && st.self?.role !== 'gm') return;
      if (!draft.current || draft.current.completed || draft.current.tool !== st.tool)
        draft.current = { tool: st.tool, start: world, end: world, points: [world] };
      else if (draft.current.points.length < 100) {
        draft.current.points.push(world);
        draft.current.end = world;
      }
      redraw();
      return;
    }
    if (st.tool === 'measure') {
      draft.current = { tool: 'measure', start: world, end: world, points: [world] };
      drag.current = { ...base, kind: 'measure' };
      redraw();
      return;
    }
    if (['zone', 'fog', 'draw', 'text', 'erase'].includes(st.tool) && st.self?.role !== 'gm')
      return;
    if (st.tool === 'erase') {
      const gesture: Drag = {
        ...base,
        kind: 'erase',
        erased: new Set(),
        erasedZones: new Set(),
        erasePoint: world,
      };
      drag.current = gesture;
      eraseAlong(world, world, gesture);
      return;
    }
    if (st.tool === 'text') {
      send({
        type: 'ANNOTATION_UPDATE',
        sceneId: s.id,
        annotation: {
          id: crypto.randomUUID(),
          kind: 'text',
          points: [world],
          text: st.annotationText,
          color: st.drawColor,
          width: st.drawWidth,
          visibility: st.annotationVisibility,
        },
      });
      return;
    }
    if (st.tool === 'zone' || st.tool === 'fog' || st.tool === 'draw') {
      draft.current = { tool: st.tool, start: world, end: world, points: [world] };
      drag.current = { ...base, kind: st.tool };
      if (st.tool === 'fog' && st.fogShape === 'circle')
        fog(
          {
            id: crypto.randomUUID(),
            shape: 'circle',
            mode: st.fogMode,
            ...world,
            radius: st.brushSize,
          },
          base.groupId,
        );
      redraw();
      return;
    }
    const token = Object.values(s.tokens)
      .reverse()
      .find((t) => {
        const pos = st.previews[t.id] || t;
        return Math.hypot(pos.x - world.x, pos.y - world.y) < t.size / 2;
      });
    if (!token && (e.ctrlKey || e.metaKey)) {
      draft.current = { tool: 'select', start: world, end: world, points: [world] };
      drag.current = { ...base, kind: 'select' };
      return;
    }
    let ids = token ? [token.id] : [];
    if (token && token.groupId && !e.ctrlKey && !e.metaKey)
      ids = Object.values(s.tokens)
        .filter((t) => t.groupId === token.groupId)
        .map((t) => t.id);
    if (token && (e.ctrlKey || e.metaKey)) {
      ids = st.selectedIds.includes(token.id)
        ? st.selectedIds.filter((id) => id !== token.id)
        : [...st.selectedIds, token.id];
      ids = ids.slice(0, 50);
      st.set({ selected: ids.at(-1) || null, selectedIds: ids });
      return;
    }
    if (token && st.selectedIds.includes(token.id)) ids = st.selectedIds;
    ids = ids.slice(0, 50);
    st.set({ selected: token?.id || null, selectedIds: ids });
    if (token && st.self) {
      const tokens = ids
        .map((id) => s.tokens[id])
        .filter((t) => canControl(t, st.self!.id, st.self!.role));
      if (tokens.length === ids.length)
        drag.current = {
          ...base,
          kind: 'token',
          token,
          tokens,
          offset: { x: world.x - token.x, y: world.y - token.y },
        };
    }
  }
  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const st = useTable.getState(),
      s = st.room.scenes[st.room.activeSceneId],
      p = pointer(e),
      raw = screenToWorld(p, st.camera),
      world = clampPoint(
        st.tool === 'zone' && st.zoneSnap ? snapPoint(raw, { ...s.grid, snap: true }) : raw,
        s.width,
        s.height,
        0,
      );
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()],
        base = pinch.current,
        zoom = Math.max(
          0.08,
          Math.min(
            3,
            (base.camera.zoom * Math.hypot(b.x - a.x, b.y - a.y)) / Math.max(1, base.distance),
          ),
        );
      st.set({
        camera: {
          zoom,
          x: (a.x + b.x) / 2 - base.world.x * zoom,
          y: (a.y + b.y) / 2 - base.world.y * zoom,
        },
      });
      return;
    }
    const d = drag.current;
    if (!d) {
      if (st.tool === 'erase' && st.self?.role === 'gm') {
        draft.current = {
          tool: 'erase',
          start: world,
          end: world,
          points: [],
          radius: st.eraserSize,
        };
        redraw();
        return;
      }
      if (draft.current && !draft.current.completed) {
        draft.current.end = world;
        redraw();
      }
      return;
    }
    if (d.kind === 'pan') {
      st.set({
        camera: { ...d.camera, x: d.camera.x + p.x - d.start.x, y: d.camera.y + p.y - d.start.y },
      });
      return;
    }
    if (d.kind === 'erase') {
      eraseAlong(d.erasePoint!, world, d);
      return;
    }
    if (draft.current) {
      draft.current.end = world;
      if (
        d.kind === 'draw' &&
        draft.current.points.length < 500 &&
        Math.hypot(
          world.x - draft.current.points.at(-1)!.x,
          world.y - draft.current.points.at(-1)!.y,
        ) > 2
      )
        draft.current.points.push(world);
      redraw();
    }
    if (d.kind === 'fog' && st.fogShape === 'circle' && Date.now() - d.lastBrush > 140) {
      fog(
        {
          id: crypto.randomUUID(),
          shape: 'circle',
          mode: st.fogMode,
          ...world,
          radius: st.brushSize,
        },
        d.groupId,
      );
      d.lastBrush = Date.now();
    }
    if (d.kind === 'token' && d.token && d.tokens) {
      const dx = world.x - d.offset!.x - d.token.x,
        dy = world.y - d.offset!.y - d.token.y,
        positions = d.tokens.map((t) => ({
          tokenId: t.id,
          position: clampPoint({ x: t.x + dx, y: t.y + dy }, s.width, s.height, t.size),
        }));
      st.set({
        previews: {
          ...st.previews,
          ...Object.fromEntries(positions.map((p) => [p.tokenId, p.position])),
        },
      });
      if (Date.now() - d.lastSent > 50) {
        if (positions.length === 1)
          send({ type: 'TOKEN_MOVE_PREVIEW', sceneId: s.id, ...positions[0] });
        else send({ type: 'TOKEN_MOVE_PREVIEW_BATCH', sceneId: s.id, positions });
        d.lastSent = Date.now();
      }
    }
  }
  function onUp(e: React.PointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(e.pointerId);
    if (pinch.current) {
      pinch.current = null;
      drag.current = null;
      return;
    }
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const st = useTable.getState(),
      s = st.room.scenes[st.room.activeSceneId],
      shape = draft.current;
    if (d.kind === 'erase') {
      eraseAlong(
        d.erasePoint!,
        clampPoint(screenToWorld(pointer(e), st.camera), s.width, s.height, 0),
        d,
      );
      if ((d.erased!.size || d.erasedZones!.size) && st.self?.role === 'gm')
        send({
          type: 'OBJECTS_DELETE',
          sceneId: s.id,
          annotationIds: [...d.erased!],
          zoneIds: [...d.erasedZones!],
        });
      draft.current = null;
      redraw();
      if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
      return;
    }
    if (d.kind === 'token' && d.tokens) {
      const positions = d.tokens.map((t) => ({
        tokenId: t.id,
        position: snapPoint(st.previews[t.id] || t, s.grid),
      }));
      st.set({
        previews: {
          ...st.previews,
          ...Object.fromEntries(positions.map((p) => [p.tokenId, p.position])),
        },
      });
      if (positions.length === 1)
        send({ type: 'TOKEN_MOVE_COMMIT', sceneId: s.id, ...positions[0] });
      else send({ type: 'TOKEN_MOVE_BATCH', sceneId: s.id, positions });
    }
    if (shape) {
      const a = shape.start,
        b = shape.end,
        x = Math.min(a.x, b.x),
        y = Math.min(a.y, b.y),
        width = Math.max(1, Math.abs(b.x - a.x)),
        height = Math.max(1, Math.abs(b.y - a.y));
      if (d.kind === 'select') {
        const ids = Object.values(s.tokens)
          .filter((t) => t.x >= x && t.x <= x + width && t.y >= y && t.y <= y + height)
          .map((t) => t.id)
          .slice(0, 50);
        st.set({ selected: ids.at(-1) || null, selectedIds: ids });
      }
      if (d.kind === 'zone' && Math.hypot(b.x - a.x, b.y - a.y) > 10) {
        const points =
            st.zoneShape === 'cone'
              ? conePoints(a, b)
              : st.zoneShape === 'line'
                ? [a, b]
                : undefined,
          r = Math.hypot(b.x - a.x, b.y - a.y);
        send({
          type: 'ZONE_UPDATE',
          sceneId: s.id,
          zone: {
            id: crypto.randomUUID(),
            shape: st.zoneShape,
            x: st.zoneShape === 'circle' ? a.x - r : x,
            y: st.zoneShape === 'circle' ? a.y - r : y,
            width: st.zoneShape === 'circle' ? r * 2 : width,
            height: st.zoneShape === 'circle' ? r * 2 : height,
            points,
            label: 'Marked region',
            color: st.drawColor,
            opacity: 0.2,
            tags: [],
          },
        });
      }
      if (d.kind === 'fog' && st.fogShape === 'rectangle')
        fog({ id: crypto.randomUUID(), shape: 'rectangle', mode: st.fogMode, x, y, width, height });
      if (d.kind === 'draw')
        send({
          type: 'ANNOTATION_UPDATE',
          sceneId: s.id,
          annotation: {
            id: crypto.randomUUID(),
            kind: 'stroke',
            points: shape.points,
            text: '',
            color: st.drawColor,
            width: st.drawWidth,
            visibility: st.annotationVisibility,
          },
        });
      if (d.kind !== 'measure') draft.current = null;
      else shape.completed = true;
      redraw();
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  }
  const zoomBy = (factor: number) => {
    const c = store.camera,
      { w, h } = dimensions.current,
      p = screenToWorld({ x: w / 2, y: h / 2 }, c),
      zoom = Math.max(0.08, Math.min(3, c.zoom * factor));
    store.set({ camera: { zoom, x: w / 2 - p.x * zoom, y: h / 2 - p.y * zoom } });
  };
  return (
    <div className={`tabletop tool-${store.tool}`}>
      <canvas
        ref={canvas}
        tabIndex={0}
        aria-label="Interactive tabletop: drag tokens, scroll to zoom, hold Space to pan"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => {
          if (!drag.current && draft.current?.tool === 'erase') {
            draft.current = null;
            redraw();
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
          draft.current = null;
          pointers.current.clear();
          pinch.current = null;
          store.set({ previews: {} });
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (selected && store.self?.role === 'gm') store.set({ dialog: 'token' });
        }}
      />
      <div className="scene-heading">
        <h1>{scene.name}</h1>
        <span className="scene-meta sr-only">
          {scene.width} × {scene.height} <i />{' '}
          {scene.grid.enabled
            ? scene.grid.type === 'hex'
              ? 'Hex grid'
              : 'Square grid'
            : 'Gridless'}{' '}
          <i /> {Object.keys(scene.tokens).length} tokens
        </span>
      </div>
      {!store.self && (
        <div className="table-welcome">
          <h2>The next chapter.</h2>
          <button className="primary" aria-label="Open a demo table" onClick={() => launchDemo()}>
            Demo
          </button>
          <button
            className="subtle-button welcome-login"
            disabled={!liveAvailable}
            title={!liveAvailable ? 'Live play is not configured yet.' : undefined}
            onClick={() => store.set({ dialog: 'launch' })}
          >
            Log in
          </button>
          <button
            className="subtle-button"
            aria-label="Try the player demo"
            onClick={() => launchDemo('player')}
          >
            Player demo
          </button>
          <small>Demo needs no account.</small>
        </div>
      )}
      {selected && (
        <div className={`selection-toolbar ${compactControls ? 'controls-open' : ''}`}>
          <span className="selected-token-status" role="status">
            Selected: {selected.name.split(' · ')[0]} · {Math.round(selected.x)},{' '}
            {Math.round(selected.y)} ·{' '}
            {store.self && canControl(selected, store.self.id, store.self.role)
              ? scene.grid.type === 'hex' && scene.grid.enabled && scene.grid.snap
                ? 'Arrow keys move to neighbouring hex centres'
                : 'Drag or use arrow keys to move'
              : 'View only'}
            {selected.resource && (
              <small className="compact-resource-status">
                {selected.resource.label || 'Resource'}: {selected.resource.value} /{' '}
                {selected.resource.max}
              </small>
            )}
          </span>
          <button
            className="compact-control-toggle"
            aria-expanded={compactControls}
            onClick={() => setCompactControls(!compactControls)}
          >
            {compactControls ? 'Hide controls' : 'Character controls'}
          </button>
          <div className="selection-controls">
            <span className="token-dot" style={{ background: selected.color }} />
            <strong>
              {store.selectedIds.length > 1
                ? `${store.selectedIds.length} tokens`
                : selected.name.split(' · ')[0]}
            </strong>
            {store.selectedIds.length <= 1 && (
              <TokenResource key={scene.id + selected.id} token={selected} sceneId={scene.id} />
            )}
            {store.self?.role === 'gm' && (
              <>
                <button
                  title="Edit token"
                  aria-label="Edit token"
                  onClick={() => store.set({ dialog: 'token' })}
                >
                  <Pencil size={15} />
                </button>
                <button
                  title="Rotate token"
                  aria-label="Rotate token"
                  onClick={() =>
                    send({
                      type: 'TOKEN_UPDATE',
                      sceneId: scene.id,
                      token: { ...selected, rotation: (selected.rotation + 45) % 360 },
                    })
                  }
                >
                  <RotateCw size={15} />
                </button>
                <button
                  title="Duplicate token"
                  aria-label="Duplicate token"
                  onClick={duplicateSelection}
                >
                  <Copy size={15} />
                </button>
                <button title="Delete token" aria-label="Delete token" onClick={deleteSelection}>
                  <Trash2 size={15} />
                </button>
                <button
                  aria-label="Save selected token template"
                  title="Save reusable token"
                  onClick={() =>
                    send({ type: 'LIBRARY_SAVE', token: { ...selected, id: crypto.randomUUID() } })
                  }
                >
                  <Save size={15} />
                </button>
                {store.selectedIds.length > 1 && (
                  <button aria-label="Group selected tokens" onClick={() => groupSelection(true)}>
                    <Group size={15} />
                  </button>
                )}
                {selected.groupId && (
                  <button
                    aria-label="Ungroup selected tokens"
                    onClick={() => groupSelection(false)}
                  >
                    <Ungroup size={15} />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
      <ToolOptions finishPolygon={finishPolygon} clearDraft={clearDraft} />
      <div className="zoom-controls">
        <button aria-label="Zoom out" onClick={() => zoomBy(0.8)}>
          <Minus size={15} />
        </button>
        <span>{Math.round(store.camera.zoom * 100)}%</span>
        <button aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
          <Plus size={15} />
        </button>
        <i />
        <button
          aria-label="Fit map to screen"
          onClick={() => store.set({ fitNonce: store.fitNonce + 1 })}
        >
          <LocateFixed size={17} />
        </button>
      </div>
    </div>
  );
}
