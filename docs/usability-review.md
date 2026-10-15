# Tabletop usability review

## Character and session workflow review — 16 October 2026

The review covers entering a table, finding a character, manipulating scene tokens, choosing an action, consuming resources, recovering abilities, reading results, and sharing them with Discord. The previous typography pass helped legibility but left the core player workflow split across map tools, generic dice, macros and isolated token counters.

| Finding                                                                  | Impact                                                                                | Change                                                                                                                                                                              |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Characters were represented primarily as scene tokens.                   | Resource state and available actions had no persistent home across scenes.            | Campaign character sheets have a dedicated workspace, navigation cards, ownership and optional token links.                                                                         |
| Macros and counters were separate operations.                            | Players could forget to spend a slot or spend a resource without a successful action. | Ability use validates preparation, remaining uses, costs and numeric inputs before committing the resource change and result together.                                              |
| Prepared, expended and recoverable abilities were not represented.       | Maneuvers and prepared spells required external bookkeeping.                          | Named ability groups show readiness and remaining uses, with preparation controls, search, availability filters and explicit recovery groups.                                       |
| Character controls, history and dice competed for the same narrow panel. | A sheet would leave little room for its actions.                                      | Character is a separate activity workspace; its panel uses the full available height instead of sharing it with the dice workbench.                                                 |
| Map tools relied on icon recognition.                                    | Common tools were hard to discover without hovering.                                  | Desktop tools have persistent captions and shortcuts remain available. Phone tools keep compact accessible names.                                                                   |
| GM scene/grid editing entry points appeared in player mode.              | Players encountered controls they could not save.                                     | Player mode omits grid-editing entry points and names its read-only map entry Scene details. Characters have more prominence than scene thumbnails.                                 |
| Onboarding covered the map, especially on phones.                        | Guidance blocked the space needed to play.                                            | The guide is collapsible and starts collapsed on compact layouts. It explains character abilities as well as token movement.                                                        |
| A phone drawer covered map dice presentations.                           | A character action could hide its own result and dismiss control.                     | Phone character actions report results beside the ability; explicit history replay closes the drawer to show its map presentation.                                                  |
| Sending an ability to Discord lacked character/resource context.         | Channel readers could see a roll without knowing the spent ability or remaining uses. | Public character results include their name, effect, uses and spent-pool state through the existing Discord settings. Text-only abilities can announce effects without a fake roll. |
| Text replacement could overwrite live resource use.                      | Reimporting a sheet could silently restore spent slots.                               | Replacement and deletion compare the reviewed sheet digest. Export includes current counters; stale drafts remain available for review.                                             |

The [example character](../public/examples/character.txt) is a reusable text template rather than a game-specific sheet. Its recovery tags are deliberately explicit: a table decides when Recovery, Encounter or Rest applies. Public sheets are readable by the party; only their owner and GMs can use or edit them. Resource spending, privacy projection, restart deduplication and Discord formatting run through the same shared action pipeline in live play and the offline demo.

Remaining design work: the map/scene and token editors still expose large forms; staged setup would help new GMs. Character definitions are edited through text rather than a visual ability builder, and token resource bars are separate from sheet pools. Those boundaries are visible in the UI and documentation. Broad keyboard/screen-reader auditing and full touch-device testing remain useful follow-up work beyond Chromium viewport checks.

Verification for this change: 390 unit/server tests pass, including character parsing, atomic costs, ownership and visibility, stale replacements, restart recovery, duplicate requests and Undo/Redo without another roll or Discord delivery. All 68 browser scenarios pass across suite runs. The combined run hit the existing shared-server HTTP request limit; affected suites were verified with fresh servers, matching CI. The character suite is included in the CI matrix.

The production frontend/server build passes under `/agnostic-vtt/`, as do the cloud-blocked static-demo and mocked hosted-entry checks. The visual review captures 64 screens at six viewport sizes; reviewed panels fit their viewports with no browser or network errors. Discord delivery was tested with a mocked transport; no live channel was contacted.

## Earlier implementation review

Reviewed baseline: `b6d3f79596dc10319e0042cb9698b48c5e0dd25a`. The remote matched that commit and had no open pull requests when work began.

## Behavior

