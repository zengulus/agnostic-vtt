# Aether Table

A playable, system-agnostic fantasy tabletop with Milestones 1–3 implemented. React + strict TypeScript, Canvas 2D, deterministic Three.js/Cannon dice physics, and an authoritative Node WebSocket server. No gameplay database polling or Supabase Realtime.

The interface takes its cues from a campaign atlas: parchment, walnut, faded brass and oxblood ink, with restrained serif headings and a map-first layout.

## GitHub Pages demo — no backend needed

The static frontend includes a playable, browser-only demo. Choose **Enter as game master** for GM tools or **Enter as player** for the player experience. Neither requires an account, Render, Supabase, HTTP API calls, or a WebSocket. Supabase authentication initializes only when opening live campaigns. Built-in maps, portraits, fonts and dice assets ship with the site. Fonts retain their bundled SIL Open Font License notices in `public/fonts/`.

Try token movement, scene/grid/fog tools, drawing, turns, undo/redo, dice, macro import/rolls and chat. **Play as player** hides GM controls and projects the table through the same visibility rules as live campaigns; **Return to GM** restores GM access. **Reset demo** starts fresh. Demo changes live only in the current tab and reset on reload. Multiplayer invitations, uploaded image storage and Discord delivery require a live campaign. External image URLs still require their image host.

To deploy the demo alone, set the repository's **Settings → Pages → Source** to **GitHub Actions** and push to `master` (this repository’s default branch). No Render or Supabase variables are required. The existing workflow builds, tests the production demo with cloud requests blocked, and uploads `dist` to Pages. It uses `/repository-name/`; set repository variable `VITE_BASE_PATH=/` for a root site or custom domain. See [GitHub's custom workflow instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

For a frontend-only local preview:

```bash
npm ci
npm run dev:web
```

For a static production build, run `VITE_BASE_PATH=/agnostic-vtt/ npm run build:web`. Serve `dist` with a static web server; the demo does not use the Vite API proxy.

## Play live locally

Requires Node 24 and npm. No cloud credentials needed.

```bash
npm ci
npm run dev
```

Open **http://localhost:5173**, choose **Open a live table**, and begin your adventure. Use **Invite party** to copy the invitation. Open it in a separate browser or private window for a second player. Ordinary tabs in the same browser share the same local identity.

Drag tokens, scroll to zoom, hold Space to pan, and roll `1d20 + 5 - 2`. Maps and tokens accept both local image uploads and external image URLs. The included artwork is original, local SVG art. `M` measures, `P` pings, `Z` draws a region, `F` reveals/conceals fog, `D` draws freehand, and `T` places text. The eye button covers or clears the scene. The in-app guide documents controls.

Local sessions are server-signed guest identities stored in your browser. They expire after 24 hours; clearing browser storage loses that identity. Local mode binds to loopback and is for demonstrations. Use Supabase for hosted campaigns and durable account identity.

## GM and player access

Accounts have campaign-specific membership, not a global GM/player type. The same account can GM one campaign and join another as a player. New invitees always receive player membership, regardless of the launch selection.

In the live launch dialog, choose **Enter table as → Player** to join or resume a campaign as a player, including a campaign you own or GM. A GM can also select **Play as player** during play and **Return to GM** afterward. The server applies the selected role to that connection's snapshots, patches, movement permissions, editing, undo, and membership controls. Switching clears private presentations, selection and image caches. Reconnecting preserves the selected role; other tabs keep their own roles. The owner's durable membership remains GM, so player mode cannot strand the campaign without its owner. Only existing GMs can switch back to GM.

Player mode does not revoke account-level ownership or erase previously received information. Live HTTP account administration still checks campaign membership/ownership; this is a play mode, not a security boundary against the GM account itself. Players without GM membership cannot elevate themselves through either the launch selector or a role-switch message.

## Tabletop tools

