import { FogActions } from './components/FogActions.js';
import { CharacterList, FirstUseGuide, TurnAwareness } from './components/TableAwareness.js';
import { DiceWorkbench } from './components/DiceWorkbench.js';
import {
  CharacterNavigation,
  CharacterWorkspace,
  CharacterActionDetails,
  openCharacter,
} from './components/Characters.js';
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
  MousePointer2,
  Move,
  Plus,
  Ruler,
  RotateCcw,
  Feather,
  Settings2,
  Sparkles,
  Square,
  Users,
  X,
  Pencil,
  Eraser,
  Type,
  Flag,
  FolderOpen,
  BookOpen,
  Dices,
  Image as ImageIcon,
} from 'lucide-react';
import { useTable } from './store.js';
import { inviteUrl, launchDemo, liveAvailable, send } from './connection.js';
import { AssetImage } from './assets.js';
import { HistoryControls, TrackerPanel } from './components/Workshop.js';
import { formatRollValues } from '../shared/dice.js';
import { Tabletop } from './components/Tabletop.js';
import { RollPresentation } from './components/RollPresentation.js';
import { Dialogs } from './components/Dialogs.js';
import { MacroResults } from './components/Macros.js';
import { DiscordShare } from './components/DiscordSettings.js';
import type { Tool } from './store.js';
import { unlockSound } from './sound.js';
import { useMediaQuery } from './useMediaQuery.js';
import { useActivityFocus } from './useActivityFocus.js';

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
  const [library, setLibrary] = useState(false);
  const singlePanel = useMediaQuery('(max-width: 1199px)');
  useEffect(() => {
    if (singlePanel && s.activityOpen) setLibrary(false);
  }, [singlePanel, s.activityOpen]);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.has('room')) useTable.getState().set({ dialog: 'launch' });
  }, []);
  useEffect(() => {
    const restore = (event: KeyboardEvent) => {
      const state = useTable.getState();
      if (event.defaultPrevented || event.key !== 'Escape' || state.dialog) return;
      if (state.focusTable) state.set({ focusTable: false });
      else if (state.activityOpen) state.set({ activityOpen: false });
      else setLibrary(false);
    };
    window.addEventListener('keydown', restore);
    return () => window.removeEventListener('keydown', restore);
  }, []);
  useEffect(() => {
    if (s.error) {
      const timer = setTimeout(() => s.set({ error: null }), 7000);
      return () => clearTimeout(timer);
    }
  }, [s.error, s.set]);
  return (
    <div
      className={`app ${library ? '' : 'library-collapsed'} ${s.self?.role === 'player' ? 'is-player' : ''} ${s.focusTable ? 'table-focused' : ''} ${s.activityOpen ? '' : 'activity-collapsed'}`}
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
          <span className={`connection ${s.status}`}>
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
          <span className="save-status" role="status">
            {s.status === 'demo' ? (
              'Demo · changes stay in this session'
            ) : s.self ? (
              <>
                {s.room.savedAt
                  ? `Last saved ${new Date(s.room.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
                  : 'No successful save reported'}
                <small>
                  {s.status !== 'live'
                    ? 'Save status unconfirmed'
                    : s.savedRevision === null
                      ? 'Waiting for save status'
                      : s.pendingDurableActions ||
                          s.savePending ||
                          s.savedRevision < s.room.revision
                        ? 'Newer changes awaiting save'
                        : 'Saved to storage'}
                </small>
              </>
            ) : (
              ''
            )}
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
          className={`rail-button workspace-button ${library && !s.focusTable ? 'active' : ''}`}
          title="Scene & token library"
          aria-label="Toggle library"
          aria-pressed={library && !s.focusTable}
          onClick={() => {
            s.set({ focusTable: false });
            if (window.innerWidth <= 1000) s.set({ dialog: 'library' });
            else {
              if (singlePanel) s.set({ activityOpen: false });
              setLibrary(!library);
            }
          }}
        >
          <Layers size={21} />
          <span className="rail-caption">Library</span>
        </button>
        {s.self && (
          <button
            className={`rail-button workspace-button ${s.activityOpen && s.panel === 'character' ? 'active' : ''}`}
            aria-label="Character sheets"
            title="Character sheets, resources & abilities"
            onClick={() => openCharacter(s.characterId)}
          >
            <BookOpen size={21} />
            <span className="rail-caption">Sheet</span>
          </button>
        )}
        {s.self && (
          <button
            className={`rail-button workspace-button ${s.activityOpen && s.panel === 'chronicle' ? 'active' : ''}`}
            aria-label="Dice & macros"
            title="Dice & macros"
            onClick={() => s.set({ panel: 'chronicle', activityOpen: true, focusTable: false })}
          >
            <Dices size={21} />
            <span className="rail-caption">Dice</span>
          </button>
        )}
        {s.self && (
          <button
            className={`rail-button workspace-button ${s.activityOpen && s.panel === 'tracker' ? 'active' : ''}`}
            aria-label="Turn tracker"
            title="Turn tracker"
            onClick={() => s.set({ panel: 'tracker', activityOpen: true, focusTable: false })}
          >
            <Flag size={21} />
            <span className="rail-caption">Turns</span>
          </button>
        )}
        <div className="rail-divider" />
        {tools
          .filter((t) => !t.gm || gm || !s.self)
          .map((t) => (
            <button
              key={t.id}
              className={`rail-button ${s.tool === t.id ? 'active' : ''}`}
              title={`${t.label} (${t.key})`}
              aria-label={t.label}
              aria-pressed={s.tool === t.id}
              onClick={() => s.set({ tool: t.id })}
            >
              <t.icon size={20} />
              <span className="rail-caption">
                {
                  {
                    select: 'Move',
                    pan: 'Pan',
                    measure: 'Ruler',
                    ping: 'Ping',
                    zone: 'Areas',
                    fog: 'Fog',
                    draw: 'Draw',
                    text: 'Text',
                    erase: 'Erase',
                  }[t.id]
                }
              </span>
              <span className="tool-tooltip">
                {t.label}
                <kbd>{t.key}</kbd>
              </span>
            </button>
          ))}
        <div className="rail-spacer" />
        {(gm || !s.self) && (
          <button
            className="rail-button"
            title="Configure grid"
            aria-label="Configure grid"
            onClick={() => s.set({ dialog: 'grid' })}
          >
            <Grid3X3 size={20} />
            <span className="rail-caption">Grid</span>
          </button>
        )}
        <button
          className="rail-button"
          title="Tabletop guide"
          aria-label="Tabletop guide"
          onClick={() => s.set({ dialog: 'help' })}
        >
          <HelpCircle size={20} />
          <span className="rail-caption">Guide</span>
        </button>
      </aside>
      {library && (
        <aside className="library">
          <CharacterNavigation />
          <div className="section-heading">
            <h2>Scenes</h2>
            <button
              aria-label="Close library"
              title="Close library"
              onClick={() => setLibrary(false)}
            >
              <X size={16} />
            </button>
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
            <h2>Scene tokens</h2>
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
          <CharacterList />
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
        <div className="table-awareness">
          {s.self && <TurnAwareness />}
          <FirstUseGuide />
          {(s.status === 'reconnecting' || s.status === 'connecting') && (
            <p className="connection-guidance" role="status">
              {s.status === 'reconnecting'
                ? 'Connection interrupted. Reconnecting automatically; wait for Live, then check the table before retrying an unconfirmed action.'
                : 'Connecting to the table. Your last successful save is shown separately.'}
            </p>
          )}
        </div>
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
            title={gm || !s.self ? 'Map settings' : 'Scene details'}
            aria-label={gm || !s.self ? 'Map settings' : 'Scene details'}
            onClick={() => s.set({ dialog: 'map' })}
          >
            <Map size={15} />
            {s.self && !gm && <span>Scene details</span>}
          </button>
          <FogActions />
          {(gm || !s.self) && (
            <button
              title="Grid settings"
              aria-label="Grid settings"
              onClick={() => s.set({ dialog: 'grid' })}
            >
              <Grid3X3 size={15} />
            </button>
          )}
        </div>
      </main>
      <Chronicle key={`${s.room.id}:${s.self?.id}:${s.self?.role}:${s.sessionNonce}`} />
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
  const compact = useMediaQuery('(max-width: 1000px)');
  const ref = useActivityFocus(s.activityOpen && !s.focusTable, compact);
  return (
    <aside
      ref={ref}
      className={`chronicle ${s.activityOpen ? 'drawer-open' : ''} ${s.panel === 'character' ? 'sheet-view' : ''} ${s.panel === 'chronicle' ? 'dice-view' : ''}`}
      hidden={!s.activityOpen || s.focusTable}
      aria-label="Table activity"
    >
      <div className="activity-header">
        <strong>Table tools</strong>
        <button
          aria-label="Back to map"
          title="Close table activity (Escape)"
          onClick={() => s.set({ activityOpen: false })}
        >
          <X size={18} />
          <span>Back to map</span>
        </button>
      </div>
      <div
        className="chronicle-tabs"
        role="group"
        aria-label="Table activity"
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          const buttons = [...event.currentTarget.querySelectorAll('button')];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (index < 0) return;
          event.preventDefault();
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next].click();
          buttons[next].focus();
        }}
      >
        <button
          aria-pressed={s.panel === 'character'}
          aria-controls="table-activity"
          className={s.panel === 'character' ? 'active' : ''}
          onClick={() => s.set({ panel: 'character' })}
        >
          Character
        </button>
        <button
          aria-pressed={s.panel === 'chronicle'}
          aria-controls="table-activity"
          className={s.panel === 'chronicle' ? 'active' : ''}
          onClick={() => s.set({ panel: 'chronicle' })}
        >
          <Sparkles size={15} />
          Dice &amp; history
        </button>
        <button
          aria-pressed={s.panel === 'tracker'}
          aria-controls="table-activity"
          className={s.panel === 'tracker' ? 'active' : ''}
          onClick={() => s.set({ panel: 'tracker' })}
        >
          <Flag size={13} />
          Turns
        </button>
      </div>
      <div className="activity-panel" id="table-activity">
        {s.panel === 'character' ? (
          <CharacterWorkspace />
        ) : s.panel === 'tracker' ? (
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
                      onClick={() =>
                        s.set({
                          presentation: r,
                          rollQueue: [],
                          activityOpen: window.innerWidth <= 1000 ? false : s.activityOpen,
                        })
                      }
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
                      <CharacterActionDetails roll={r} />
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
        ) : null}
      </div>
      <DiceWorkbench />
    </aside>
  );
}
export { inviteUrl };
