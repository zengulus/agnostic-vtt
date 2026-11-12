import { useTable } from '../store.js';
import { useConfirmedAction } from '../useConfirmedAction.js';

export function ScenePresentation() {
  const s = useTable(),
    sceneAction = useConfirmedAction();
  if (s.self?.role !== 'gm') return null;
  return (
    <>
      <details className="scene-presentation-settings">
        <summary>Scene presentation</summary>
        <label>
          Effect{' '}
          <select
            value={s.transitionSettings.style}
            onChange={(e) =>
              s.set({
                transitionSettings: {
                  ...s.transitionSettings,
                  style: e.target.value as typeof s.transitionSettings.style,
                },
              })
            }
          >
            <option value="chapter">Chapter reveal</option>
            <option value="fade">Fade</option>
            <option value="curtain">Curtain</option>
            <option value="flash">Flash</option>
            <option value="none">Immediate</option>
          </select>
        </label>
        <label>
          Title{' '}
          <input
            placeholder="Scene name"
            maxLength={80}
            value={s.transitionSettings.title}
            onChange={(e) =>
              s.set({
                transitionSettings: { ...s.transitionSettings, title: e.target.value },
              })
            }
          />
        </label>
        <label>
          Subtitle{' '}
          <input
            maxLength={100}
            value={s.transitionSettings.subtitle}
            onChange={(e) =>
              s.set({
                transitionSettings: { ...s.transitionSettings, subtitle: e.target.value },
              })
            }
          />
        </label>
        <label>
          Duration{' '}
          <select
            value={s.transitionSettings.duration}
            onChange={(e) =>
              s.set({
                transitionSettings: {
                  ...s.transitionSettings,
                  duration: Number(e.target.value),
                },
              })
            }
          >
            <option value={800}>Short</option>
            <option value={1800}>Medium</option>
            <option value={3500}>Long</option>
            <option value={6000}>Epic</option>
          </select>
        </label>
        <label>
          Backdrop{' '}
          <input
            type="color"
            value={s.transitionSettings.color}
            onChange={(e) =>
              s.set({
                transitionSettings: { ...s.transitionSettings, color: e.target.value },
              })
            }
          />
        </label>
        <p>Opening a GM-only scene reveals it to the table.</p>
        {Object.values(s.room.scenes)
          .filter((sc) => sc.id !== s.room.activeSceneId)
          .map((sc) => (
            <div key={sc.id}>
              <button
                type="button"
                onClick={() =>
                  s.set({
                    viewSceneId: sc.id,
                    selected: null,
                    selectedIds: [],
                    selectedPin: null,
                    pinDraftPoint: null,
                    previews: {},
                    fitNonce: s.fitNonce + 1,
                    ...(s.dialog === 'library' ? { dialog: null } : {}),
                  })
                }
              >
                Prepare {sc.name}
              </button>
              <button
                type="button"
                disabled={!!sceneAction.pending}
                onClick={() =>
                  void sceneAction.run(
                    {
                      type: 'SCENE_VISIBILITY',
                      sceneId: sc.id,
                      visibility: sc.visibility === 'gm' ? 'public' : 'gm',
                    },
                    'Updating scene visibility…',
                  )
                }
              >
                {sc.visibility === 'gm' ? 'Reveal' : 'Hide'} {sc.name}
              </button>
            </div>
          ))}
      </details>
      {sceneAction.pending && <p role="status">{sceneAction.pending}</p>}
      {sceneAction.error && <p role="alert">{sceneAction.error}</p>}
    </>
  );
}
