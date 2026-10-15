import { demoAction, startDemo } from './demo.js';
import { authClient, commitAuthSession, isolatedAuthClient } from './auth.js';
import {
  serializeClientAction,
  type Action,
  type DiscordStatus,
  type ServerMessage,
} from '../shared/protocol.js';
import { useTable, notify, presentRoll } from './store.js';
import { demoState } from './store.js';
import { applyChanges } from '../shared/state.js';
import type { Asset, UploadedAsset } from '../shared/model.js';
const serverUrl = (import.meta.env.VITE_SERVER_URL || '').replace(/\/$/, '');
export const supabase = !!(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
);
export const liveAvailable = import.meta.env.DEV || (!!serverUrl && supabase);
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
let config: { roomId: string; inviteCode?: string; role?: 'gm' | 'player' } | null = null;
// An abandoned launch must never commit credentials, navigation, or table state.
let navigationGeneration = 0;
let pendingLaunch: { controller: AbortController; restoreDemo: boolean } | null = null;
export function cancelLaunch() {
  navigationGeneration++;
  const pending = pendingLaunch;
  pendingLaunch = null;
  pending?.controller.abort();
  if (pending?.restoreDemo && useTable.getState().status === 'offline')
    useTable.getState().set({ status: 'demo' });
}
useTable.subscribe((state, previous) => {
  if (previous.dialog === 'launch' && state.dialog !== 'launch') cancelLaunch();
});
window.addEventListener('popstate', cancelLaunch);
window.addEventListener('pagehide', cancelLaunch);
function assertCurrent(generation: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (generation !== navigationGeneration)
    throw new DOMException('The table launch was cancelled.', 'AbortError');
}
const durableActions = new Set<string>();
const actionWaiters = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
function rejectPendingActions(message: string) {
  for (const waiter of actionWaiters.values()) waiter.reject(new Error(message));
  actionWaiters.clear();
}
export function sendAndWait(action: Action): Promise<void> {
  if (useTable.getState().status === 'demo') {
    try {
      demoAction(action);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }
  const id = send(action);
  if (!id)
    return Promise.reject(new Error(useTable.getState().error || 'Connect to a live table first.'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      actionWaiters.delete(id);
      reject(new Error('No confirmation received. Check the table before trying again.'));
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
  const response = await authorizedFetch(path, {
    method: data ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await response.json();
  return result as T;
}
export async function authorizedFetch(path: string, init: RequestInit = {}) {
  const listingCampaigns = path === '/api/campaigns' && (init.method || 'GET') === 'GET';
  if (useTable.getState().status === 'demo' && !listingCampaigns)
    throw new Error('This feature needs a live campaign. The demo stays in this tab.');
  return fetchWithSession(path, init, session);
}
async function fetchWithSession(path: string, init: RequestInit, identity: Session | null) {
  const generation = navigationGeneration;
  init.signal?.throwIfAborted();
  if (supabase) {
    const { data } = await authClient().auth.getSession();
    assertCurrent(generation, init.signal || undefined);
    if (data.session && identity) {
      if (data.session.user.id !== identity.id)
        throw new Error('Your account changed. Sign in again to open this table.');
      identity.token = data.session.access_token;
    }
  }
  const headers = new Headers(init.headers);
  if (identity) headers.set('Authorization', `Bearer ${identity.token}`);
  const response = await fetch(`${serverUrl}${path}`, {
    ...init,
    headers,
  });
  init.signal?.throwIfAborted();
  if (!response.ok) {
    let message = 'Request failed.';
    try {
      message = (await response.json()).error || message;
    } catch {}
    init.signal?.throwIfAborted();
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
export async function currentAccount() {
  if (!liveAvailable || !supabase) return null;
  const generation = navigationGeneration;
  const { data, error } = await authClient().auth.getSession();
  if (generation !== navigationGeneration) return null;
  if (error) throw error;
  if (!data.session) {
    session = null;
    return null;
  }
  const user = data.session.user;
  session = {
    token: data.session.access_token,
    id: user.id,
    name: String(user.user_metadata?.name || user.email?.split('@')[0] || 'Adventurer').slice(
      0,
      32,
    ),
  };
  return { name: session.name, email: user.email || '' };
}
export async function signOut() {
  cancelLaunch();
  const generation = navigationGeneration;
  if (supabase) {
    const { error } = await authClient().auth.signOut();
    assertCurrent(generation);
    if (error) throw error;
  }
  session = null;
  localStorage.removeItem('aether-guest');
  launchDemo();
  disconnect();
  useTable.getState().set({ self: null, canGM: false, presence: [], dialog: 'launch' });
}
export async function savedCampaigns() {
  if (!liveAvailable) return [];
  const generation = navigationGeneration;
  if (!session) {
    if (supabase) {
      const { data } = await authClient().auth.getSession();
      if (generation !== navigationGeneration) return [];
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
export function resumeCampaign(id: string, role?: 'gm' | 'player') {
  cancelLaunch();
  if (useTable.getState().status === 'demo') disconnect();
  const url = new URL(location.href);
  url.searchParams.set('room', id);
  url.searchParams.delete('invite');
  history.replaceState({}, '', url);
  connect(id, undefined, role);
  useTable.getState().set({ dialog: null });
}
async function authenticate(
  name: string,
  email: string | undefined,
  password: string | undefined,
  signUp: boolean,
  generation: number,
  signal?: AbortSignal,
): Promise<Session> {
  if (supabase) {
    if (email && password) {
      const confirmationUrl = new URL(import.meta.env.BASE_URL, location.origin);
      const params = new URLSearchParams(location.search);
      for (const key of ['room', 'invite']) {
        const value = params.get(key);
        if (value) confirmationUrl.searchParams.set(key, value);
      }
      // The SDK saves and broadcasts before signIn resolves. Keep those effects
      // in an isolated client until this intent is still current at commit time.
      const isolated = isolatedAuthClient();
      try {
        const { data, error } = signUp
          ? await isolated.auth.signUp({
              email,
              password,
              options: {
                data: { name },
                emailRedirectTo: confirmationUrl.toString(),
              },
            })
          : await isolated.auth.signInWithPassword({ email, password });
        assertCurrent(generation, signal);
        if (error) throw error;
        if (!data.session)
          throw new Error('Check your email to confirm your account, then sign in.');
        commitAuthSession(data.session);
      } finally {
        void isolated.auth.dispose();
      }
    }
    const { data } = await authClient().auth.getSession();
    assertCurrent(generation, signal);
    if (!data.session) throw new Error('Sign in to open a table.');
    return {
      id: data.session.user.id,
      name: String(data.session.user.user_metadata?.name || name).slice(0, 32),
      token: data.session.access_token,
    };
  }
  let identity: Session | null = null;
  try {
    identity = JSON.parse(localStorage.getItem('aether-guest') || 'null') as Session | null;
  } catch {
    /* Recover from a damaged guest session. */
  }
  // Session validation is server-side, never trust the browser's stored identity.
  if (identity) {
    try {
      await fetchWithSession('/api/metrics', { signal }, identity);
    } catch {
      assertCurrent(generation, signal);
      identity = null;
    }
    assertCurrent(generation, signal);
  }
  if (!identity) {
    const response = await fetchWithSession(
      '/api/guest',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
        signal,
      },
      null,
    );
    assertCurrent(generation, signal);
    identity = (await response.json()) as Session;
    assertCurrent(generation, signal);
  }
  return identity;
}
function rememberSession(identity: Session) {
  session = identity;
  if (!supabase) localStorage.setItem('aether-guest', JSON.stringify(identity));
}
export async function signIn(name: string, email?: string, password?: string, signUp = false) {
  cancelLaunch();
  const generation = navigationGeneration;
  const identity = await authenticate(name, email, password, signUp, generation);
  assertCurrent(generation);
  rememberSession(identity);
}
export async function launch(
  name: string,
  campaignName: string,
  roomId?: string,
  inviteCode?: string,
  email?: string,
  password?: string,
  signUp = false,
  role?: 'gm' | 'player',
) {
  cancelLaunch();
  const generation = navigationGeneration;
  const attempt = {
    controller: new AbortController(),
    restoreDemo: useTable.getState().status === 'demo',
  };
  pendingLaunch = attempt;
  const initialUrl = location.href;
  const check = () => {
    assertCurrent(generation, attempt.controller.signal);
    if (location.href !== initialUrl) {
      cancelLaunch();
      assertCurrent(generation);
    }
  };
  if (attempt.restoreDemo) useTable.getState().set({ status: 'offline' });
  let committing = false;
  try {
    const identity = await authenticate(
      name,
      email,
      password,
      signUp,
      generation,
      attempt.controller.signal,
    );
    check();
    // Preserve valid credentials before creation so a server-committed campaign remains recoverable.
    rememberSession(identity);
    if (!roomId) {
      const response = await fetchWithSession(
        '/api/campaigns',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: campaignName }),
          signal: attempt.controller.signal,
        },
        identity,
      );
      check();
      const created = (await response.json()) as { id: string; inviteCode: string };
      check();
      roomId = created.id;
      inviteCode = created.inviteCode;
    }
    const url = new URL(location.href);
    url.searchParams.set('room', roomId);
    if (inviteCode) url.searchParams.set('invite', inviteCode);
    else url.searchParams.delete('invite');
    committing = true;
    pendingLaunch = null;
    history.replaceState({}, '', url);
    connect(roomId, inviteCode, role);
    useTable.getState().set({ dialog: null });
  } catch (error) {
    // Cancellation includes rejected requests that ignore AbortSignal or finish late.
    if (!committing && pendingLaunch !== attempt) return;
    pendingLaunch = null;
    if (attempt.restoreDemo) useTable.getState().set({ status: 'demo' });
    throw error;
  }
}
export function send(action: Action) {
  if (useTable.getState().status === 'demo') {
    try {
      return demoAction(action);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Demo action failed.');
      return null;
    }
  }
  if (socket?.readyState !== WebSocket.OPEN || useTable.getState().status !== 'live') {
    notify('Your table is reconnecting. Try again once the connection returns.');
    return null;
  }
  const actionId = crypto.randomUUID();
  try {
    socket.send(serializeClientAction(action, actionId));
    if (
      ![
        'JOIN_ROOM',
        'STATE_RESYNC',
        'SESSION_ROLE',
        'PING',
        'TOKEN_MOVE_PREVIEW',
        'TOKEN_MOVE_PREVIEW_BATCH',
      ].includes(action.type)
    ) {
      durableActions.add(actionId);
      useTable.getState().set({ pendingDurableActions: durableActions.size });
    }
    return actionId;
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Could not send this action.');
    return null;
  }
}
export function connect(roomId: string, inviteCode?: string, role?: 'gm' | 'player') {
  cancelLaunch();
  rejectPendingActions('The campaign changed before this action was confirmed.');
  stopped = false;
  config = { roomId, inviteCode, role };
  attempts = 0;
  open();
}
function open() {
  if (!session || !config || stopped) return;
  const activeSession = session,
    activeConfig = config;
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
    if (socket === active && useTable.getState().status !== 'live') active.close();
  }, 12000);
  socket.onopen = async () => {
    try {
      if (supabase) {
        const { data } = await authClient().auth.getSession();
        if (!data.session) throw new Error('Your session expired. Sign in again.');
        if (socket !== active || stopped) return;
        if (data.session.user.id !== activeSession.id)
          throw new Error('Your account changed. Sign in again to open this table.');
        activeSession.token = data.session.access_token;
      }
      if (socket === active && !stopped && active.readyState === WebSocket.OPEN)
        active.send(
          JSON.stringify({
            v: 2,
            type: 'JOIN_ROOM',
            actionId: crypto.randomUUID(),
            roomId: activeConfig.roomId,
            inviteCode: activeConfig.inviteCode,
            role: activeConfig.role,
            token: activeSession.token,
          }),
        );
    } catch (error) {
      if (socket !== active || stopped) return;
      notify(error instanceof Error ? error.message : 'Sign-in failed.');
      disconnect();
      useTable.getState().set({ dialog: 'launch' });
    }
  };
  socket.onmessage = (event) => {
    if (socket !== active || stopped) return;
    const message = JSON.parse(event.data) as ServerMessage,
      store = useTable.getState();
    if (message.v !== 2) {
      notify('Your app version is out of date. Reload this page.');
      return;
    }
    if ((message.type === 'STATE_PATCH' || message.type === 'ERROR') && message.actionId) {
      durableActions.delete(message.actionId);
      store.set({ pendingDurableActions: durableActions.size });
      const waiter = actionWaiters.get(message.actionId);
      if (waiter) {
        actionWaiters.delete(message.actionId);
        if (message.type === 'ERROR') waiter.reject(new Error(message.message));
        else waiter.resolve();
      }
    }
    switch (message.type) {
      case 'ROOM_SNAPSHOT': {
        durableActions.clear();
        attempts = 0;
        activeConfig.role = message.self.role;
        clearTimeout(watchdog);
        const contextChanged =
          store.room.id !== message.state.id ||
          store.self?.id !== message.self.id ||
          store.self?.role !== message.self.role;
        const ownCharacter =
          message.self.role === 'player'
            ? Object.values(message.state.characters || {}).find(
                (c) => c.ownerId === message.self.id,
              )
            : undefined;
        store.set({
          room: message.state,
          savedRevision: message.savedRevision ?? null,
          savePending: message.savePending ?? false,
          pendingDurableActions: 0,
          self: message.self,
          canGM: message.canGM ?? message.self.role === 'gm',
          presence: message.presence,
          status: 'live',
          inviteCode: message.inviteCode,
          previews: {},
          ...(contextChanged
            ? {
                deliveries: {},
                presentation: null,
                rollQueue: [],
                pings: [],
                tool: 'select' as const,
                dialog: null,
                panel: ownCharacter ? ('character' as const) : ('chronicle' as const),
                characterId: ownCharacter?.id || null,
                characterEditId: null,
                activityOpen: !!ownCharacter,
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
          removedMembers:
            message.self.role === 'gm' && store.room.id === message.state.id
              ? store.removedMembers
              : [],
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
      }
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
                previews: {},
                pings: [],
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
        store.set({
          members: message.members,
          ownerId: message.ownerId,
          removedMembers: message.removedMembers || [],
        });
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
          removedMembers: [],
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
        presentRoll(message.roll);
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
        if (!store.room.savedAt || message.savedAt >= store.room.savedAt)
          store.set({
            room: { ...store.room, savedAt: message.savedAt },
            savedRevision: message.revision,
            savePending: message.pending ?? false,
          });
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
    if (socket !== active || stopped) return;
    rejectPendingActions(
      'The connection closed before confirmation. Check the table before retrying.',
    );
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
  cancelLaunch();
  stopped = true;
  rejectPendingActions('Disconnected before this action was confirmed.');
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

export function launchDemo(role: 'gm' | 'player' = 'gm') {
  disconnect();
  config = null;
  const url = new URL(location.href);
  url.searchParams.delete('room');
  url.searchParams.delete('invite');
  history.replaceState({}, '', url);
  startDemo(role);
}