- **Scenes/grids:** multiple saved scenes, square/pointy hex grids, gridless play, alignment, opacity, scale, units and snapping. Measurements use Euclidean distance or grid steps; square steps count diagonals equally.
- **Tokens:** resize, rotate, assign control, edit a generic resource bar, add custom status labels/icons, and set public or GM visibility. Ctrl/Cmd-click or Ctrl/Cmd-drag selects up to 50 tokens. Group, ungroup, duplicate and move them together. Campaign library templates create independent instances.
- **Fog:** reveal/conceal with a brush, rectangle or polygon. Click polygon vertices, then press Enter or **Finish**. Each brush stroke forms one undo operation.
- **Regions/drawing:** circles, rectangles, polygons, lines and cones, with optional snapping. Edit labels, colours, tags and opacity in **Regions & drawing layers**. Freehand and text annotations can be public or GM-only.
- **Measurement:** distance, path, radius, cone and area. Click path waypoints and finish with Enter. Measurements remain local; committed drawings and regions are shared.
- **Turns:** custom participants, numerical values, manual/highest/lowest order, editable rounds, forward/back navigation and hidden entries. This generic tracker can manage any ordered sequence.
- **Undo/redo:** GM header controls, or Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y. Undo covers committed table edits across clients, including player movement. Dice and chat remain in history. Up to 50 edits fit within a 1 MiB budget; history resets on server restart. New edits clear redo; membership changes and image deletion clear history.
- **Campaign access:** resume saved campaigns from the launch dialog. Owners can promote/demote or remove members and rotate invitations. Removed identities cannot rejoin using an invitation. Promoted GMs manage the table; only the owner manages access.

Escape clears drafts/selection; Delete removes selected tokens. On tablets, the layers button opens scene, grid, image, library and undo controls. Two fingers pan and pinch to zoom.

## Dice presentation

The server uses cryptographic randomness for d4, d6, d8, d10, d12, d20 and percentiles, including mixed expressions and positive/negative modifiers. It sends structured contributions and the total; browser physics presents those outcomes.

Settings include dice/number colours, metal/glass/plastic/wood/gemstone materials, opacity, scattered/cascade/orbit throws, velvet/stone/astral trays, speed, intensity, sound volume, particles and visual presets. Arcane, moon and ember arithmetic themes show individual contributions before the total. Minimal mode and reduced motion show authoritative arithmetic immediately. Preferences persist in the browser.

Low performance mode disables shadows and particles. Cinematic mode uses 2048-pixel shadows, up to 2× pixel density and additional particles. Physics code loads on demand. The adapter fixes upstream forced-d4 result retention, scales playback while retaining fixed physics steps, and manages resize/GPU cleanup.

## Macro files and named rolls

Open **Macros** in the dice panel. Choose `macro.txt` or paste definitions, review the preview, and import. Each nonblank line is a separate macro. LF, CRLF, CR, a UTF-8 BOM and `#` comment lines are supported. An invalid line prevents the entire import; errors identify its line. Download a ready-to-use [example file](public/examples/macro.txt) from the dialog.

```text
[Attack Name]\([Attack Roll(1d20 + X)],[Damage Roll(1d6 + [Fire(1d6)] + [Akashic(12)])])
[Restoration]\([Healing Roll(2d6 + [Divine(4)] + X)])
[Exploration]\([Perception Roll(1d20 + WIS)],[Travel Supplies(12 - [Consumed(1d4)])])
```

The backslash before the outer parenthesis is optional. The importer accepts the supplied example with its final `])` missing and previews the completed definition before saving; missing internal delimiters remain errors. A macro has a name and comma-separated `[Roll name(expression)]` groups. Expressions support standard dice, integer constants, `+`/`-`, numeric inputs such as `X` or `WIS`, and `[Label(expression)]` contributions. This is a bounded data grammar, without JavaScript evaluation.

