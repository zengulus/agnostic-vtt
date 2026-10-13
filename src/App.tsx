import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Compass,
  Eye,
  Grid3X3,
  HelpCircle,
  Layers,
  Link2,
  Lock,
  Map,
  MessageSquare,
  MousePointer2,
  Move,
  Plus,
  Ruler,
  Settings2,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Square,
  Star,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
  Pencil,
  Type,
  Flag,
  FolderOpen,
  Image as ImageIcon,
} from 'lucide-react';
import { useTable } from './store.js';
import { inviteUrl, send } from './connection.js';
import { AssetImage } from './assets.js';
import { HistoryControls, TrackerPanel } from './components/Workshop.js';
import { parseDice } from '../shared/dice.js';
import { Tabletop } from './components/Tabletop.js';
import { RollPresentation } from './components/RollPresentation.js';
import { Dialogs } from './components/Dialogs.js';
import type { Tool } from './store.js';
import { unlockSound } from './sound.js';

const tools: Array<{
  id: Tool;
  label: string;
  key: string;
  icon: typeof MousePointer2;
  gm?: boolean;
}> = [
  { id: 'select', label: 'Select & move', key: 'V', icon: MousePointer2 },
  { id: 'pan', label: 'Pan canvas', key: 'H', icon: Move },
  { id: 'measure', label: 'Measure', key: 'M', icon: Ruler },
  { id: 'ping', label: 'Ping your party', key: 'P', icon: Compass },
  { id: 'zone', label: 'Mark an area', key: 'Z', icon: Square, gm: true },
  { id: 'fog', label: 'Fog reveal / conceal', key: 'F', icon: Eye, gm: true },
  { id: 'draw', label: 'Freehand drawing', key: 'D', icon: Pencil, gm: true },
  { id: 'text', label: 'Text annotation', key: 'T', icon: Type, gm: true },
];
export function App() {
  const s = useTable(),
    scene = s.room.scenes[s.room.activeSceneId],
    gm = s.self?.role === 'gm';
  const [library, setLibrary] = useState(true);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.has('room')) useTable.getState().set({ dialog: 'launch' });
  }, []);
  useEffect(() => {
    if (s.error) {
      const timer = setTimeout(() => s.set({ error: null }), 7000);
      return () => clearTimeout(timer);
    }
  }, [s.error, s.set]);
  return (
    <div
      className={`app ${library ? '' : 'library-collapsed'}`}
      onPointerDown={() => {
        if (s.sound) unlockSound();
      }}
    >
      <header className="app-header">
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="Aether Table home">
          <img src={`${import.meta.env.BASE_URL}assets/sigil.svg`} alt="" />
          <span>
            AETHER<span className="brand-small">TABLE</span>
          </span>
        </a>
        <div className="campaign-title">
          <span className="campaign-icon">
            <Compass size={17} />
          </span>
          <span>
            {s.room.name}
            <small>
              {s.self
                ? `${s.self.role === 'gm' ? 'Game master' : 'Player'} · ${s.self.name}`
                : 'A shared canvas for your imagination'}
            </small>
          </span>
          <button
            aria-label="Open another campaign"
            title="Open another campaign"
            onClick={() => s.set({ dialog: 'launch' })}
          >
            <ChevronDown size={15} />
          </button>
        </div>
        <div className="header-actions">
          <span className={`connection ${s.status}`}>
            <span />
            {s.status === 'live'
              ? 'LIVE SESSION'
              : s.status === 'reconnecting'
                ? 'RECONNECTING'
                : s.status === 'connecting'
                  ? 'CONNECTING'
                  : 'DEMO PREVIEW'}
          </span>
          {s.self && (
            <div className="party-avatars">
              {s.presence.slice(0, 4).map((p) => (
                <span key={p.id} title={`${p.name} · ${p.role}`} style={{ borderColor: p.color }}>
                  {p.name[0].toUpperCase()}
                </span>
              ))}
            </div>
          )}
          <button
            className="invite-button"
            onClick={() => s.set({ dialog: s.self ? 'invite' : 'launch' })}
          >
            <Users size={15} />
            <span>{gm ? 'Invite party' : s.self ? 'Your party' : 'Gather your party'}</span>
            <ArrowUpRight size={14} />
          </button>
          <HistoryControls />
          <button
            className="icon-button"
            aria-label="Settings"
            onClick={() => s.set({ dialog: 'settings' })}
          >
            <Settings2 size={19} />
          </button>
        </div>
      </header>
      <aside className="tool-rail">
        <button
          className={`rail-button ${library ? 'active' : ''}`}
          title="Scene & token library"
          aria-label="Toggle library"
          onClick={() =>
            window.innerWidth <= 900 ? s.set({ dialog: 'library' }) : setLibrary(!library)
          }
        >
          <Layers size={21} />
        </button>
        <div className="rail-divider" />
        {tools
          .filter((t) => !t.gm || gm || !s.self)
          .map((t) => (
            <button
              key={t.id}
              className={`rail-button ${s.tool === t.id ? 'active' : ''}`}
              title={`${t.label} (${t.key})`}
              aria-label={t.label}
              onClick={() => s.set({ tool: t.id })}
            >
              <t.icon size={20} />
              <span className="tool-tooltip">
                {t.label}
                <kbd>{t.key}</kbd>
              </span>
            </button>
          ))}
        <div className="rail-spacer" />
        <button
          className="rail-button"
          title="Configure grid"
          aria-label="Configure grid"
          onClick={() => s.set({ dialog: 'grid' })}
        >
          <Grid3X3 size={20} />
        </button>
        <button
          className="rail-button"
          title="Tabletop guide"
          aria-label="Tabletop guide"
          onClick={() => s.set({ dialog: 'help' })}
        >
          <HelpCircle size={20} />
        </button>
      </aside>
      {library && (
        <aside className="library">
          <div className="panel-heading">
            <span className="eyebrow">YOUR WORLD</span>
            <button
              aria-label="Scene settings"
              title="Scene settings"
              onClick={() => s.set({ dialog: 'map' })}
            >
              <SlidersHorizontal size={15} />
            </button>
          </div>
          <div className="section-heading">
            <h2>
              Scenes <span>{Object.keys(s.room.scenes).length.toString().padStart(2, '0')}</span>
            </h2>
            {(gm || !s.self) && (
              <button
                aria-label="Add a map from URL"
                title="Add a map from URL"
                onClick={() => s.set({ dialog: 'map' })}
              >
                <Plus size={16} />
              </button>
            )}
          </div>
          <div className="scene-list">
            {Object.values(s.room.scenes).map((sc) => (
              <button
                key={sc.id}
                className={`scene-card ${scene.id === sc.id ? 'selected' : ''}`}
                onClick={() => {
                  if (gm) send({ type: 'SCENE_CHANGE', sceneId: sc.id });
                  else if (!s.self)
                    s.set({ room: { ...s.room, activeSceneId: sc.id }, fitNonce: s.fitNonce + 1 });
                }}
                disabled={!!s.self && !gm && sc.id !== scene.id}
              >
                <div className="scene-thumb">
                  <AssetImage asset={sc.map} referrerPolicy="no-referrer" alt="" />
                  {scene.id === sc.id && <span>ACTIVE SCENE</span>}
                </div>
                <div className="scene-card-caption">
                  <span>{sc.name}</span>
                  {scene.id === sc.id ? (
                    <span className="scene-active-dot" />
                  ) : (
                    <ChevronRight size={13} />
                  )}
                </div>
              </button>
            ))}
          </div>
          <button className="subtle-button add-map" onClick={() => s.set({ dialog: 'map' })}>
            <Link2 size={14} />
            {gm ? 'Add or replace a map' : 'Map details'}
          </button>
          <div className="library-divider" />
          <div className="section-heading">
            <h2>
              On the table{' '}
              <span>{Object.keys(scene.tokens).length.toString().padStart(2, '0')}</span>
            </h2>
            {gm && (
              <button
                aria-label="Add token"
                title="Add token"
                onClick={() => s.set({ selected: null, dialog: 'token' })}
              >
                <Plus size={16} />
              </button>
            )}
          </div>
          <div className="token-list">
            {Object.values(scene.tokens).map((t) => (
              <button
                key={t.id}
                className={`token-list-item ${s.selected === t.id ? 'selected' : ''}`}
                onClick={() => s.set({ selected: t.id, selectedIds: [t.id], tool: 'select' })}
              >
                <AssetImage
                  asset={t.image}
                  referrerPolicy="no-referrer"
                  alt=""
                  style={{ borderColor: t.color }}
                />
                <span>
                  {t.name.split(' · ')[0]}
                  <small>
                    {t.visibility === 'gm' ? 'GM only' : t.name.split(' · ')[1] || 'Scene token'}
                  </small>
                </span>
                {t.visibility === 'gm' ? (
                  <Lock size={12} />
                ) : (
                  <span className="token-dot" style={{ background: t.color }} />
                )}
              </button>
            ))}
          </div>
          {gm && (
            <button
              className="subtle-button"
              onClick={() => s.set({ selected: null, dialog: 'token' })}
            >
              <Plus size={14} />
              Bring a character to life
            </button>
          )}
          <div className="library-actions">
            <button className="subtle-button" onClick={() => s.set({ dialog: 'library' })}>
              <FolderOpen size={14} />
              Saved token library
            </button>
            {gm && (
              <button className="subtle-button" onClick={() => s.set({ dialog: 'assets' })}>
                <ImageIcon size={14} />
                Manage images
              </button>
            )}
            <button className="subtle-button" onClick={() => s.set({ dialog: 'objects' })}>
              <Layers size={14} />
              Regions & drawing layers
            </button>
          </div>
          <div className="library-bottom">
            <span className="ornament">✧</span>
            <p>
              Every great adventure
              <br />
              begins with a shared table.
            </p>
            <span>AETHER TABLE · V0.3</span>
          </div>
        </aside>
      )}
      <main className="table-area">
        <Tabletop />
        {!!s.sceneTransition && !s.reducedMotion && (
          <div key={s.sceneTransition} className="scene-transition" aria-hidden="true">
            <span className="eyebrow">A NEW CHAPTER</span>
            <strong>{scene.name}</strong>
            <span>✧</span>
          </div>
        )}
        {s.presentation && <RollPresentation key={s.presentation.id} roll={s.presentation} />}
        <div className="scene-options">
          <button
            title="Map settings"
            aria-label="Map settings"
            onClick={() => s.set({ dialog: 'map' })}
          >
            <Map size={15} />
          </button>
          {gm && (
            <button
              className={scene.fog.enabled ? 'enabled' : ''}
              title={scene.fog.enabled ? 'Clear all fog' : 'Cover scene with fog'}
              aria-label={scene.fog.enabled ? 'Clear all fog' : 'Cover scene with fog'}
              onClick={() =>
                send({
                  type: 'FOG_UPDATE',
                  sceneId: scene.id,
                  fog: { enabled: !scene.fog.enabled, revealed: [] },
                })
              }
            >
              <Eye size={16} />
            </button>
          )}
          <button
            title="Grid settings"
            aria-label="Grid settings"
            onClick={() => s.set({ dialog: 'grid' })}
          >
            <Grid3X3 size={15} />
          </button>
        </div>
      </main>
      <Chronicle />
      <footer className="status-bar">
        <span>
          <span className="tiny-sigil">✧</span> ANY SYSTEM. YOUR STORY.
        </span>
        <span className="save-status">
          {s.status === 'live' ? <Cloud size={12} /> : <WifiOff size={12} />}{' '}
          {s.status === 'live'
            ? s.room.savedAt
              ? 'Last snapshot ' +
                new Date(s.room.savedAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : 'Waiting for snapshot'
            : s.status === 'offline'
              ? 'Local demo · start a table to play'
              : 'Reconnecting to your table'}
          <i />
          Rev {s.room.revision}
        </span>
        <span>
          <Shield size={11} /> {s.self?.role === 'gm' ? 'GAME MASTER' : s.self ? 'PLAYER' : 'DEMO'}{' '}
          <i />
          {s.status === 'live' ? <Wifi size={11} /> : <span>◇</span>}
        </span>
      </footer>
      {s.error && (
        <div className="toast" role="alert">
          <span>{s.error}</span>
          <button aria-label="Dismiss notification" onClick={() => s.set({ error: null })}>
            <X size={16} />
          </button>
        </div>
      )}
      <Dialogs />
    </div>
  );
}
function Chronicle() {
  const s = useTable();
  const [expression, setExpression] = useState('1d20 + 5 - 2'),
    [privateRoll, setPrivate] = useState(false),
    [chat, setChat] = useState(''),
    [pending, setPending] = useState(false),
    [presets, setPresets] = useState<string[]>(() => {
      try {
        return JSON.parse(localStorage.getItem('aether-presets') || '["1d20 + 5","2d6","1d100"]');
      } catch {
        return [];
      }
    });
  useEffect(() => {
    if (pending) {
      const timer = setTimeout(() => setPending(false), 900);
      return () => clearTimeout(timer);
    }
  }, [pending]);
  const roll = () => {
    if (!s.self) {
      s.set({ dialog: 'launch' });
      return;
    }
    try {
      parseDice(expression);
      if (
        send({
          type: 'DICE_ROLL_REQUEST',
          expression,
          visibility: privateRoll ? 'private' : 'public',
        })
      )
        setPending(true);
    } catch (e) {
      s.set({ error: e instanceof Error ? e.message : 'Invalid expression.' });
    }
  };
  return (
    <aside className="chronicle">
      <div className="chronicle-tabs">
        <button
          className={s.panel === 'chronicle' ? 'active' : ''}
          onClick={() => s.set({ panel: 'chronicle' })}
        >
          <Sparkles size={15} />
          Chronicle
        </button>
        <button
          className={s.panel === 'chat' ? 'active' : ''}
          onClick={() => s.set({ panel: 'chat' })}
        >
          <MessageSquare size={15} />
          Party chat
        </button>
        <button
          className={s.panel === 'tracker' ? 'active' : ''}
          onClick={() => s.set({ panel: 'tracker' })}
        >
          <Flag size={13} />
          Turns
        </button>
      </div>
      <div className="activity-panel">
        {s.panel === 'tracker' ? (
          <TrackerPanel />
        ) : s.panel === 'chronicle' ? (
          <>
            <div className="activity-heading">
              <span className="eyebrow">THE STORY SO FAR</span>
              <span>{s.room.rolls.length} rolls</span>
            </div>
            {!s.room.rolls.length ? (
              <div className="empty-chronicle">
                <span className="empty-orbit">
                  <span>✧</span>
                </span>
                <h3>Fate is waiting.</h3>
                <p>
                  Your party’s rolls appear here.
                  <br />A little chance, a little magic.
                </p>
                <div className="empty-line" />
              </div>
            ) : (
              <div className="roll-history">
                {[...s.room.rolls].reverse().map((r) => (
                  <button
                    className="history-card"
                    key={r.id}
                    onClick={() => s.set({ presentation: r, rollQueue: [] })}
                  >
                    <span className="history-user">
                      <span>{r.userName}</span>
                      <small>
                        {r.visibility === 'private' && <Lock size={10} />}{' '}
                        {new Date(r.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </small>
                    </span>
                    <span className="history-result">
                      <span>
                        <span className="history-expression">{r.expression}</span>
                        <small>
                          {r.terms
                            .map((t) => (t.kind === 'dice' ? t.values.join(' + ') : t.label))
                            .join(' · ')}
                        </small>
                      </span>
                      <strong>{r.total}</strong>
                    </span>
                    <span className="history-footer">
                      {r.visibility === 'private' ? 'Private · you & GM' : 'Shared with the party'}
                      <ArrowUpRight size={11} />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="activity-heading">
              <span className="eyebrow">AROUND THE TABLE</span>
              <Users size={14} />
            </div>
            <div className="chat-messages">
              {!s.room.chat.length && (
                <div className="empty-chronicle">
                  <MessageSquare size={30} />
                  <h3>A story told together.</h3>
                  <p>Say hello to your party.</p>
                </div>
              )}
              {s.room.chat.map((c) => (
                <div key={c.id} className={`chat-message ${c.userId === s.self?.id ? 'own' : ''}`}>
                  <span>
                    {c.userName}
                    <small>
                      {new Date(c.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </small>
                  </span>
                  <p>{c.text}</p>
                </div>
              ))}
            </div>
            <form
              className="chat-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!s.self) {
                  s.set({ dialog: 'launch' });
                  return;
                }
                if (chat.trim()) {
                  send({ type: 'CHAT_SEND', text: chat });
                  setChat('');
                }
              }}
            >
              <input
                aria-label="Message your party"
                placeholder="Message your party…"
                value={chat}
                onChange={(e) => setChat(e.target.value)}
                maxLength={1000}
              />
              <button aria-label="Send message">
                <ArrowUpRight size={17} />
              </button>
            </form>
          </>
        )}
      </div>
      <div className="dice-workbench">
        <div className="section-heading">
          <h2>
            Let fate decide <span>✧</span>
          </h2>
          <button
            title="Dice presentation settings"
            aria-label="Dice presentation settings"
            onClick={() => s.set({ dialog: 'settings' })}
          >
            <Settings2 size={15} />
          </button>
        </div>
        <div className="dice-types">
          {[4, 6, 8, 10, 12, 20, 100].map((n) => (
            <button
              key={n}
              aria-label={`Select d${n}`}
              className={expression.replace(/\s/g, '').startsWith(`1d${n}`) ? 'selected' : ''}
              onClick={() => setExpression(`1d${n}`)}
            >
              <span className={`die-icon die-${n}`}>{n === 100 ? '%' : n}</span>
              <small>d{n === 100 ? '%' : n}</small>
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            roll();
          }}
        >
          <label className="expression-label" htmlFor="dice-expression">
            DICE EXPRESSION
            <button
              type="button"
              title="Save this roll preset"
              aria-label="Save roll preset"
              onClick={() => {
                try {
                  parseDice(expression);
                  const next = [...new Set([...presets, expression])].slice(-6);
                  setPresets(next);
                  localStorage.setItem('aether-presets', JSON.stringify(next));
                  s.set({ error: 'Roll preset saved.' });
                } catch (e) {
                  s.set({ error: (e as Error).message });
                }
              }}
            >
              <Star size={12} />
            </button>
          </label>
          <div className="expression-input">
            <span>◇</span>
            <input
              id="dice-expression"
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
              maxLength={120}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              aria-label="Expression help"
              onClick={() => s.set({ dialog: 'help' })}
            >
              <HelpCircle size={14} />
            </button>
          </div>
          <div className="roll-options">
            <button
              type="button"
              className={privateRoll ? 'enabled' : ''}
              onClick={() => setPrivate(!privateRoll)}
            >
              {privateRoll ? <Lock size={12} /> : <Users size={12} />}{' '}
              {privateRoll ? 'Private · you & GM' : 'Share with party'}
              <ChevronDown size={12} />
            </button>
            <button
              type="button"
              title={s.sound ? 'Mute roll sound' : 'Enable roll sound'}
              aria-label={s.sound ? 'Mute roll sound' : 'Enable roll sound'}
              onClick={() => {
                unlockSound();
                s.set({ sound: !s.sound });
              }}
            >
              {s.sound ? <Volume2 size={14} /> : <VolumeX size={14} />}
            </button>
          </div>
          <button
            className="roll-button"
            disabled={pending || s.status === 'reconnecting' || s.status === 'connecting'}
          >
            <Sparkles size={17} />
            {pending ? 'Casting the dice…' : 'Roll the dice'}
            <kbd>↵</kbd>
          </button>
        </form>
        <div className="presets">
          <span>QUICK ROLLS</span>
          <div>
            {presets.map((p) => (
              <button key={p} title={`Use ${p}`} onClick={() => setExpression(p)}>
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="dice-note">
          <Check size={11} /> Fair rolls. Shared outcomes. A little wonder.
        </div>
      </div>
    </aside>
  );
}
export { inviteUrl };
