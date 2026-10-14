import { useEffect, useRef, useState } from 'react';
import type { Grid, Point, Scene } from '../../shared/model.js';
import { gridSchema } from '../../shared/model.js';
import { SceneRenderer } from '../rendering.js';
import { useTable } from '../store.js';

/** An isolated renderer: no room mutations or network messages until the parent form saves. */
export function GridPreview({
  scene,
  grid,
  onChange,
  disabled,
}: {
  scene: Scene;
  grid: Grid;
  onChange: (value: Partial<Grid>) => void;
  disabled: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    renderer = useRef(new SceneRenderer());
  const [mode, setMode] = useState<'origin' | 'size' | 'pan'>('origin'),
    [first, setFirst] = useState<Point | null>(null),
    [message, setMessage] = useState('');
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const drag = useRef<{ start: Point; grid: Grid; pan: Point } | null>(null);
  const roomId = useTable((s) => s.room.id),
    gm = useTable((s) => s.self?.role === 'gm');
  // Fit initially; zoom lets small map cells be calibrated precisely.
  const width = 560,
    height = 300,
    fit = Math.min(width / scene.width, height / scene.height),
    scale = fit * zoom;
  useEffect(() => {
    const el = canvas.current!,
      ctx = el.getContext('2d')!;
    let active = true;
    const parsed = gridSchema.safeParse(grid);
    if (!parsed.success) return;
    const draw = () => {
      if (!active) return;
      renderer.current.draw(ctx, {
        scene: { ...scene, grid: parsed.data },
        roomId,
        camera: { ...pan, zoom: scale },
        width,
        height,
        dpr: 1,
        gm,
        selected: [],
        previews: {},
        localDragging: new Set(),
        reducedMotion: true,
        pings: [],
        draft: null,
        tool: 'select',
        zoneShape: 'rectangle',
        fogShape: 'circle',
        fogMode: 'reveal',
        brushSize: 0,
        drawColor: '#fff',
        drawWidth: 1,
        measurementShape: 'distance',
        redraw: draw,
      });
      if (first) {
        ctx.fillStyle = '#ffdc82';
        ctx.beginPath();
        ctx.arc(first.x * scale + pan.x, first.y * scale + pan.y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    draw();
    return () => {
      active = false;
    };
  }, [scene, grid, roomId, gm, scale, first, pan]);
  const point = (e: React.PointerEvent<HTMLCanvasElement>, offset = pan) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: (((e.clientX - rect.left) * width) / rect.width - offset.x) / scale,
      y: (((e.clientY - rect.top) * height) / rect.height - offset.y) / scale,
    };
  };
  return (
    <div className="grid-calibration">
      <p className="field-note">
        Local preview ·{' '}
        {grid.type === 'hex'
          ? 'Pointy-top hex: cell size is the horizontal distance between neighbouring cell centres.'
          : 'Square: cell size is the distance between adjacent parallel grid lines.'}{' '}
        {mode === 'pan'
          ? 'Drag to inspect another part of the map; panning changes only this preview.'
          : mode === 'origin'
            ? 'Drag the preview to align the grid origin.'
            : first
              ? 'Click the second point one cell away.'
              : grid.type === 'hex'
                ? 'Click two neighbouring centres in the same horizontal row.'
                : 'Click two adjacent grid intersections along one row or column.'}
      </p>
      <div className="calibration-tools">
        <button
          type="button"
          disabled={disabled}
          aria-pressed={mode === 'origin'}
          onClick={() => {
            setMode('origin');
            setFirst(null);
          }}
        >
          Drag origin
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={mode === 'size'}
          onClick={() => {
            setMode('size');
            setFirst(null);
          }}
        >
          Two-click cell size
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={mode === 'pan'}
          onClick={() => {
            setMode('pan');
            setFirst(null);
          }}
        >
          Pan preview
        </button>
        <label>
          Preview zoom
          <input
            aria-label="Preview zoom"
            type="range"
            min={1}
            max={Math.max(5, Math.ceil(2 / fit))}
            step={0.25}
            value={zoom}
            disabled={disabled}
            onChange={(e) => {
              const next = Number(e.target.value),
                ratio = next / zoom;
              setPan((p) => ({
                x: width / 2 - (width / 2 - p.x) * ratio,
                y: height / 2 - (height / 2 - p.y) * ratio,
              }));
              setZoom(next);
              setFirst(null);
            }}
          />
        </label>
      </div>
      <canvas
        ref={canvas}
        width={width}
        height={height}
        aria-label="Local grid calibration preview"
        aria-disabled={disabled}
        onPointerDown={(e) => {
          if (disabled) return;
          const p = point(e);
          if (mode === 'size') {
            if (!first) setFirst(p);
            else {
              const size = Math.round(Math.hypot(p.x - first.x, p.y - first.y) * 100) / 100;
              if (size >= 16 && size <= 200) {
                onChange({ size });
                setMessage(`Cell size: ${size} pixels. Review, then Save grid.`);
              } else
                setMessage(
                  'Choose points between 16 and 200 map pixels apart. Adjust preview zoom if needed.',
                );
              setFirst(null);
            }
          } else {
            drag.current = { start: p, grid, pan };
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        }}
        onPointerMove={(e) => {
          if (disabled || !drag.current) return;
          const d = drag.current,
            p = point(e, d.pan);
          if (mode === 'pan') {
            setPan({
              x: d.pan.x + (p.x - d.start.x) * scale,
              y: d.pan.y + (p.y - d.start.y) * scale,
            });
            return;
          }
          onChange({
            offsetX: Math.max(-200, Math.min(200, Math.round(d.grid.offsetX + p.x - d.start.x))),
            offsetY: Math.max(-200, Math.min(200, Math.round(d.grid.offsetY + p.y - d.start.y))),
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      />
      {message && (
        <p role="status" className="field-note">
          {message}
        </p>
      )}
    </div>
  );
}