Select a saved macro, enter its numeric inputs, choose public/private results, and roll. For example, `X = 5`, an attack die of 14, and damage dice of 3 and 4 display:

```text
Attack Name
Attack Roll: 19
Damage Roll: 3 + 4 Fire damage + 12 Akashic damage = 19
```

Names are generic: `[Healing Roll(...)]`, `[Resource Roll(...)]`, `[Awareness(...)]`, or your own headings work the same way. A heading ending in `Roll` supplies the label suffix: `Fire damage`, `Divine healing`, etc. Other headings preserve labels without a suffix. Labeled expressions display their subtotals; individual dice faces also appear in the arithmetic presentation. Nested labels are grouped under their outer label. Unlabeled groups show their final result. Each group has its own total; unrelated rolls are never added together in the UI or Discord message.

Imported macros persist in campaign snapshots. Public definitions can be used by any campaign member; private definitions are visible to their author and GMs. Only the author or a GM can delete a macro. Result privacy is chosen separately, with private definitions defaulting to private results in the UI. Server randomness, permissions, replay and recent roll history apply to macros just as they do to ordinary dice. One execution is one history entry containing every result group. The legacy `Roll.total` field holds the first group's total; macro-aware consumers should read `Roll.macro.groups`.

Limits: 64 KiB per import, 100 definitions per import/person, 200 per campaign, 4096 characters per definition, eight groups, 20 dice and 40 numeric/dice contributions across the whole macro, four nested label levels, and 12 numeric inputs. Numeric inputs accept finite values between −10,000 and 10,000; constants are integers up to 10,000. Advanced dice conventions and arbitrary scripting are future work.

## Discord webhooks

The campaign owner opens **Discord webhook ↗**, pastes a channel webhook URL, and saves. Automatic posting of public dice and macro results is the default. Settings also offer manual delivery from roll history, disabling delivery, replacing the webhook and removing it. Private results cannot be forwarded, including by a GM. Each macro is a single Discord message with a field for each named roll.

The URL is an HTTP credential sent once over the authenticated settings endpoint and saved only in the server's protected durable snapshot. It is never returned in status responses, campaign projections or WebSocket messages, and the app does not save it to browser storage. Only the campaign owner can configure it; other members can manually send their own public results, and GMs can send any public result. An existing saved URL can be kept by leaving its field blank. No additional environment variables, database migration, bot account or browser-to-Discord request is needed.

