import { GridPreview } from './GridPreview.js';
import { AssetImage } from '../assets.js';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Copy, Image, Link2, Lock, Plus, Sparkles, X } from 'lucide-react';
import { useTable } from '../store.js';
import {
  inviteUrl,
  launch,
  launchDemo,
  liveAvailable,
  send,
  sendAndWait,
  supabase,
  uploadImage,
  savedCampaigns,
  signIn,
  currentAccount,
  signOut,
  resumeCampaign,
} from '../connection.js';
import { assetUrl, validateAsset } from '../../shared/assets.js';
import { resolveAsset } from '../assets.js';
import { invalidateImage } from '../rendering.js';
import { TokenLibraryDialog, AssetManagerDialog, ObjectsDialog } from './Workshop.js';
import { DiceSettings } from './DiceSettings.js';
import { MacroLibraryDialog } from './Macros.js';
import { DiscordSettings } from './DiscordSettings.js';
import { CharacterImportDialog } from './Characters.js';
import { unlockSound } from '../sound.js';
import type { Asset, Token } from '../../shared/model.js';
import { saveTokenDraft } from '../tokenSave.js';

/** A form belongs to the room, scene and identity where it opened, even between renders. */
function useSceneDialog(dialog: 'map' | 'new-scene' | 'token' | 'grid') {
  const [context] = useState(() => {
    const s = useTable.getState();
    return {
      roomId: s.room.id,
      scene: s.room.scenes[s.room.activeSceneId],
      userId: s.self?.id,
      role: s.self?.role,
    };
  });
  const invalidated = useRef(false);
  const matches = (s: ReturnType<typeof useTable.getState>) =>
    s.room.id === context.roomId &&
    s.room.activeSceneId === context.scene.id &&
    !!s.room.scenes[context.scene.id] &&
    s.self?.id === context.userId &&
    s.self?.role === context.role;
  useEffect(() => {
    invalidated.current = false;
    const check = (s: ReturnType<typeof useTable.getState>) => {
      if (!matches(s)) {
        invalidated.current = true;
        if (s.dialog === dialog) s.set({ dialog: null });
      }
    };
    const unsubscribe = useTable.subscribe(check);
    check(useTable.getState());
    return () => {
      invalidated.current = true;
      unsubscribe();
    };
  }, [context, dialog]);
  return {
    scene: context.scene,
    currentScene: () => {
      const s = useTable.getState();
      return !invalidated.current && matches(s) && s.dialog === dialog
        ? s.room.scenes[context.scene.id]
        : undefined;
    },
  };
}
export function Dialogs() {
  const s = useTable(),
    ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!s.dialog) return;
    const previous = document.activeElement as HTMLElement;
    const el = ref.current;
    (el?.querySelector<HTMLElement>('input,button') || el)?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') s.set({ dialog: null });
      if (e.key === 'Tab' && el) {
        const items = [
          ...el.querySelectorAll<HTMLElement>(
            'a[href],button,input,select,textarea,[tabindex],[contenteditable="true"]',
          ),
        ].filter(
          (n) => !n.matches(':disabled') && n.tabIndex >= 0 && n.getClientRects().length > 0,
        );
        const first = items[0],
          last = items.at(-1);
        if (!items.length) {
          e.preventDefault();
          el.focus();
        } else if (!el.contains(document.activeElement)) {
          e.preventDefault();
          (e.shiftKey ? last : first)?.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      if (previous?.isConnected) previous.focus();
    };
  }, [s.dialog, s.set]);
  if (!s.dialog) return null;
  const title = {
    launch: supabase ? 'Your campaigns' : 'Your table',
    map: s.self?.role === 'player' ? 'Scene details' : 'Scene',
    'new-scene': 'New Scene',
    token: 'Character',
    grid: 'Grid',
    invite: 'Your party',
    settings: 'Preferences',
    help: 'Table guide',
    library: 'Character library',
    assets: 'Images',
    objects: 'Regions, drawings & notes',
    macros: 'Macros',
    discord: 'Discord',
    'character-import': 'Character text',
  }[s.dialog];
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) s.set({ dialog: null });
      }}
    >
      <div
        ref={ref}
        className={`modal modal-${s.dialog}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
      >
        <div className="modal-header">
          <button aria-label="Close dialog" onClick={() => s.set({ dialog: null })}>
            <X size={19} />
          </button>
        </div>
        <h2 id="modal-title">{title}</h2>
        {s.dialog === 'character-import' ? (
          <CharacterImportDialog key={s.room.id + s.characterEditId + s.self?.id + s.self?.role} />
        ) : s.dialog === 'launch' ? (
          <Launch />
        ) : s.dialog === 'map' || s.dialog === 'new-scene' ? (
          <MapDialog key={s.dialog} create={s.dialog === 'new-scene'} />
        ) : s.dialog === 'token' ? (
          <TokenDialog />
        ) : s.dialog === 'grid' ? (
          <GridDialog />
        ) : s.dialog === 'invite' ? (
          <Invite />
        ) : s.dialog === 'settings' ? (
          <Settings />
        ) : s.dialog === 'library' ? (
          <TokenLibraryDialog />
        ) : s.dialog === 'assets' ? (
          <AssetManagerDialog />
        ) : s.dialog === 'objects' ? (
          <ObjectsDialog />
        ) : s.dialog === 'macros' ? (
          <MacroLibraryDialog />
        ) : s.dialog === 'discord' ? (
          <DiscordSettings />
        ) : (
          <Help />
        )}
      </div>
    </div>
  );
}
function Launch() {
  const s = useTable(),
    params = new URLSearchParams(location.search),
    [name, setName] = useState('Storykeeper'),
    [campaign, setCampaign] = useState('The Hollow Chronicles'),
    [join, setJoin] = useState(params.has('room')),
    [campaignAction, setCampaignAction] = useState(
      !supabase || (params.has('room') && s.status !== 'live'),
    ),
    [link, setLink] = useState(params.has('room') ? location.href : ''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [signup, setSignup] = useState(false),
    [role, setRole] = useState<'gm' | 'player'>('gm'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [account, setAccount] = useState<{ name: string; email: string } | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  useEffect(() => {
    let active = true;
    async function load() {
      if (!liveAvailable) return;
      try {
        if (supabase) {
          const restored = await currentAccount();
          if (!active) return;
          setAccount(restored);
          if (!restored) return;
          setName(restored.name);
        }
        const saved = await savedCampaigns();
        if (active) setCampaigns(saved);
      } catch (error) {
        if (active) setError(error instanceof Error ? error.message : 'Could not load campaigns.');
      } finally {
        if (active) setAuthReady(true);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);
  if (!liveAvailable)
    return (
      <div className="demo-options">
        <p className="modal-description">
          Explore a complete sample table in this browser. No account or cloud services needed.
          Changes reset on reload.
        </p>
        <button className="primary modal-submit" onClick={() => launchDemo()}>
          Try the GM demo
        </button>
        <button className="subtle-button" onClick={() => launchDemo('player')}>
          Try the player demo
        </button>
        <p className="field-note">Live multiplayer is not configured on this site.</p>
      </div>
    );
  if (!authReady)
    return (
      <p className="field-note" role="status">
        Loading your account…
      </p>
    );
  if (supabase && !account)
    return (
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await signIn(name, email, password, signup);
            const signedIn = await currentAccount();
            if (!signedIn) throw new Error('Log in to access your campaigns.');
            setAccount(signedIn);
            setName(signedIn.name);
            setCampaigns(await savedCampaigns());
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Could not log in.');
          } finally {
            setBusy(false);
          }
        }}
      >
        {signup && (
          <label>
            Your name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={32}
              autoComplete="nickname"
            />
          </label>
        )}
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete={signup ? 'new-password' : 'current-password'}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary modal-submit" disabled={busy}>
          {busy ? 'Signing in…' : signup ? 'Create account' : 'Log in'}
        </button>
        <button
          type="button"
          className="subtle-button"
          disabled={busy}
          onClick={() => {
            setSignup(!signup);
            setError('');
          }}
        >
          {signup ? 'Already have an account? Log in' : 'Create an account'}
        </button>
        <button
          type="button"
          className="subtle-button"
          disabled={busy}
          onClick={() => launchDemo()}
        >
          Demo
        </button>
      </form>
    );
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!campaignAction) return;
        setBusy(true);
        setError('');
        try {
          let roomId: string | undefined, invite: string | undefined;
          if (join) {
            const url = new URL(link);
            roomId = url.searchParams.get('room') || undefined;
            invite = url.searchParams.get('invite') || undefined;
            if (!roomId)
              throw new Error('Paste the full invitation link shared by your game master.');
          }
          await launch(name, campaign, roomId, invite, undefined, undefined, false, role);
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Could not open your table.');
        } finally {
          setBusy(false);
        }
      }}
    >
      {account && (
        <div className="account-summary">
          <span>{account.email}</span>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await signOut();
                setAccount(null);
                setCampaigns([]);
                setPassword('');
                setJoin(false);
                setLink('');
                setCampaignAction(false);
              } catch (error) {
                setError(error instanceof Error ? error.message : 'Could not sign out.');
              } finally {
                setBusy(false);
              }
            }}
          >
            Sign out
          </button>
        </div>
      )}
      {campaigns.length > 0 && (
        <div className="resume-campaigns">
          {campaigns.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={busy}
              onClick={() => resumeCampaign(c.id, c.role === 'gm' ? role : 'player')}
            >
              <span>
                {c.name}
                <small>{c.role === 'gm' ? 'Game master' : 'Player'}</small>
              </span>
              <ArrowUpRight size={14} />
            </button>
          ))}
        </div>
      )}
      <label>
        Enter table as
        <select value={role} onChange={(e) => setRole(e.target.value as 'gm' | 'player')}>
          <option value="gm">Campaign role</option>
          <option value="player">Player</option>
        </select>
      </label>
      {!campaigns.length && account && !error && (
        <p className="field-note">Create a campaign or join with an invitation.</p>
      )}
      <div className="segmented">
        <button
          type="button"
          className={campaignAction && !join ? 'active' : ''}
          onClick={() => {
            setJoin(false);
            setCampaignAction(true);
          }}
        >
          Create a campaign
        </button>
        <button
          type="button"
          className={campaignAction && join ? 'active' : ''}
          onClick={() => {
            setJoin(true);
            setCampaignAction(true);
          }}
        >
          Join a party
        </button>
      </div>
      {campaignAction && (
        <>
          {!account && (
            <label>
              Your name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={32}
              />
            </label>
          )}
          {join ? (
            <label>
              Invitation link
              <input
                type="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="Paste your party’s invitation link"
                required
              />
            </label>
          ) : (
            <label>
              Campaign name
              <input
                value={campaign}
                onChange={(e) => setCampaign(e.target.value)}
                required
                maxLength={60}
              />
            </label>
          )}
        </>
      )}
      {error && (
        <>
          <p className="form-error" role="alert">
            {error}
          </p>
          {account && (
            <button
              type="button"
              className="subtle-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setCampaigns(await savedCampaigns());
                  setError('');
                } catch (error) {
                  setError(error instanceof Error ? error.message : 'Could not load campaigns.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Retry campaigns
            </button>
          )}
        </>
      )}
      {campaignAction && (
        <button className="primary modal-submit" disabled={busy}>
          <Sparkles size={16} />
          {busy ? 'Opening the table…' : join ? 'Join your party' : 'Create campaign'}
          <ArrowUpRight size={16} />
        </button>
      )}
      <button type="button" className="subtle-button" onClick={() => launchDemo()}>
        Demo
      </button>
    </form>
  );
}
function AssetPicker({
  asset,
  onChange,
  onBusyChange,
  purpose = 'map',
}: {
  asset: Asset;
  purpose?: 'map' | 'token';
  onChange: (a: Asset, width?: number, height?: number) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const table = useTable(),
    [campaignOpen, setCampaignOpen] = useState(false),
    [imageLimit, setImageLimit] = useState(12);
  const images = new Map<string, { asset: Asset; name: string; width?: number; height?: number }>();
  for (const a of Object.values(table.room.assets || {}))
    images.set(`uploaded:${a.id}`, {
      asset: { kind: 'uploaded', url: a.id },
      name: a.name,
      width: a.width,
      height: a.height,
    });
  const addImage = (a: Asset, name: string, width?: number, height?: number) => {
    if (a.kind !== 'uploaded' && !images.has(`${a.kind}:${a.url}`))
      images.set(`${a.kind}:${a.url}`, { asset: a, name, width, height });
  };
  for (const sc of Object.values(table.room.scenes)) {
    addImage(sc.map, sc.name, sc.width, sc.height);
    for (const t of Object.values(sc.tokens)) addImage(t.image, t.name);
  }
  for (const t of Object.values(table.room.tokenLibrary || {})) addImage(t.image, t.name);
  const [url, setUrl] = useState(asset.kind === 'external' ? asset.url : ''),
    [preview, setPreview] = useState<string | undefined>(
      asset.kind === 'uploaded' ? undefined : assetUrl(asset, import.meta.env.BASE_URL),
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const setLoading = (value: boolean) => {
    setBusy(value);
    onBusyChange?.(value);
  };
  const generation = useRef(0),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      generation.current++;
    };
  }, []);
  const roomId = useTable((state) => state.room.id),
    gm = useTable((state) => state.self?.role === 'gm'),
    demo = useTable((state) => state.status === 'demo');
  useEffect(() => {
    let current = true;
    setUrl(asset.kind === 'external' ? asset.url : '');
    void resolveAsset(asset, roomId)
      .then((uri) => {
        if (current) setPreview(uri);
      })
      .catch(() => {
        if (current) setError('This stored image is unavailable. Replace it or retry.');
      });
    return () => {
      current = false;
    };
  }, [asset.kind, asset.url, roomId]);
  async function upload(file: File) {
    const n = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const result = await uploadImage(file, purpose);
      if (!active.current || n !== generation.current) return;
      invalidateImage(result.asset, roomId);
      const uri = await resolveAsset(result.asset, roomId);
      if (active.current && n === generation.current) {
        setPreview(uri);
        onChange(result.asset, result.width, result.height);
      }
    } catch (e) {
      if (active.current && n === generation.current) setError((e as Error).message);
    } finally {
      if (active.current && n === generation.current) setLoading(false);
    }
  }
  async function check() {
    const n = ++generation.current;
    setError('');
    setLoading(true);
    try {
      const next: Asset = { kind: 'external', url };
      validateAsset(next);
      const dimensions = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        const image = new window.Image();
        const timer = setTimeout(
          () =>
            reject(
              new Error('The image host did not respond. Check the link or try a different host.'),
            ),
          10000,
        );
        image.referrerPolicy = 'no-referrer';
        image.onload = () => {
          clearTimeout(timer);
          if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 40000000)
            reject(new Error('Use an image smaller than 40 megapixels.'));
          else resolve({ w: image.naturalWidth, h: image.naturalHeight });
        };
        image.onerror = () => {
          clearTimeout(timer);
          reject(
            new Error(
              'This link could not load as an image. Use a direct PNG, JPEG or WebP link from a host that permits embedding.',
            ),
          );
        };
        image.src = url;
      });
      if (active.current && n === generation.current) {
        invalidateImage(next, roomId);
        setPreview(url);
        onChange(next, dimensions.w, dimensions.h);
      }
    } catch (e) {
      if (active.current && n === generation.current) setError((e as Error).message);
    } finally {
      if (active.current && n === generation.current) setLoading(false);
    }
  }
  return (
    <div className="asset-picker">
      <button
        type="button"
        disabled={busy}
        aria-expanded={campaignOpen}
        onClick={() => setCampaignOpen(!campaignOpen)}
      >
        Campaign images
      </button>
      {campaignOpen && (
        <div className="campaign-image-picker" aria-label="Campaign images">
          {[...images].slice(0, imageLimit).map(([key, item]) => (
            <button
              type="button"
              key={key}
              disabled={busy}
              aria-label={`Choose image ${item.name}`}
              onClick={() => {
                setError('');
                onChange(item.asset, item.width, item.height);
                setCampaignOpen(false);
              }}
            >
              <AssetImage asset={item.asset} alt="" />
              <span>{item.name}</span>
            </button>
          ))}
          {images.size > imageLimit && (
            <button type="button" onClick={() => setImageLimit((limit) => limit + 12)}>
              Show more campaign images
            </button>
          )}
          {!images.size && (
            <p className="field-note">No images available yet. Upload an image or preview a URL.</p>
          )}
        </div>
      )}
      {gm && !demo && (
        <label className="upload-control">
          Upload image
          <input
            aria-label="Upload image"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = '';
            }}
          />
          <small>
            {busy
              ? 'Processing image…'
              : 'PNG, JPEG, WebP · up to 10 MiB · stored with the campaign'}
          </small>
        </label>
      )}
      {demo && (
        <p className="field-note">
          Uploads need a live campaign. Try the included artwork or a public image URL.
        </p>
      )}
      <div className="asset-preview">
        <img
          src={preview}
          referrerPolicy="no-referrer"
          alt="Image preview"
          onError={() => setError('The saved image is unavailable. Replace its URL below.')}
        />
        <span>
          <Image size={13} /> IMAGE PREVIEW
        </span>
      </div>
      <label>
        External image URL
        <div className="url-input">
          <Link2 size={15} />
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/map.webp"
          />
          <button type="button" onClick={() => void check()} disabled={busy}>
            {busy ? 'Loading…' : 'Preview'}
          </button>
        </div>
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="field-note">
        Preview a link before saving. Images load directly from the host, which can see players’ IP
        addresses. Aether stores the reference.
      </p>
    </div>
  );
}
function MapDialog({ create }: { create: boolean }) {
  const s = useTable(),
    { scene, currentScene } = useSceneDialog(create ? 'new-scene' : 'map'),
    gm = s.self?.role === 'gm';
  const [asset, setAsset] = useState<Asset>(
      create ? { kind: 'builtin', url: 'blank.svg' } : scene.map,
    ),
    [name, setName] = useState(create ? '' : scene.name),
    [width, setWidth] = useState(create ? 1600 : scene.width),
    [height, setHeight] = useState(create ? 1200 : scene.height),
    [sceneId] = useState(() => (create ? crypto.randomUUID() : scene.id)),
    [saving, setSaving] = useState(false),
    [assetBusy, setAssetBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!gm || saving || assetBusy || !currentScene()) return;
        setSaving(true);
        setError('');
        try {
          await sendAndWait({
            type: 'SCENE_CONFIG',
            sceneId,
            name,
            map: asset,
            width,
            height,
            create,
          });
          if (currentScene()) s.set({ dialog: null, fitNonce: useTable.getState().fitNonce + 1 });
        } catch (error) {
          if (currentScene())
            setError(error instanceof Error ? error.message : 'Scene save failed.');
        } finally {
          if (currentScene()) setSaving(false);
        }
      }}
    >
      <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <AssetPicker
          asset={asset}
          onBusyChange={setAssetBusy}
          onChange={(a, w, h) => {
            setAsset(a);
            setWidth(Math.min(10000, Math.max(200, w || 1600)));
            setHeight(Math.min(10000, Math.max(200, h || 1200)));
          }}
        />
        <label>
          Scene name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            required
            disabled={!gm}
          />
        </label>
        <div className="form-row">
          <label>
            Width
            <input
              type="number"
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              min={200}
              max={10000}
              required
              disabled={!gm}
            />
          </label>
          <label>
            Height
            <input
              type="number"
              value={height}
              onChange={(e) => setHeight(Number(e.target.value))}
              min={200}
              max={10000}
              required
              disabled={!gm}
            />
          </label>
        </div>
        {gm ? (
          <>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary modal-submit" disabled={saving || assetBusy}>
              <MapIcon />
              {saving ? 'Saving…' : create ? 'Add scene' : 'Save scene'}
              <Check size={16} />
            </button>
          </>
        ) : (
          <p className="field-note">Your game master manages the campaign’s scenes.</p>
        )}
      </fieldset>
    </form>
  );
}
function MapIcon() {
  return <Image size={16} />;
}
function TokenDialog() {
  const s = useTable(),
    { scene, currentScene } = useSceneDialog('token'),
    gm = s.self?.role === 'gm';
  const [existing, setExisting] = useState(() =>
    s.selected ? scene.tokens[s.selected] : undefined,
  );
  const [token, setToken] = useState<Token>(
    existing || {
      id: crypto.randomUUID(),
      name: 'New adventurer',
      image: { kind: 'builtin', url: 'wisp.svg' },
      x: scene.width / 2,
      y: scene.height / 2,
      size: scene.grid.size,
      rotation: 0,
      color: '#d8b46c',
      owners: ['*'],
      visibility: 'public',
      resource: { label: 'Resolve', value: 10, max: 10 },
    },
  );
  const [saveTemplate, setSaveTemplate] = useState(false),
    [assetBusy, setAssetBusy] = useState(false),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState(''),
    [statusLabel, setStatusLabel] = useState(''),
    [statusIcon, setStatusIcon] = useState<'star' | 'shield' | 'flame' | 'eye' | 'circle'>('star');
  const update = (value: Partial<Token>) => setToken((current) => ({ ...current, ...value }));
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!gm || saving || assetBusy || !currentScene()) return;
        setSaving(true);
        setSaveError('');
        try {
          const saved = await saveTokenDraft(
            { sceneId: scene.id, original: existing, token, saveTemplate },
            {
              currentScene,
              send: sendAndWait,
              accepted: (saved) => {
                setExisting(saved);
                setToken(saved);
              },
            },
          );
          if (saved && currentScene())
            s.set({ dialog: null, selected: saved.id, selectedIds: [saved.id] });
        } catch (error) {
          if (currentScene()) {
            setSaveError(error instanceof Error ? error.message : 'Could not save token.');
            // A lost confirmation may hide a successful creation. Fetch it before offering reload;
            // createOnly also protects a retry when this snapshot has not arrived yet.
            if (!existing) send({ type: 'STATE_RESYNC' });
          }
        } finally {
          if (currentScene()) setSaving(false);
        }
      }}
    >
      <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <AssetPicker
          purpose="token"
          asset={token.image}
          onChange={(image) => update({ image })}
          onBusyChange={setAssetBusy}
        />
        <label>
          Name
          <input
            value={token.name}
            onChange={(e) => update({ name: e.target.value })}
            maxLength={48}
            required
            disabled={!gm}
          />
        </label>
        <div className="form-row">
          <label>
            Size (scene pixels)
            <input
              type="number"
              value={token.size}
              onChange={(e) => update({ size: Number(e.target.value) })}
              min={24}
              max={240}
              required
              disabled={!gm}
            />
          </label>
          <label>
            Rotation
            <input
              type="number"
              value={token.rotation}
              onChange={(e) => update({ rotation: Number(e.target.value) })}
              min={-360}
              max={360}
              required
              disabled={!gm}
            />
          </label>
          <label>
            Ring colour
            <input
              type="color"
              value={token.color}
              onChange={(e) => update({ color: e.target.value })}
              disabled={!gm}
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            Visibility
            <select
              value={token.visibility}
              onChange={(e) => update({ visibility: e.target.value as Token['visibility'] })}
              disabled={!gm}
            >
              <option value="public">Visible to party</option>
              <option value="gm">Game master only</option>
            </select>
          </label>
          <label>
            Who can move it?
            <select
              value={token.owners.includes('*') ? '*' : token.owners[0] || 'gm'}
              onChange={(e) => update({ owners: e.target.value === 'gm' ? [] : [e.target.value] })}
              disabled={!gm}
            >
              <option value="*">Everyone</option>
              <option value="gm">Game master only</option>
              {[...new Map([...s.presence, ...s.members].map((p) => [p.id, p])).values()].map(
                (p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {s.presence.some((online) => online.id === p.id) ? '' : ' (offline)'}
                  </option>
                ),
              )}
            </select>
          </label>
        </div>
        <label>
          Character sheet
          <select
            aria-label="Linked character sheet"
            value={token.characterId || ''}
            disabled={!gm}
            onChange={(e) => update({ characterId: e.target.value || null })}
          >
            <option value="">No linked sheet</option>
            {token.characterId && !s.room.characters?.[token.characterId] && (
              <option value={token.characterId}>Removed character · unlink to save</option>
            )}
            {Object.values(s.room.characters || {}).map((sheet) => (
              <option key={sheet.id} value={sheet.id}>
                {sheet.name}
              </option>
            ))}
          </select>
          <small>
            A sheet keeps its resources across scenes. Its owner controls its abilities.
          </small>
        </label>
        <div className="form-row">
          <label>
            Resource label
            <input
              value={token.resource?.label || ''}
              onChange={(e) =>
                update({
                  resource: {
                    label: e.target.value,
                    value: token.resource?.value || 0,
                    max: token.resource?.max || 10,
                  },
                })
              }
              maxLength={16}
              disabled={!gm}
            />
          </label>
          <label>
            Current
            <input
              type="number"
              min={0}
              max={10000}
              value={token.resource?.value || 0}
              onChange={(e) =>
                update({ resource: { ...token.resource!, value: Number(e.target.value) } })
              }
              disabled={!gm}
            />
          </label>
          <label>
            Maximum
            <input
              type="number"
              min={1}
              max={10000}
              value={token.resource?.max || 10}
              onChange={(e) =>
                update({ resource: { ...token.resource!, max: Number(e.target.value) } })
              }
              disabled={!gm}
            />
          </label>
        </div>
        {gm && (
          <div className="status-editor">
            <span className="eyebrow">TOKEN STATUSES</span>
            <div className="status-chips">
              {(token.statuses || []).map((status) => (
                <button
                  key={status.id}
                  type="button"
                  onClick={() =>
                    update({ statuses: token.statuses!.filter((t) => t.id !== status.id) })
                  }
                  style={{ color: status.color }}
                >
                  {status.label} ×
                </button>
              ))}
            </div>
            <div className="form-row">
              <label>
                Status label
                <input
                  value={statusLabel}
                  onChange={(e) => setStatusLabel(e.target.value)}
                  maxLength={24}
                />
              </label>
              <label>
                Symbol
                <select
                  value={statusIcon}
                  onChange={(e) => setStatusIcon(e.target.value as typeof statusIcon)}
                >
                  {['star', 'shield', 'flame', 'eye', 'circle'].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                aria-label="Add status"
                disabled={!statusLabel.trim() || (token.statuses?.length || 0) >= 8}
                onClick={() => {
                  update({
                    statuses: [
                      ...(token.statuses || []),
                      {
                        id: crypto.randomUUID(),
                        label: statusLabel.trim(),
                        color: token.color,
                        icon: statusIcon,
                      },
                    ],
                  });
                  setStatusLabel('');
                }}
              >
                <Plus size={16} />
              </button>
            </div>
            <label className="check-label">
              <input
                type="checkbox"
                checked={saveTemplate}
                onChange={(e) => setSaveTemplate(e.target.checked)}
              />
              Also save a reusable token template
            </label>
          </div>
        )}
        {gm && (
          <>
            <label>
              GM note
              <textarea
                value={token.note || ''}
                onChange={(e) => update({ note: e.target.value })}
                maxLength={2000}
                rows={2}
              />
            </label>
            <p className="field-note">
              <Lock size={11} /> GM notes and hidden tokens are filtered on the server.
            </p>
            {saveError && (
              <>
                <p className="form-error" role="alert">
                  {saveError}
                </p>
                {(existing || currentScene()?.tokens[token.id]) && (
                  <button
                    type="button"
                    onClick={() => {
                      const latest = currentScene()?.tokens[token.id];
                      if (!latest) return;
                      setExisting(latest);
                      setToken(latest);
                      setSaveError('');
                    }}
                  >
                    Reload latest token values
                  </button>
                )}
              </>
            )}
            <button className="primary modal-submit" disabled={saving || assetBusy}>
              <Plus size={16} />
              {saving ? 'Saving…' : existing ? 'Save token' : 'Add to the table'}
              <Check size={16} />
            </button>
          </>
        )}
      </fieldset>
    </form>
  );
}
function GridDialog() {
  const s = useTable(),
    { scene, currentScene } = useSceneDialog('grid'),
    gm = s.self?.role === 'gm',
    [grid, setGrid] = useState(scene.grid),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const update = (v: Partial<typeof grid>) => setGrid((current) => ({ ...current, ...v }));
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const current = currentScene();
        if (!current || saving) return;
        setSaving(true);
        setError('');
        try {
          if (gm) await sendAndWait({ type: 'GRID_UPDATE', sceneId: scene.id, grid });
          else if (!s.self) {
            const latest = useTable.getState();
            s.set({
              room: {
                ...latest.room,
                scenes: { ...latest.room.scenes, [scene.id]: { ...current, grid } },
              },
            });
          }
          if (currentScene()) s.set({ dialog: null });
        } catch (error) {
          if (currentScene())
            setError(error instanceof Error ? error.message : 'Grid save failed.');
        } finally {
          if (currentScene()) setSaving(false);
        }
      }}
    >
      <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <p className="modal-description">
          Choose square or hex geometry, or a world without lines. Measurements can follow real
          distance or count grid steps.
        </p>
        <GridPreview
          scene={scene}
          grid={grid}
          onChange={update}
          disabled={saving || (!!s.self && !gm)}
        />
        <div className="form-row">
          <label>
            Grid type
            <select
              aria-label="Grid type"
              value={grid.type || 'square'}
              onChange={(e) => update({ type: e.target.value as 'square' | 'hex' })}
              disabled={!!s.self && !gm}
            >
              <option value="square">Square</option>
              <option value="hex">Hex · pointy top</option>
            </select>
          </label>
          <label>
            Measurement convention
            <select
              value={grid.measurement || 'real'}
              onChange={(e) => update({ measurement: e.target.value as 'real' | 'grid' })}
              disabled={!!s.self && !gm}
            >
              <option value="real">Real distance</option>
              <option value="grid">Grid steps</option>
            </select>
          </label>
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            checked={grid.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
            disabled={!!s.self && !gm}
          />
          Show grid
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={grid.snap}
            onChange={(e) => update({ snap: e.target.checked })}
            disabled={!!s.self && !gm}
          />
          Snap tokens to grid centres
        </label>
        <div className="form-row">
          <label>
            Cell size (pixels)
            <input
              type="number"
              step={0.01}
              min={16}
              max={200}
              value={grid.size}
              onChange={(e) => update({ size: Number(e.target.value) })}
              required
              disabled={!!s.self && !gm}
            />
          </label>
          <label>
            Distance per cell
            <input
              type="number"
              min={0.1}
              max={1000}
              step={0.1}
              value={grid.distance}
              onChange={(e) => update({ distance: Number(e.target.value) })}
              required
              disabled={!!s.self && !gm}
            />
          </label>
          <label>
            Units
            <input
              value={grid.units}
              maxLength={12}
              onChange={(e) => update({ units: e.target.value })}
              required
              disabled={!!s.self && !gm}
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            X alignment
            <input
              type="number"
              min={-200}
              max={200}
              value={grid.offsetX}
              onChange={(e) => update({ offsetX: Number(e.target.value) })}
              disabled={!!s.self && !gm}
            />
          </label>
          <label>
            Y alignment
            <input
              type="number"
              min={-200}
              max={200}
              value={grid.offsetY}
              onChange={(e) => update({ offsetY: Number(e.target.value) })}
              disabled={!!s.self && !gm}
            />
          </label>
        </div>
        <label>
          Grid opacity · {Math.round(grid.opacity * 100)}%
          <input
            type="range"
            min={0}
            max={0.6}
            step={0.01}
            value={grid.opacity}
            onChange={(e) => update({ opacity: Number(e.target.value) })}
            disabled={!!s.self && !gm}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          className="subtle-button"
          disabled={saving}
          onClick={() => s.set({ dialog: null })}
        >
          Cancel grid changes
        </button>
        {(gm || !s.self) && (
          <button className="primary modal-submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save grid'}
            <Check size={16} />
          </button>
        )}
      </fieldset>
    </form>
  );
}
function Invite() {
  const s = useTable(),
    [copied, setCopied] = useState(false),
    [removing, setRemoving] = useState<string | null>(null);
  return (
    <>
      <p className="modal-description">Anyone with your invitation can join as a player.</p>
      <div className="party-list">
        {s.presence.map((p) => (
          <div key={p.id}>
            <span className="avatar" style={{ borderColor: p.color }}>
              {p.name[0]}
            </span>
            <span>
              {p.name}
              <small>{p.role === 'gm' ? 'Game master' : 'Player'}</small>
            </span>
            <span className="online-dot" />
          </div>
        ))}
      </div>
      {s.self?.id === s.ownerId && (
        <div className="member-management">
          <span className="eyebrow">CAMPAIGN MEMBERS</span>
          {s.members
            .filter((m) => m.id !== s.ownerId)
            .map((m) => (
              <div key={m.id}>
                <span>{m.name}</span>
                <select
                  aria-label={`Role for ${m.name}`}
                  value={m.role}
                  onChange={(e) =>
                    send({
                      type: 'MEMBER_UPDATE',
                      userId: m.id,
                      role: e.target.value as 'gm' | 'player',
                    })
                  }
                >
                  <option value="player">Player</option>
                  <option value="gm">Campaign role</option>
                </select>
                <button aria-label={`Remove ${m.name}`} onClick={() => setRemoving(m.id)}>
                  <X size={14} />
                </button>
              </div>
            ))}
          {removing && s.members.some((m) => m.id === removing) && (
            <div className="member-removal-warning" role="alert">
              <p>
                Remove {s.members.find((m) => m.id === removing)?.name}? They will be disconnected
                and blocked from this campaign, including invitation links, until you restore
                access.
              </p>
              <button
                onClick={() => {
                  if (send({ type: 'MEMBER_UPDATE', userId: removing, role: 'remove' }))
                    setRemoving(null);
                }}
              >
                Remove and block access
              </button>
              <button onClick={() => setRemoving(null)}>Cancel removal</button>
            </div>
          )}
          {!!s.removedMembers.length && <span className="eyebrow">REMOVED MEMBERS</span>}
          {s.removedMembers.map((m) => (
            <div key={m.id}>
              <span>
                {m.name}
                <small>Access blocked</small>
              </span>
              <button
                aria-label={`Restore access for ${m.name}`}
                onClick={() => send({ type: 'MEMBER_RESTORE', userId: m.id })}
              >
                Restore Access
              </button>
            </div>
          ))}
          <button
            className="subtle-button"
            onClick={() => {
              send({ type: 'INVITE_ROTATE' });
              setCopied(false);
            }}
          >
            Generate a new invitation
          </button>
        </div>
      )}
      {s.self?.id === s.ownerId && (
        <>
          <label>
            Party invitation
            <input
              aria-label="Party invitation"
              readOnly
              value={inviteUrl()}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
          <button
            className="primary modal-submit"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(inviteUrl());
                setCopied(true);
              } catch {
                s.set({ error: 'Select and copy the invitation link above.' });
              }
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}{' '}
            {copied ? 'Invitation copied' : 'Copy invitation'}
            <ArrowUpRight size={16} />
          </button>
          <p className="field-note">
            Share with your party. Open in a different browser or a private window for a second
            player.
          </p>
        </>
      )}
    </>
  );
}
function Settings() {
  const s = useTable();
  const save = (v: { reducedMotion?: boolean; sound?: boolean; diceTheme?: 'gold' | 'moon' }) => {
    if (v.sound) unlockSound();
    s.set(v);
  };
  return (
    <>
      <DiceSettings />
      <label className="setting-toggle">
        <span>
          <strong>Reduced motion</strong>
          <small>Show contributions and totals immediately.</small>
        </span>
        <input
          type="checkbox"
          checked={s.reducedMotion}
          onChange={(e) => save({ reducedMotion: e.target.checked })}
        />
      </label>
      <label className="setting-toggle">
        <span>
          <strong>Roll sound</strong>
          <small>A soft chime when the dice settle.</small>
        </span>
        <input
          type="checkbox"
          checked={s.sound}
          onChange={(e) => save({ sound: e.target.checked })}
        />
      </label>
      <button className="primary modal-submit" onClick={() => s.set({ dialog: null })}>
        Done
        <Check size={16} />
      </button>
    </>
  );
}
function Help() {
  return (
    <>
      <div className="help-list">
        {[
          ['V', 'Select & drag', 'Move a token you control. Right-click a selected token to edit.'],
          ['SPACE', 'Pan the canvas', 'Hold Space and drag, or use the hand tool. Scroll to zoom.'],
          [
            'M',
            'Measure distances & shapes',
            'Choose distance, path, radius, cone, or area. Paths finish with Enter. Set scale, units and grid conventions in Grid settings.',
          ],
          ['P', 'Call attention', 'Click to send a ping. Shift-click works from the select tool.'],
          [
            'F',
            'Reveal & conceal',
            'GM: cover the scene, then choose a brush, rectangle or polygon. Click polygon corners and press Enter. Each brush stroke has one undo.',
          ],
          [
            'Z',
            'Mark an area',
            'GM: choose a circle, rectangle, polygon, line or cone. Edit labels, colours, tags and opacity in Regions & annotations.',
          ],
          [
            'D / T',
            'Draw & annotate',
            'GM: draw freehand or place text. Choose Party or GM only before drawing.',
          ],
          [
            'E',
            'Erase drawings',
            'GM: drag over drawings, text or zones to erase whole objects. One Undo restores the whole gesture. Delete individual objects in Regions & annotations.',
          ],
          [
            'CTRL',
            'Select a group',
            'Ctrl/Cmd-click tokens or drag a selection box. Group, duplicate and save templates from the selection bar.',
          ],
          [
            'CTRL Z',
            'Undo & redo',
            'GM: undo the last table edit. Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redoes it. Dice and chat stay in history.',
          ],
          ['DEL', 'Remove a token', 'GM: select a token and press Delete or Backspace.'],
        ].map(([key, title, desc]) => (
          <div key={key}>
            <kbd>{key}</kbd>
            <span>
              <strong>{title}</strong>
              <small>{desc}</small>
            </span>
          </div>
        ))}
      </div>
      <div className="help-dice">
        <Sparkles size={16} />
        <span>
          Try <code>1d20 + 5 - 2</code>, <code>3d6</code>, or <code>1d100</code>. Supports d4, d6,
          d8, d10, d12, d20 and percentile dice.
          <br />
          <code>2d20kh1</code> keeps the highest die; <code>4d6dl1</code> drops the lowest. Use
          kh/kl to keep highest/lowest or dh/dl to drop highest/lowest, followed by a count.
          <code>5d6r&lt;2</code> rerolls ones until each die is at least 2. Rerolls support &lt;,
          &lt;=, &gt;, &gt;= and =, and run before keep/drop. These also work in macros.
        </span>
      </div>
      <p className="field-note">
        Upload PNG, JPEG or WebP images from Scene or Token settings. Saved token templates and
        image management live in the library. On tablets, the layers button opens the library and
        scene controls; pinch with two fingers to zoom. The Turns tab has a generic tracker with
        custom order, rounds and hidden entries.
      </p>
      <p className="field-note">
        History retains the latest 100 rolls and messages. Changes save in periodic snapshots (90
        seconds by default) and on scene changes or when the last player leaves. A crash may lose
        changes since the last save.
      </p>
    </>
  );
}
