# Progress · 14 October 2026

## Current milestone

Milestones 1, 2 and 3 implemented. Application 0.3.0; WebSocket protocol 2. Durable snapshot version 1 remains compatible through additive fields.

## Implemented

- React/TypeScript tabletop with original sample maps/portraits, responsive UI, pan/zoom, square/hex/gridless scenes, alignment/scale, snapping, multiselection, grouping, atomic movement/update/delete batches, token rotation/sizing/resources and custom status glyphs.
- Real Node `ws` server, server-authenticated identities, invite-based campaigns, cached memberships, presence, optimistic previews, authoritative movement, typed protocol, revisions, resync, heartbeat, reconnect, backoff, and rate/payload limits.
- External URL map/token loading, previews, timeouts, failed-asset replacement and persistent references; native PNG/JPEG/WebP uploads with validation, normalized WebP, alpha preservation, metadata removal, quotas and failed-save rollback.
- Private local/Supabase image adapters, authenticated permission-aware downloads, unused-image deletion/reference checks and a reusable campaign token library with independent placement.
- Cryptographic dice results with bounded expressions, all standard polyhedra/percentiles, forced physical outcomes, contribution arithmetic, presets and private rolls. Extended visual settings: colours, five materials, opacity, scatter/cascade/orbit throws, speed/intensity, three trays, arcane/moon/ember/minimal arithmetic, particles, synthesized sounds/volume, reduced motion and performance presets.
- File persistence for credential-free local play; Supabase Auth/persistence adapters, transactional migration and RLS; batched dirty snapshots, recovery, last-save indicator, bounded history, and aggregate metrics.
- Multiple scenes and transition effects, chat, pings, circle/rectangle/polygon/line/cone regions, labels/colour/tags/opacity/optional snapping, public/GM text/freehand layers, distance/path/radius/cone/area measurement and grid/Euclidean conventions.
- Persistent reveal/conceal fog brushes, rectangles and polygons; grouped strokes and conservative footprint projection. Server filtering covers GM tokens/notes/drawings/templates, private rolls, hidden tracker entries and private uploaded assets.
- Generic tracker with participants/values, custom/numerical ordering, rounds, manual edits, hidden entries and forward/back navigation.
- Shared server-authoritative GM undo/redo, bounded to 50 edits / 1 MiB, including player movement and grouped fog. Dice/chat remain in history; new edits clear redo.
- Saved campaign listing/resumption, owner role management/removal and invitation rotation. Revocation closes existing connections and blocks invitation re-entry.
- Structural-sharing patches, incremental fog geometry, dirty/animation-driven drawing, viewport-clipped hex grids, 64 MiB raster cache, lazy thumbnails, touch pinch/pan and tablet access to scene/library controls.
- GitHub Pages subpath support, Actions workflow, Render blueprint, env examples, and setup documentation.

## Verification

- Strict TypeScript and production frontend/backend builds pass, including `/agnostic-vtt/` asset paths.
- 63 unit and real-server checks pass: previous dice/URL/coordinate/protocol/persistence coverage plus private upload access/validation/normalization/rollback, atomic group permissions, hidden layer/template/tracker projection, rectangle/polygon fog visibility, grouped undo/redo, bounded history, mixed visibility previews, round progression, membership revocation/invitation rotation, campaign listing and restart recovery.
- Nine Chromium acceptance scenarios pass: independent users/reconnect and shared chat/rolls, external previews/errors, native map/token uploads, statuses/templates/groups/undo, drawing privacy, polygon regions, reveal/conceal fog, hex settings, hidden turns, scene changes, persistent preferences, minimal arithmetic and desktop/tablet/mobile layouts. Actual physical rendering validates every supported die/percentile combination, transparent gemstone d4s, alternate throws, 0.5×/2× playback and cinematic shadow resolution.
- A large-map check renders a 10,000 × 10,000 hex scene with 100 tokens and bounds grid work to the viewport. Timing is diagnostic, not a universal frame-rate claim.
- An additional Chromium smoke check loads the built production application with Supabase enabled under `/agnostic-vtt/` and verifies that its sample map assets load from the correct subpath. Build-time sample endpoint values were used only for this check; live authentication was not attempted.
- Browser inspection found and fixed upstream d4 stale results after face forcing. The adapter clears preliminary results and owns the resize lifecycle.
- npm dependency audit reports zero known vulnerabilities after upgrading the test runner.
- Cloud authentication, SQL migrations, and hosting require configured projects and are not yet verified against live services.

## Decisions

- Native Canvas 2D avoids WebGL CORS texture requirements while keeping local camera operations independent of networking.
- Dice Box Three.js/Cannon provides physical collisions and predetermined outcomes; the server uses Node `crypto.randomInt` and clients present the result.
- No arbitrary server image fetch/proxy. External links load directly; native uploads use authenticated HTTP independently of gameplay. Uploaded objects stay private; there is no silent copying of external assets.
- One Render process; warm rooms and hydration locks prevent repeated snapshot reads on simultaneous joins.
- Snapshot-only durability: default 90 seconds; periodic dirty writes, transition saves, and shutdown saves. Recent state can be lost on an unexpected crash.
- Durable history retains 100 recent rolls and messages; players receive only authorised data. Shared undo is ephemeral and clears on restart, membership changes or asset deletion.

## Known limits

- Fog conceals token data server-side but shared background URLs remain accessible. Pixel-level map secrecy needs protected tiles or separate assets.
- Cloud credentials and deployment are not present; Supabase/Render/GitHub Pages configuration is prepared, not deployed.
- Local guest identity expires after 24 hours and depends on browser storage.
- Uploads: 10 MiB / 20 megapixels, resized to 4096-map / 512-portrait pixels; 64 images / 64 MiB per campaign. Rooms: 10 members, 20 connections, 10 scenes, 100 tokens/regions/annotations per scene, 500 fog operations, 100 templates and 50 tracker entries.
- Whole-footprint token visibility errs toward concealment; overlapping partial reveals can leave tokens withheld. Already received content cannot be made secret retroactively.
- Existing cloud installations must apply migration 002, update both protocol-2 applications and reload clients. Live private Storage and SQL migration behavior are not cloud-verified.
- Removed identities remain denied even with a valid invitation; owner reinstatement UI is not included. Walls, lighting, protected map tiles, richer handouts, advanced dice conventions and cursor presence remain future work.

## Next milestone

4. Generic character data, event hooks, campaign import/export, macros linked to tokens and extension interfaces.
