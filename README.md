# Aether Table

A playable, system-agnostic fantasy tabletop with Milestones 1–3 implemented. React + strict TypeScript, Canvas 2D, deterministic Three.js/Cannon dice physics, and an authoritative Node WebSocket server. No gameplay database polling or Supabase Realtime.

## Play locally

Requires Node 24 and npm. No cloud credentials needed.

```bash
npm ci
npm run dev
```

Open **http://localhost:5173**, choose **Open a demo table**, and begin your adventure. Use **Invite party** to copy the invitation. Open it in a separate browser or private window for a second player. Ordinary tabs in the same browser share the same local identity.

Drag tokens, scroll to zoom, hold Space to pan, and roll `1d20 + 5 - 2`. Maps and tokens accept both local image uploads and external image URLs. The included artwork is original, local SVG art. `M` measures, `P` pings, `Z` draws a region, `F` reveals/conceals fog, `D` draws freehand, and `T` places text. The eye button covers or clears the scene. The in-app guide documents controls.

Local sessions are server-signed guest identities stored in your browser. They expire after 24 hours; clearing browser storage loses that identity. Local mode binds to loopback and is for demonstrations. Use Supabase for hosted campaigns and durable account identity.

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

## Verify

```bash
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

To smoke-check a production build under a repository subpath, build with `VITE_BASE_PATH=/agnostic-vtt/` and run `node scripts/verify-pages.mjs`. This verifies static startup and asset loading, without signing in to cloud services.

The 63 unit/server checks include real HTTP/WebSocket clients, permissions, private uploads, grouped fog history, atomic batches, membership changes and restart recovery. Nine Chromium scenarios cover independent users, uploads/templates/statuses/group movement, drawing privacy, fog geometry, hidden turns, persistent preferences, tablet controls and actual forced physical dice faces. A large-map check exercises a 10,000-pixel hex scene with 100 tokens and verifies viewport-bounded grid work. For an existing browser binary, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its absolute path.

## Deployment

1. Create a Supabase project and apply [001_tabletop.sql](supabase/migrations/001_tabletop.sql), then [002_assets_and_membership.sql](supabase/migrations/002_assets_and_membership.sql). Migration 002 creates the private image bucket and removes revoked memberships during snapshot saves. Existing Milestone 1 installations only need 002. Enable email/password authentication; configure the Site URL and allowed redirect URL to your Pages address, including the repository subpath. This implementation uses password sign-in and email-confirmation redirects.
2. Deploy the backend using [render.yaml](render.yaml). Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ALLOWED_ORIGINS` (your Pages **origin**, e.g. `https://yourname.github.io`; comma-separated for multiple origins). Keep the service role key on Render only. Render supplies `PORT`. Production refuses local guest authentication.
3. Configure GitHub Pages to use GitHub Actions. Set repository **variables** `VITE_SERVER_URL`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY` (public publishable/anon key). The workflow builds for `/repository-name/`. For an account root site or custom domain, also set `VITE_BASE_PATH=/`.
4. Push to `main`, inspect the workflow, and verify two authenticated browsers against the hosted server. Deployment requires access to your GitHub, Render, and Supabase projects; none is claimed by this repository.

The frontend is static. Authentication tokens are sent in the first WebSocket message, never in the connection URL. The backend validates users through Supabase Auth and caches verified tokens for at most 30 seconds. Roles and ownership come from server state. New invitees become persisted campaign members; rejoining members reuse the room cached in memory.

This release uses **WebSocket protocol 2**. Update frontend and backend together and reload connected browsers. Milestone 1 snapshot version 1 remains readable through additive scene/library/tracker/asset fields. Live Supabase authentication, migrations, private Storage and hosting still require validation against configured projects.

## State, cost, and durability

Rooms live in one Node process. Camera, selection and measurement are local; token previews and pings are ephemeral. Token commits, rolls, chat, fog, zones, annotations, tracker and scene settings broadcast typed revisioned patches. Clients use structural sharing; fog brushes append geometry instead of retransmitting scenes. The canvas draws when dirty or animating, clips hex grids to the viewport, and skips fine grids when zoomed out.

Persistence writes dirty snapshots at a default 90-second interval, with a 5-second debounce. Scene changes, accepted memberships, access changes, image manifests, graceful shutdown and the last player leaving also trigger saves. Normal movement, rolling and drawing do not individually write to Supabase. Unchanged rooms do not write. Failed saves retain dirty state and retry.

**A crash can lose changes made since the last successful snapshot.** The UI reports the last snapshot time. The most recent 100 rolls and 100 messages are included in snapshots; older history is deliberately pruned. Undo history is separate and exists only in memory. Local snapshots and the signing key live in ignored `.data/`. Render's filesystem is not durable; production uses Supabase snapshots and private Storage.

The Supabase adapter uses one transactional RPC per snapshot. Raw snapshots contain GM information and have no client read policies. Snapshots and incremental updates are projected: GM tokens/notes/drawings/templates, private rolls, concealed tokens and hidden tracker entries are withheld. Unused or exclusively private uploaded images are inaccessible to players. **Fog does not protect the underlying shared background image**: a map referenced by a scene is available to campaign players. Keep map secrets in separate private content until protected tiling exists. Visibility conservatively requires a token's whole footprint to be revealed; overlapping partial reveals can leave it withheld. Already received content cannot be made secret retroactively.

See [.env.example](.env.example) for settings. `/api/health` is public; bearer-authenticated `/api/metrics` reports aggregate persistence/connection metrics. Limits: 10 members, 20 connections, 10 scenes, 100 tokens/regions/annotations per scene, 500 fog operations, 100 templates and 50 tracker entries. Empty rooms are evicted after 15 minutes.

## Uploaded images

Upload PNG, JPEG or WebP files through Scene or Token settings. The backend validates signatures and decoding, rejects vectors/animation, strips metadata, preserves alpha and emits WebP. Limits: **10 MiB per upload**, **20 megapixels before resizing**, **4096 pixels per side for maps**, **512 for portraits**, and **64 images / 64 MiB per campaign**. Processing has concurrency and timeout limits. **Manage images** reuses images as maps and deletes unused images. References in any scene or saved template prevent deletion.

Local images live in `.data/assets/`; hosted images use the private Supabase `tabletop-assets` bucket. Binary uploads use authenticated HTTP independently of gameplay messages. Downloads recheck membership and visibility. Blob URLs keep credentials out of image URLs. Decoded canvas assets have a 64 MiB cache budget, thumbnails decode lazily, and image caches reset on room or identity/role changes. Failed snapshot persistence rolls back an upload's manifest and file. Storage has no public image policy; only the backend service role accesses objects.

## External images

Use public HTTPS PNG, JPEG, WebP or browser-supported image links. Preview verifies browser decoding with a timeout and a 40-megapixel limit. The renderer uses Canvas 2D without pixel readback, so it can draw browser-loadable images without a WebGL texture CORS grant. Exporting a raster screenshot from a canvas with foreign images is intentionally unsupported.

Images load directly, with no Referer header. Players' IP addresses are visible to remote hosts. Failed images can be replaced; configuration remains intact. HTTPS scheme/credential/host checks reject obvious internal and numeric URLs. **The backend never fetches arbitrary remote URLs**: there is no open proxy or automatic copying of remote images. If a host blocks embedding, replace the link or explicitly upload a local copy.

## Architecture and scope

`shared/` defines versioned serializable models, bounded dice grammar, coordinate transforms, permissions, assets, and protocol. `server/` owns authentication, rooms, cryptographic randomness, rate limits, and persistence. `src/` handles local camera state, optimistic drag previews, smooth remote movement, reconnect/backoff, and independent roll presentation. The existing [Dice Box Three.js library](https://github.com/3d-dice/dice-box-threejs) provides collision physics and face forcing. `@3d-dice/dice-box` was considered; its Three.js sibling explicitly supports predetermined results. A small adapter corrects its d4 preliminary-result retention and manages resize listeners. Dice outcomes never depend on browser physics. Third-party license notices are included in `public/assets/`.

See [the progress document](docs/PROGRESS.md) for verification and limits. Milestone 4 remains: generic character data, event hooks, token-linked macros, campaign import/export and extension interfaces. Walls, lighting, protected tiles, handouts and advanced dice conventions are future work.
