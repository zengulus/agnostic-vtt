import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Copy, Image, Link2, Lock, Plus, Sparkles, X } from 'lucide-react';
import { useTable } from '../store.js';
import {
  inviteUrl,
  launch,
  send,
  supabase,
  uploadImage,
  savedCampaigns,
  resumeCampaign,
} from '../connection.js';
import { assetUrl, validateAsset } from '../../shared/assets.js';
import { resolveAsset } from '../assets.js';
import { invalidateImage } from '../rendering.js';
import { TokenLibraryDialog, AssetManagerDialog, ObjectsDialog } from './Workshop.js';
import { DiceSettings } from './DiceSettings.js';
import { MacroLibraryDialog } from './Macros.js';
import { DiscordSettings } from './DiscordSettings.js';
import { unlockSound } from '../sound.js';
import type { Asset, Token } from '../../shared/model.js';
export function Dialogs() {
  const s = useTable(),
    ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!s.dialog) return;
    const previous = document.activeElement as HTMLElement;
    const el = ref.current;
    el?.querySelector<HTMLElement>('input,button')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') s.set({ dialog: null });
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>('button,input,select,textarea')].filter(
          (n) => !n.hasAttribute('disabled'),
        );
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
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
      previous?.focus();
    };
  }, [s.dialog, s.set]);
  if (!s.dialog) return null;
  const title = {
    launch: 'Gather around the table',
    map: 'A world worth exploring',
    token: 'Bring a character to life',
    grid: 'The shape of your world',
    invite: 'An invitation to adventure',
    settings: 'Make the table yours',
    help: 'Your tabletop, at a glance',
    library: 'Your cast of characters',
    assets: 'The images in your world',
    objects: 'Regions, drawings & notes',
    macros: 'Your book of macros',
    discord: 'Bring the story to Discord',
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
      >
        <div className="modal-header">
          <span className="eyebrow">AETHER TABLE</span>
          <button aria-label="Close dialog" onClick={() => s.set({ dialog: null })}>
            <X size={19} />
          </button>
        </div>
        <h2 id="modal-title">{title}</h2>
        {s.dialog === 'launch' ? (
          <Launch />
        ) : s.dialog === 'map' ? (
          <MapDialog />
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
    [link, setLink] = useState(params.has('room') ? location.href : ''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [signup, setSignup] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string; role: string }>>([]);
  useEffect(() => {
    void savedCampaigns()
      .then(setCampaigns)
      .catch(() => {});
  }, []);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
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
          await launch(name, campaign, roomId, invite, email, password, signup);
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Could not open your table.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="modal-description">
        {supabase
          ? 'One account. Endless adventures. Sign in to create or join your party’s table.'
          : 'The local demo uses a real multiplayer server. Open an invitation in another browser to play together.'}
      </p>
      {campaigns.length > 0 && (
        <div className="resume-campaigns">
          <span className="eyebrow">YOUR SAVED TABLES</span>
          {campaigns.map((c) => (
            <button key={c.id} type="button" onClick={() => resumeCampaign(c.id)}>
              <span>
                {c.name}
                <small>{c.role === 'gm' ? 'Game master' : 'Player'}</small>
              </span>
              <ArrowUpRight size={14} />
            </button>
          ))}
        </div>
      )}
      <div className="segmented">
        <button type="button" className={!join ? 'active' : ''} onClick={() => setJoin(false)}>
          Create a campaign
        </button>
        <button type="button" className={join ? 'active' : ''} onClick={() => setJoin(true)}>
          Join a party
        </button>
      </div>
      <label>
        Your name
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={32} />
      </label>
      {supabase && (
        <>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </label>
          <label className="check-label">
            <input type="checkbox" checked={signup} onChange={(e) => setSignup(e.target.checked)} />
            Create a new account
          </label>
        </>
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
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary modal-submit" disabled={busy}>
        <Sparkles size={16} />
        {busy ? 'Opening the table…' : join ? 'Join your party' : 'Begin your adventure'}
        <ArrowUpRight size={16} />
      </button>
      {s.self && (
        <p className="field-note">Your current campaign stays saved when you open another table.</p>
      )}
    </form>
  );
}
function AssetPicker({
  asset,
  onChange,
  purpose = 'map',
}: {
  asset: Asset;
  purpose?: 'map' | 'token';
  onChange: (a: Asset, width?: number, height?: number) => void;
}) {
  const [url, setUrl] = useState(asset.kind === 'external' ? asset.url : ''),
    [preview, setPreview] = useState<string | undefined>(
      asset.kind === 'uploaded' ? undefined : assetUrl(asset, import.meta.env.BASE_URL),
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const generation = useRef(0),
    active = useRef(true);
  useEffect(
    () => () => {
      active.current = false;
      generation.current++;
    },
    [],
  );
  const roomId = useTable((state) => state.room.id),
    gm = useTable((state) => state.self?.role === 'gm');
  useEffect(() => {
    let current = true;
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
    setBusy(true);
    setError('');
    try {
      const result = await uploadImage(file, purpose);
      if (active.current && n === generation.current) {
        invalidateImage(result.asset, roomId);
        setPreview(await resolveAsset(result.asset, roomId));
        onChange(result.asset, result.width, result.height);
      }
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function check() {
    const n = ++generation.current;
    setError('');
    setBusy(true);
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
        setPreview(url);
        onChange(next, dimensions.w, dimensions.h);
      }
    } catch (e) {
      if (active.current && n === generation.current) setError((e as Error).message);
    } finally {
      if (active.current && n === generation.current) setBusy(false);
    }
  }
  return (
    <div className="asset-picker">
      {gm && (
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
function MapDialog() {
  const s = useTable(),
    scene = s.room.scenes[s.room.activeSceneId],
    gm = s.self?.role === 'gm';
  const [asset, setAsset] = useState<Asset>(scene.map),
    [name, setName] = useState(scene.name),
    [width, setWidth] = useState(scene.width),
    [height, setHeight] = useState(scene.height),
    [create, setCreate] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!gm) return;
        send({
          type: 'SCENE_CONFIG',
          sceneId: create ? crypto.randomUUID() : scene.id,
          name,
          map: asset,
          width,
          height,
          create,
        });
        s.set({ dialog: null, fitNonce: s.fitNonce + 1 });
      }}
    >
      <p className="modal-description">
        Unfold a new landscape. Use a direct image link to make it part of your story.
      </p>
      <AssetPicker
        asset={asset}
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
          <label className="check-label">
            <input type="checkbox" checked={create} onChange={(e) => setCreate(e.target.checked)} />
            Save as a new scene
          </label>
          <button className="primary modal-submit">
            <MapIcon />
            {create ? 'Add scene' : 'Save scene'}
            <Check size={16} />
          </button>
        </>
      ) : (
        <p className="field-note">Your game master manages the campaign’s scenes.</p>
      )}
    </form>
  );
}
function MapIcon() {
  return <Image size={16} />;
}
function TokenDialog() {
  const s = useTable(),
    scene = s.room.scenes[s.room.activeSceneId],
    existing = s.selected ? scene.tokens[s.selected] : undefined,
    gm = s.self?.role === 'gm';
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
    [statusLabel, setStatusLabel] = useState(''),
    [statusIcon, setStatusIcon] = useState<'star' | 'shield' | 'flame' | 'eye' | 'circle'>('star');
  const update = (value: Partial<Token>) => setToken({ ...token, ...value });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!gm) return;
        send({ type: 'TOKEN_UPDATE', sceneId: scene.id, token });
        if (saveTemplate)
          send({ type: 'LIBRARY_SAVE', token: { ...token, id: crypto.randomUUID() } });
        s.set({ dialog: null, selected: token.id, selectedIds: [token.id] });
      }}
    >
      <p className="modal-description">
        A portrait, a name, a place in the story. Tokens work with any game system.
      </p>
      <AssetPicker purpose="token" asset={token.image} onChange={(image) => update({ image })} />
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
            {s.presence.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
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
          <button className="primary modal-submit">
            <Plus size={16} />
            {existing ? 'Save token' : 'Add to the table'}
            <Check size={16} />
          </button>
        </>
      )}
    </form>
  );
}
function GridDialog() {
  const s = useTable(),
    scene = s.room.scenes[s.room.activeSceneId],
    gm = s.self?.role === 'gm',
    [grid, setGrid] = useState(scene.grid);
  const update = (v: Partial<typeof grid>) => setGrid({ ...grid, ...v });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (gm) send({ type: 'GRID_UPDATE', sceneId: scene.id, grid });
        else if (!s.self) {
          s.set({
            room: { ...s.room, scenes: { ...s.room.scenes, [scene.id]: { ...scene, grid } } },
          });
        }
        s.set({ dialog: null });
      }}
    >
      <p className="modal-description">
        Choose square or hex geometry, or a world without lines. Measurements can follow real
        distance or count grid steps.
      </p>
      <div className="form-row">
        <label>
          Grid type
          <select
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
      {(gm || !s.self) && (
        <button className="primary modal-submit">
          Save grid
          <Check size={16} />
        </button>
      )}
    </form>
  );
}
function Invite() {
  const s = useTable(),
    [copied, setCopied] = useState(false);
  return (
    <>
      <p className="modal-description">
        There’s always room for another story. Your invitation admits players to this campaign.
      </p>
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
                  <option value="gm">Game master</option>
                </select>
                <button
                  aria-label={`Remove ${m.name}`}
                  onClick={() => send({ type: 'MEMBER_UPDATE', userId: m.id, role: 'remove' })}
                >
                  <X size={14} />
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
      <p className="modal-description">
        A little more wonder, or a little less motion. These preferences are yours alone.
      </p>
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
      <p className="field-note">
        The server determines results. Dice physics only presents them. Private rolls are visible to
        their roller and the GM.
      </p>
      <button className="primary modal-submit" onClick={() => s.set({ dialog: null })}>
        Back to the story
        <Check size={16} />
      </button>
    </>
  );
}
function Help() {
  return (
    <>
      <p className="modal-description">Less setup. More story. Everything you need to begin.</p>
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
