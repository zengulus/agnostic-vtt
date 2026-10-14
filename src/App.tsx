import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Compass,
  Eye,
  Grid3X3,
  HelpCircle,
  Layers,
  Lock,
  Map,
  MessageSquare,
  MousePointer2,
  Move,
  Plus,
  Ruler,
  RotateCcw,
  Feather,
  Settings2,
  Sparkles,
  Square,
  Star,
  Users,
  Volume2,
  VolumeX,
  X,
  Pencil,
  Eraser,
  Type,
  Flag,
  FolderOpen,
  Image as ImageIcon,
} from 'lucide-react';
import { useTable } from './store.js';
import { inviteUrl, launchDemo, liveAvailable, send } from './connection.js';
import { AssetImage } from './assets.js';
import { HistoryControls, TrackerPanel } from './components/Workshop.js';
import { formatRollValues, parseDice } from '../shared/dice.js';
import { Tabletop } from './components/Tabletop.js';
import { RollPresentation } from './components/RollPresentation.js';
import { Dialogs } from './components/Dialogs.js';
import { MacroResults } from './components/Macros.js';
import { DiscordShare } from './components/DiscordSettings.js';
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
  { id: 'erase', label: 'Erase drawings', key: 'E', icon: Eraser, gm: true },
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
          <span>
            {s.room.name}
            <small>
              {s.self
                ? `${s.self.role === 'gm' ? 'Game master' : 'Player'} · ${s.self.name}`
                : 'A new adventure'}
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
          <span
            className={`connection ${s.status}`}
            title={
              s.status === 'demo'
                ? 'Demo changes reset on reload'
                : s.room.savedAt
                  ? `Saved ${new Date(s.room.savedAt).toLocaleTimeString()}`
                  : undefined
            }
          >
            <span />
            {s.status === 'live'
              ? 'Live'
              : s.status === 'reconnecting'
                ? 'Reconnecting'
                : s.status === 'connecting'
                  ? 'Connecting'
                  : s.status === 'demo'
                    ? 'Demo'
                    : ''}
          </span>
          {s.canGM && s.self && (
            <button
              className="role-switch"
              disabled={s.status !== 'live' && s.status !== 'demo'}
              onClick={() => send({ type: 'SESSION_ROLE', role: gm ? 'player' : 'gm' })}
            >
              {gm ? 'Play as player' : 'Return to GM'}
            </button>
          )}
          {s.self && s.status !== 'demo' && (
            <div className="party-avatars">
              {s.presence.slice(0, 4).map((p) => (
                <span key={p.id} title={`${p.name} · ${p.role}`} style={{ borderColor: p.color }}>
                  {p.name[0].toUpperCase()}
                </span>
              ))}
            </div>
          )}
          <button
            className={`invite-button ${s.status === 'demo' ? 'reset-demo' : ''}`}
            aria-label={s.status === 'demo' ? 'Reset demo' : undefined}
            title={s.status === 'demo' ? 'Reset demo' : undefined}
            onClick={() =>
              s.status === 'demo'
                ? launchDemo(s.self?.role)
                : s.set({ dialog: s.self ? 'invite' : 'launch' })
            }
          >
            {s.status === 'demo' ? (
              <RotateCcw size={16} />
            ) : (
              <>
                <Users size={15} />
                <span>{gm ? 'Invite party' : s.self ? 'Your party' : 'Your table'}</span>
              </>
            )}
          </button>
          {s.status === 'demo' && liveAvailable && (
            <button className="role-switch" onClick={() => s.set({ dialog: 'launch' })}>
              Log in
            </button>
          )}
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
          <div className="section-heading">
            <h2>Scenes</h2>
            {(gm || !s.self) && (
              <button
                aria-label="New scene"
                title="New scene"
                onClick={() => s.set({ dialog: 'new-scene' })}
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
          <div className="library-divider" />
          <div className="section-heading">
            <h2>Characters</h2>
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
                  <small>{t.visibility === 'gm' ? 'GM only' : t.name.split(' · ')[1] || ''}</small>
                </span>
                {t.visibility === 'gm' ? (
                  <Lock size={12} />
                ) : (
                  <span className="token-dot" style={{ background: t.color }} />
                )}
              </button>
            ))}
          </div>
          <div className="library-actions">
            <button
              className="subtle-button"
              aria-label="Saved token library"
              onClick={() => s.set({ dialog: 'library' })}
            >
              <FolderOpen size={14} />
              Character library
            </button>
            {gm && (
              <button className="subtle-button" onClick={() => s.set({ dialog: 'assets' })}>
                <ImageIcon size={14} />
                Images
              </button>
            )}
            <button className="subtle-button" onClick={() => s.set({ dialog: 'objects' })}>
              <Layers size={14} />
              Drawings & notes
            </button>
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
    [drawer, setDrawer] = useState(false),
    [pending, setPending] = useState(false),
    [presets, setPresets] = useState<string[]>(() => {
      const defaults = ['1d20 + 5', '2d6', '1d100'];
      try {
        const stored: unknown = JSON.parse(localStorage.getItem('aether-presets') || 'null');
        if (!Array.isArray(stored)) return defaults;
        return [
          ...new Set(
            stored.filter((value): value is string => {
              if (typeof value !== 'string' || value.length > 120) return false;
              try {
                parseDice(value);
                return true;
              } catch {
                return false;
              }
            }),
          ),
        ].slice(-6);
      } catch {
        return defaults;
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
    <aside className={`chronicle ${drawer ? 'drawer-open' : ''}`}>
      <button
        className="mobile-activity-toggle"
        aria-expanded={drawer}
        aria-controls="table-activity"
        onClick={() => setDrawer(!drawer)}
      >
        <MessageSquare size={16} /> {drawer ? 'Close table activity' : 'Chat, turns & history'}
        {drawer ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
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
      <div className="activity-panel" id="table-activity">
        {s.panel === 'tracker' ? (
          <TrackerPanel />
        ) : s.panel === 'chronicle' ? (
          <>
            {!s.room.rolls.length ? (
              <div className="empty-chronicle">
                <Feather size={26} strokeWidth={1} aria-hidden="true" />
                <p>The tale is yet unwritten.</p>
              </div>
            ) : (
              <div className="roll-history">
                {[...s.room.rolls].reverse().map((r) => (
                  <article className="history-card" key={r.id}>
                    <button
                      className="history-replay"
                      aria-label={`Replay ${r.expression}`}
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
                      {r.macro ? (
                        <>
                          <strong className="macro-history-name">{r.macro.name}</strong>
                          <MacroResults result={r.macro} />
                        </>
                      ) : (
                        <span className="history-result">
                          <span>
                            <span className="history-expression">{r.expression}</span>
                            <small>
                              {r.terms
                                .map((t) => (t.kind === 'dice' ? formatRollValues(t) : t.label))
                                .join(' · ')}
                            </small>
                          </span>
                          <strong>{r.total}</strong>
                        </span>
                      )}
                      <span className="history-footer">
                        {r.visibility === 'private' ? 'Private' : 'Party'}
                        <ArrowUpRight size={11} />
                      </span>
                    </button>
                    <DiscordShare roll={r} />
                  </article>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="chat-messages">
              {!s.room.chat.length && (
                <div className="empty-chronicle">
                  <p>A quiet table. Say hello.</p>
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
                  if (send({ type: 'CHAT_SEND', text: chat })) setChat('');
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
        <div className="macro-tools">
          <button aria-label="Macros · import .txt" onClick={() => s.set({ dialog: 'macros' })}>
            <Feather size={13} />
            Macros
          </button>
          {s.discord.canManage && (
            <button onClick={() => s.set({ dialog: 'discord' })}>Discord webhook ↗</button>
          )}
        </div>
        <div className="section-heading">
          <h2>Dice</h2>
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
            <span className="sr-only">Dice expression</span>
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
              {privateRoll ? 'Private' : 'Party'}
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
            aria-label="Roll the dice"
            className="roll-button"
            disabled={pending || s.status === 'reconnecting' || s.status === 'connecting'}
          >
            {pending ? 'Rolling…' : 'Roll'}
          </button>
        </form>
        <div className="presets">
          <div>
            {presets.map((p) => (
              <button key={p} title={`Use ${p}`} onClick={() => setExpression(p)}>
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
export { inviteUrl };
