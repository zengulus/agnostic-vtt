import { createClient } from '@supabase/supabase-js';
import type { Action, DiscordStatus, ServerMessage } from '../shared/protocol.js';
import { useTable, notify } from './store.js';
import { demoState } from './store.js';
import { applyChanges } from '../shared/state.js';
import type { Asset, UploadedAsset } from '../shared/model.js';
const serverUrl = (import.meta.env.VITE_SERVER_URL || '').replace(/\/$/, '');
export const supabase =
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
    ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
    : null;
interface Session {
  token: string;
  id: string;
  name: string;
}
let session: Session | null = null,
  socket: WebSocket | null = null,
  reconnect: ReturnType<typeof setTimeout> | undefined,
  attempts = 0,
  stopped = false;
let config: { roomId: string; inviteCode?: string } | null = null;
const actionWaiters = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
export function sendAndWait(action: Action): Promise<void> {
  const id = send(action);
  if (!id) return Promise.reject(new Error('Connect to a live table first.'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      actionWaiters.delete(id);
      reject(new Error('No confirmation received. Check the macro library before trying again.'));
    }, 10000);
    actionWaiters.set(id, {
      resolve: () => {
        clearTimeout(timer);
        resolve();
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
  });
}
export async function configureDiscord(
  settings: { url?: string; enabled: boolean; mode: 'automatic' | 'manual' } | null,
) {
  const roomId = useTable.getState().room.id;
  const response = await authorizedFetch(`/api/campaigns/${roomId}/discord`, {
    method: settings ? 'PUT' : 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: settings ? JSON.stringify(settings) : undefined,
  });
  const discord = (await response.json()) as DiscordStatus;
  if (useTable.getState().room.id === roomId) useTable.getState().set({ discord });
}
export async function shareDiscord(rollId: string) {
  await authorizedFetch(`/api/campaigns/${useTable.getState().room.id}/discord/rolls/${rollId}`, {
    method: 'POST',
  });
}
window.addEventListener('offline', () => socket?.close());
window.addEventListener('online', () => {
  if (!stopped && config && session && useTable.getState().status === 'reconnecting') open();
});
export async function request<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(`${serverUrl}${path}`, {
    method: data ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The server could not complete this request.');
  return result as T;
}
export async function authorizedFetch(path: string, init: RequestInit = {}) {
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    if (data.session && session) session.token = data.session.access_token;
  }
  const response = await fetch(`${serverUrl}${path}`, {
    ...init,
    headers: { ...init.headers, ...(session ? { Authorization: `Bearer ${session.token}` } : {}) },
  });
  if (!response.ok) {
    let message = 'Request failed.';
    try {
      message = (await response.json()).error || message;
    } catch {}
    throw new Error(message);
  }
  return response;
}
export async function uploadImage(file: File, purpose: 'map' | 'token' = 'map') {
  if (file.size > 10 * 1024 * 1024) throw new Error('Upload images up to 10 MiB.');
  const room = useTable.getState().room;
  const response = await authorizedFetch(`/api/assets/${room.id}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Image-Name': encodeURIComponent(file.name),
      'X-Image-Purpose': purpose,
    },
    body: file,
  });
  return (await response.json()) as UploadedAsset & { asset: Asset };
}
export async function deleteImage(id: string) {
  await authorizedFetch(`/api/assets/${useTable.getState().room.id}/${id}`, { method: 'DELETE' });
}
export async function savedCampaigns() {
  if (!session) {
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      if (data.session)
        session = {
          token: data.session.access_token,
          id: data.session.user.id,
          name: String(data.session.user.user_metadata?.name || 'Adventurer'),
        };
    } else {
      try {
        session = JSON.parse(localStorage.getItem('aether-guest') || 'null');
      } catch {}
    }
  }
  if (!session) return [];
  return request<Array<{ id: string; name: string; role: 'gm' | 'player' }>>('/api/campaigns');
}
export function resumeCampaign(id: string) {
  const url = new URL(location.href);
  url.searchParams.set('room', id);
  url.searchParams.delete('invite');
  history.replaceState({}, '', url);
  connect(id);
  useTable.getState().set({ dialog: null });
}
export async function signIn(name: string, email?: string, password?: string, signUp = false) {
  if (supabase) {
    if (email && password) {
      const { data, error } = signUp
        ? await supabase.auth.signUp({
            email,
            password,
            options: {
              data: { name },
              emailRedirectTo: `${location.origin}${import.meta.env.BASE_URL}`,
            },
          })
        : await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.session) throw new Error('Check your email to confirm your account, then sign in.');
    }
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error('Sign in to open a table.');
    session = { id: data.session.user.id, name, token: data.session.access_token };
  } else {
    try {
      session = JSON.parse(localStorage.getItem('aether-guest') || 'null') as Session | null;
    } catch {
      session = null;
    }
    // Session validation is server-side, never trust the browser's stored identity.
    if (session) {
      try {
        await request('/api/metrics');
      } catch {
        session = null;
      }
    }
    if (!session) {
      session = await request<Session>('/api/guest', { name });
      localStorage.setItem('aether-guest', JSON.stringify(session));
    }
  }
}
export async function launch(
  name: string,
  campaignName: string,
  roomId?: string,
  inviteCode?: string,
  email?: string,
  password?: string,
  signUp = false,
) {
  await signIn(name, email, password, signUp);
  if (!roomId) {
    const created = await request<{ id: string; inviteCode: string }>('/api/campaigns', {
      name: campaignName,
    });
    roomId = created.id;
    inviteCode = created.inviteCode;
  }
  const url = new URL(location.href);
  url.searchParams.set('room', roomId);
  if (inviteCode) url.searchParams.set('invite', inviteCode);
  history.replaceState({}, '', url);
  connect(roomId, inviteCode);
  useTable.getState().set({ dialog: null });
}
export function send(action: Action) {
  if (socket?.readyState !== WebSocket.OPEN || useTable.getState().status !== 'live') {
    notify('Your table is reconnecting. Try again once the connection returns.');
    return null;
  }
  const actionId = crypto.randomUUID();
  socket.send(JSON.stringify({ ...action, v: 2, actionId }));
  return actionId;
}
export function connect(roomId: string, inviteCode?: string) {
  stopped = false;
  config = { roomId, inviteCode };
  attempts = 0;
  open();
}
function open() {
  if (!session || !config || stopped) return;
  if (reconnect) clearTimeout(reconnect);
  if (socket) {
    socket.onclose = null;
    socket.close();
  }
  useTable.getState().set({ status: attempts ? 'reconnecting' : 'connecting' });
  const endpoint = serverUrl
    ? `${serverUrl.replace(/^http/, 'ws')}/ws`
    : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  socket = new WebSocket(endpoint);
  const active = socket;
  const watchdog = setTimeout(() => {
    if (useTable.getState().status !== 'live') active.close();
  }, 12000);
  socket.onopen = async () => {
    try {
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        if (!data.session) throw new Error('Your session expired. Sign in again.');
        session!.token = data.session.access_token;
      }
      if (active.readyState === WebSocket.OPEN)
        active.send(
          JSON.stringify({
            v: 2,
            type: 'JOIN_ROOM',
            actionId: crypto.randomUUID(),
            roomId: config!.roomId,
            inviteCode: config!.inviteCode,
            token: session!.token,
          }),
        );
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Sign-in failed.');
      disconnect();
      useTable.getState().set({ dialog: 'launch' });
    }
  };
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data) as ServerMessage,
      store = useTable.getState();
    if (message.v !== 2) {
      notify('Your app version is out of date. Reload this page.');
      return;
    }
    if ((message.type === 'STATE_PATCH' || message.type === 'ERROR') && message.actionId) {
      const waiter = actionWaiters.get(message.actionId);
      if (waiter) {
        actionWaiters.delete(message.actionId);
        if (message.type === 'ERROR') waiter.reject(new Error(message.message));
        else waiter.resolve();
      }
    }
    switch (message.type) {
      case 'ROOM_SNAPSHOT':
        attempts = 0;
        clearTimeout(watchdog);
        store.set({
          room: message.state,
          self: message.self,
          presence: message.presence,
          status: 'live',
          inviteCode: message.inviteCode,
          previews: {},
          ...(store.room.id !== message.state.id
            ? {
                deliveries: {},
                discord: {
                  configured: false,
                  enabled: false,
                  mode: 'automatic' as const,
                  canManage: false,
                },
              }
            : {}),
          selected:
            store.room.id === message.state.id &&
            store.room.activeSceneId === message.state.activeSceneId &&
            store.selected &&
            message.state.scenes[message.state.activeSceneId].tokens[store.selected]
              ? store.selected
              : null,
          selectedIds:
            store.room.id === message.state.id &&
            store.room.activeSceneId === message.state.activeSceneId
              ? store.selectedIds.filter(
                  (id) => !!message.state.scenes[message.state.activeSceneId].tokens[id],
                )
              : [],
          history:
            message.self.role === 'gm' && store.room.id === message.state.id
              ? store.history
              : { canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' },
          members:
            message.self.role === 'gm' && store.room.id === message.state.id ? store.members : [],
          ownerId:
            message.self.role === 'gm' && store.room.id === message.state.id ? store.ownerId : null,
          fitNonce:
            store.fitNonce +
            (store.room.id !== message.state.id ||
            store.room.activeSceneId !== message.state.activeSceneId ||
            store.room.scenes[store.room.activeSceneId].width !==
              message.state.scenes[message.state.activeSceneId].width ||
            store.room.scenes[store.room.activeSceneId].height !==
              message.state.scenes[message.state.activeSceneId].height
              ? 1
              : 0),
        });
        break;
      case 'STATE_PATCH': {
        if (message.revision <= store.room.revision) return;
        if (message.revision !== store.room.revision + 1) {
          send({ type: 'STATE_RESYNC' });
          return;
        }
        const room = { ...applyChanges(store.room, message.changes), revision: message.revision },
          previews = { ...store.previews };
        room.revision = message.revision;
        let sceneChanged = false,
          dimensionsChanged = false;
        for (const change of message.changes) {
          switch (change.kind) {
            case 'token':
              delete previews[change.token.id];
              break;
            case 'token-delete':
              delete previews[change.tokenId];
              break;
            case 'scene':
              if (change.scene.id === room.activeSceneId) {
                const old = store.room.scenes[change.scene.id];
                dimensionsChanged =
                  !!old && (old.width !== change.scene.width || old.height !== change.scene.height);
              }
              break;
            case 'scene-active':
              sceneChanged = true;
              break;
            case 'roll':
              break;
            case 'chat':
              break;
          }
        }
        store.set({
          room,
          previews,
          selected:
            store.selected && room.scenes[room.activeSceneId].tokens[store.selected]
              ? store.selected
              : null,
          selectedIds: store.selectedIds.filter(
            (id) => !!room.scenes[room.activeSceneId].tokens[id],
          ),
          ...(dimensionsChanged ? { fitNonce: store.fitNonce + 1 } : {}),
          ...(sceneChanged
            ? {
                fitNonce: store.fitNonce + 1,
                selected: null,
                selectedIds: [],
                sceneTransition: Date.now(),
              }
            : {}),
        });
        break;
      }
      case 'TOKEN_MOVE_PREVIEW':
        if (message.sceneId === store.room.activeSceneId) {
          store.set({ previews: { ...store.previews, [message.tokenId]: message.position } });
          setTimeout(() => {
            const s = useTable.getState();
            if (s.previews[message.tokenId] === message.position) {
              const p = { ...s.previews };
              delete p[message.tokenId];
              s.set({ previews: p });
            }
          }, 1500);
        }
        break;
      case 'PRESENCE_UPDATE':
        store.set({ presence: message.presence });
        break;
      case 'HISTORY_STATUS':
        store.set({ history: message.history });
        break;
      case 'MEMBERS_UPDATE':
        store.set({ members: message.members, ownerId: message.ownerId });
        break;
      case 'DISCORD_STATUS':
        store.set({ discord: message.discord });
        break;
      case 'DISCORD_DELIVERY':
        store.set({
          deliveries: Object.fromEntries(
            [
              ...Object.entries(store.deliveries).filter(([id]) => id !== message.rollId),
              [message.rollId, { status: message.status, message: message.message }],
            ].slice(-100),
          ),
        });
        break;
      case 'REVOKED':
        disconnect();
        store.set({
          room: demoState,
          self: null,
          presence: [],
          selected: null,
          selectedIds: [],
          members: [],
          ownerId: null,
          discord: { configured: false, enabled: false, mode: 'automatic', canManage: false },
          deliveries: {},
          dialog: 'launch',
          error: message.message,
          presentation: null,
          rollQueue: [],
        });
        break;
      case 'TOKEN_MOVE_PREVIEW_BATCH':
        if (message.sceneId === store.room.activeSceneId) {
          const previews = { ...store.previews };
          for (const p of message.positions) previews[p.tokenId] = p.position;
          store.set({ previews });
          setTimeout(() => {
            const s = useTable.getState(),
              p = { ...s.previews };
            for (const x of message.positions) if (p[x.tokenId] === x.position) delete p[x.tokenId];
            s.set({ previews: p });
          }, 1500);
        }
        break;
      case 'DICE_ROLL_RESULT':
        if (store.presentation)
          store.set({ rollQueue: [...store.rollQueue, message.roll].slice(-10) });
        else store.set({ presentation: message.roll });
        break;
      case 'PING':
        store.set({
          pings: [
            ...store.pings.filter((p) => Date.now() - p.at < 2000),
            { ...message.position, at: Date.now() },
          ],
        });
        break;
      case 'SAVED':
        store.set({ room: { ...store.room, savedAt: message.savedAt } });
        break;
      case 'ERROR':
        notify(message.message);
        if (store.status !== 'live') {
          disconnect();
          store.set({ dialog: 'launch' });
        } else send({ type: 'STATE_RESYNC' });
        break;
    }
  };
  socket.onclose = () => {
    clearTimeout(watchdog);
    if (stopped) return;
    useTable.getState().set({ status: 'reconnecting', previews: {} });
    reconnect = setTimeout(
      open,
      Math.min(30000, 750 * 2 ** Math.min(attempts++, 5)) * (0.8 + Math.random() * 0.4),
    );
  };
  socket.onerror = () => {
    active.close();
  };
}
export function disconnect() {
  stopped = true;
  if (reconnect) clearTimeout(reconnect);
  if (socket) socket.close();
  useTable.getState().set({ status: 'offline' });
}
export function inviteUrl() {
  const s = useTable.getState();
  const url = new URL(location.href);
  url.searchParams.set('room', s.room.id);
  if (s.inviteCode) url.searchParams.set('invite', s.inviteCode);
  return url.toString();
}