- Favorites appear as named actions beside Dice. Actions without variables roll immediately; other actions prompt inline and remember numeric inputs. Manage macros retains editing/importing and Favorites/Recent. Private definitions default to private results in the strip. Changed or removed definitions invalidate open prompts.
- Assigned and shared characters appear first, with explicit control labels and Center controls. The compact library also lists scene characters. An empty assignment message and a dismissible, role-aware introduction explain finding, moving and rolling. Dismissal and dice preferences remain local.
- Current / Up next stays on the tabletop. Tracker editing preserves `tokenId`; selected tokens can be linked individually or added together after reviewing visibility. Your turn follows control ownership. Focus controls use visible tokens. Server projections omit entries linked to hidden or fog-covered tokens and omit successor hints when the immediate successor is hidden; fog, visibility changes and undo update those projections.
- Grid settings include an isolated map preview, origin dragging, two-click calibration, preview zoom and panning. Square calibration uses adjacent intersections; pointy-top hex calibration uses neighbouring centres in a horizontal row. Numeric inputs remain available. Preview/cancel sends nothing; each Save sends one `GRID_UPDATE`. Pending saves lock all controls and rejected saves retain the draft.
- Campaign images reuses projected asset metadata and existing scene/template references. Thumbnails load in pages of twelve and use the existing asset cache. Upload and URL remain available; choosing an existing image sends its reference without another upload.
- Save preset remains visible. Dice presentation preferences sit beside the controls. Arrow keys move selected controllable tokens by a grid cell, a neighbouring hex centre, or ten map pixels when snapping is off. Inputs, dialogs and other interactive controls retain their keys. The selected token has a textual position/control status; phones can expand Character controls for resources and GM actions.
- Live connection state and durable save state are separate. Last saved follows successful `SAVED` events and authoritative reconnect snapshots. Revision comparisons, outstanding actions and the existing server dirty flag prevent newer changes from being described as saved, including configuration edits sharing a gameplay revision. Reconnect guidance asks users to wait and inspect unconfirmed actions.
- Scene fog has separate Reveal entire scene and Cover entire scene actions. Both confirm the visibility/geometry consequences; normal brush operations remain immediate and undoable. The controls explain that fog conceals visually and does not make the shared map image confidential.

## Macro guard compatibility

Replacement requests carry a SHA-256 digest of the reviewed ID, name, source, owner and visibility. The server recomputes it before preparing any import changes. Gameplay revision and legacy `version` fields no longer authorize replacement. Existing snapshots need no rewrite: content determines the guard, and undo restores the matching content. Revision-only replacement frames fail closed; old open clients need the updated frontend before replacing macros against the updated server. The existing 256 KiB UTF-8 frame limit remains enforced.

The regression restores an older snapshot after an edit, makes a different edit at the reused revision, then submits the surviving stale preview. It checks atomic rejection and content restoration through undo. Hash tests compare Unicode, padding boundaries and long inputs with Node's SHA-256; socket tests replace a full library while keeping requests compact.

## Verification

- 363 unit/server tests pass, including real local HTTP/WebSocket authorization, snapshot rollback, linked tracker and asset projections, undo, and saves with newer configuration changes.
- Typechecking and the production frontend/server build pass with the GitHub Pages repository subpath. Vite reports the existing large dice-engine chunk warning.
- All 64 browser scenarios pass across the nine suites, each run with a fresh local backend. The `usability` browser suite is included explicitly in the CI matrix. It covers GM/player roles at desktop and 390 px widths, keyboard exclusions, remembered/favorite/deleted actions, rejected actions, local grid cancellation and update counts, fog confirmations, independent player/GM asset and tracker projections, authorization, reconnects and save status.
- Production static-demo smoke testing passes with cloud requests blocked. The existing mocked hosted-entry check passes; it tests compiled frontend service boundaries.
- Before/after captures were inspected for desktop, phone and grid settings. Chromium runs used the installed Playwright Chromium build (`chromium-1243`) through the repository's existing environment override.

The PostgreSQL migration/concurrent-writer check could not run locally: this environment has no PostgreSQL tools or disposable database. Its existing CI job remains enabled. Live Render/Supabase multiplayer remains unverified; local sockets and mocked hosted login do not establish hosted operation. No infrastructure, credentials, permissions or production settings changed, and nothing was merged or deployed.

## Screenshots

These are independent captures with example rolls. Before images use the reviewed baseline; after images use this implementation.

| View          | Before                                                 | After                                                  |
| ------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| Desktop       | ![Desktop before](images/usability-desktop-before.jpg) | ![Desktop after](images/usability-desktop-after.jpg)   |
| Phone         | ![Phone before](images/usability-phone-before.jpg)     | ![Phone after](images/usability-phone-after.jpg)       |
| Grid settings | ![Grid before](images/usability-grid-before.jpg)       | ![Grid preview after](images/usability-grid-after.jpg) |