Delivery uses the [Discord webhook API](https://docs.discord.com/developers/resources/webhook) with confirmation, mention suppression, HTTPS endpoint validation, blocked redirects, bounded embed text, an eight-second request deadline and an ordered queue per webhook. It observes [Discord rate limits](https://github.com/discord/discord-api-docs/blob/main/developers/topics/rate-limits.mdx), retries HTTP 429 up to three attempts, and shows queued/sent/failed status in roll history. Failed delivery never rolls back a tabletop result. An explicit retry is available; uncertain network failures are not retried automatically because the original message may have arrived. Updating or removing settings cancels pending delivery; an already transmitted message cannot be recalled.

Queues and delivery deduplication are in memory, bounded to 200 pending messages globally, 50 per webhook and 1000 recent delivery states. A restart can discard pending messages and delivery status; manually sending an older result after a restart may duplicate a previous Discord message. Roll and macro persistence still follow the normal snapshot schedule. No live Discord channel has been contacted during verification; HTTP responses, rate limits and failures are tested with an injected transport.

## Verify

```bash
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

To smoke-check a production build under a repository subpath, build with `VITE_BASE_PATH=/agnostic-vtt/` and run `node scripts/verify-pages.mjs`. This exercises demo GM/player switching, fog filtering, undo, dice, chat, macros, reset and repository-subpath assets with all cloud/API requests blocked and WebSocket creation treated as a failure. It also works when the build contains unavailable live-service URLs.

The unit/server checks include real HTTP/WebSocket clients, permissions, private uploads, grouped fog history, atomic batches, membership changes, restart recovery, macro parsing/imports, separate result totals and webhook delivery. Additional regressions cover simultaneous joins, failed membership saves, idle eviction, room capacity during pending saves/loads, stale socket messages, pending confirmations and private presentation cleanup after role changes. Chromium scenarios cover independent users, uploads/templates/statuses/group movement, drawing privacy, fog geometry, hidden turns, persistent and damaged preferences, keyboard activation, disconnected chat drafts, tablet controls, actual forced physical dice faces, multiline macro imports and webhook settings. A large-map check exercises a 10,000-pixel hex scene with 100 tokens and verifies viewport-bounded grid work. For an existing browser binary, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its absolute path.

For a visual review, run `npm run review:visuals` after building with `VITE_BASE_PATH=/agnostic-vtt/`. Headless Chromium captures desktop, laptop, tablet and phone layouts, including GM/player views, macros, settings and rolls. Open `test-results/visual-review/index.html` for the screenshot gallery and `report.json` for viewport checks. Set `SCREENSHOT_DIR` to retain separate before/after runs; `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select an installed browser.

## Optional live-service deployment

The Pages demo above works independently. Add these services only for authenticated, persistent multiplayer.

1. Create a Supabase project and apply [001_tabletop.sql](supabase/migrations/001_tabletop.sql), then [002_assets_and_membership.sql](supabase/migrations/002_assets_and_membership.sql). Migration 002 creates the private image bucket and removes revoked memberships during snapshot saves. Existing Milestone 1 installations only need 002. Enable email/password authentication; configure the Site URL and allowed redirect URL to your Pages address, including the repository subpath. This implementation uses password sign-in and email-confirmation redirects.
2. Deploy the backend using [render.yaml](render.yaml). Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ALLOWED_ORIGINS` (your Pages **origin**, e.g. `https://yourname.github.io`; comma-separated for multiple origins). Keep the service role key on Render only. Render supplies `PORT`. Production refuses local guest authentication.
3. Configure GitHub Pages to use GitHub Actions. Set repository **variables** `VITE_SERVER_URL`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY` (public publishable/anon key). The workflow builds for `/repository-name/`. For an account root site or custom domain, also set `VITE_BASE_PATH=/`.
4. Push to `master`, inspect the workflow, and verify two authenticated browsers against the hosted server. Deployment requires access to your GitHub, Render, and Supabase projects; none is claimed by this repository.

The frontend is static. Authentication tokens are sent in the first WebSocket message, never in the connection URL. The backend validates users through Supabase Auth and caches verified tokens for at most 30 seconds. Roles and ownership come from server state. New invitees become persisted campaign members; rejoining members reuse the room cached in memory.

This release uses **WebSocket protocol 2**. Update frontend and backend together and reload connected browsers. Milestone 1 snapshot version 1 remains readable through additive scene/library/tracker/asset fields. Live Supabase authentication, migrations, private Storage and hosting still require validation against configured projects.

## State, cost, and durability

Rooms live in one Node process. Camera, selection and measurement are local; token previews and pings are ephemeral. Token commits, rolls, chat, fog, zones, annotations, tracker and scene settings broadcast typed revisioned patches. Clients use structural sharing; fog brushes append geometry instead of retransmitting scenes. The canvas draws when dirty or animating, clips hex grids to the viewport, and skips fine grids when zoomed out.

Persistence writes dirty snapshots at a default 90-second interval, with a 5-second debounce. Scene changes, accepted memberships, access changes, image manifests, graceful shutdown and the last player leaving also trigger saves. Normal movement, rolling and drawing do not individually write to Supabase. Unchanged rooms do not write. Failed saves retain dirty state and retry.

**A crash can lose changes made since the last successful snapshot.** The UI reports the last snapshot time. The most recent 100 rolls and 100 messages are included in snapshots; older history is deliberately pruned. Undo history is separate and exists only in memory. Local snapshots and the signing key live in ignored `.data/`. Render's filesystem is not durable; production uses Supabase snapshots and private Storage.

The Supabase adapter uses one transactional RPC per snapshot. Raw snapshots contain GM information and have no client read policies. Snapshots and incremental updates are projected: GM tokens/notes/drawings/templates, private rolls, concealed tokens and hidden tracker entries are withheld. Unused or exclusively private uploaded images are inaccessible to players. **Fog does not protect the underlying shared background image**: a map referenced by a scene is available to campaign players. Keep map secrets in separate private content until protected tiling exists. Visibility conservatively requires a token's whole footprint to be revealed; overlapping partial reveals can leave it withheld. Already received content cannot be made secret retroactively.

See [.env.example](.env.example) for settings. `/api/health` is public; bearer-authenticated `/api/metrics` reports aggregate persistence/connection metrics. Limits: 100 rooms per server (including pending creation/hydration), 10 members, 20 connections, 10 scenes, 100 tokens/regions/annotations per scene, 500 fog operations, 100 templates and 50 tracker entries. Empty rooms are evicted after 15 minutes, including campaigns created or loaded without a player connection. Failed saves retain dirty rooms until persistence recovers.

## Uploaded images

Upload PNG, JPEG or WebP files through Scene or Token settings. The backend validates signatures and decoding, rejects vectors/animation, strips metadata, preserves alpha and emits WebP. Limits: **10 MiB per upload**, **20 megapixels before resizing**, **4096 pixels per side for maps**, **512 for portraits**, and **64 images / 64 MiB per campaign**. Processing has concurrency and timeout limits. **Manage images** reuses images as maps and deletes unused images. References in any scene or saved template prevent deletion.

Local images live in `.data/assets/`; hosted images use the private Supabase `tabletop-assets` bucket. Binary uploads use authenticated HTTP independently of gameplay messages. Downloads recheck membership and visibility. Blob URLs keep credentials out of image URLs. Decoded canvas assets have a 64 MiB cache budget, thumbnails decode lazily, and image caches reset on room or identity/role changes. Failed snapshot persistence rolls back an upload's manifest and file. Storage has no public image policy; only the backend service role accesses objects.

## External images

Use public HTTPS PNG, JPEG, WebP or browser-supported image links. Preview verifies browser decoding with a timeout and a 40-megapixel limit. The renderer uses Canvas 2D without pixel readback, so it can draw browser-loadable images without a WebGL texture CORS grant. Exporting a raster screenshot from a canvas with foreign images is intentionally unsupported.

Images load directly, with no Referer header. Players' IP addresses are visible to remote hosts. Failed images can be replaced; configuration remains intact. HTTPS scheme/credential/host checks reject obvious internal and numeric URLs. **The backend never fetches arbitrary remote URLs**: there is no open proxy or automatic copying of remote images. If a host blocks embedding, replace the link or explicitly upload a local copy.

## Architecture and scope

`shared/` defines versioned serializable models, bounded dice grammar, coordinate transforms, permissions, assets, and protocol. `server/` owns authentication, rooms, cryptographic randomness, rate limits, and persistence. `src/` handles local camera state, optimistic drag previews, smooth remote movement, reconnect/backoff, and independent roll presentation. The existing [Dice Box Three.js library](https://github.com/3d-dice/dice-box-threejs) provides collision physics and face forcing. `@3d-dice/dice-box` was considered; its Three.js sibling explicitly supports predetermined results. A small adapter corrects its d4 preliminary-result retention and manages resize listeners. Dice outcomes never depend on browser physics. Third-party license notices are included in `public/assets/`.

See [the progress document](docs/PROGRESS.md) for verification and limits. Milestone 4 remains: generic character data, event hooks, token-linked macros, campaign import/export and extension interfaces. Walls, lighting, protected tiles, handouts and advanced dice conventions are future work.
