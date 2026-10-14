# Snapshot ownership and image cleanup

## Guarantees and limits

Gameplay remains authoritative in one Node process. Use one Render instance, not a horizontally scaled fleet. Ordinary actions still batch at the existing 90-second snapshot interval; there are no per-action database writes, database polling, or Supabase Realtime subscriptions. A crash can still lose gameplay since the last successful snapshot.

Render deploys can briefly overlap the outgoing and incoming processes. Each persisted snapshot now has a separate `save_version`, advanced by every successful save. This is deliberately independent of gameplay `revision`: membership, invitations, image manifests, Discord settings, and cleanup can change without a gameplay action.

The existing save RPC compares its expected save version and atomically saves the snapshot, campaign name, and membership only if it still matches. A stale process cannot replace a newer snapshot, restore a revoked member, or revert configuration. A failed comparison returns `PT409`. The losing room stops accepting actions, cancels its timers and pending Discord delivery, closes its peers, and is evicted. Reconnecting clients reload the durable snapshot. Queued mutations and rollback handlers on that old room cannot save or resurrect it. Unsaved changes from the losing process are discarded rather than merged. This is a corruption guard, not shared multi-instance gameplay or a zero-loss handoff.

Ordinary persistence failures still retain dirty state and retry. An uncertain write that actually committed will fail the next CAS, resulting in the same safe reconnect instead of blindly overwriting newer data.

Local file snapshots use the same counter and serialize writes across adapter instances within one process. Older JSON snapshots without a counter load at version zero. File mode remains **single-process local development only**; its in-process lock is not a distributed filesystem lock.

## Migration and deployment

Fresh projects apply migrations 001, 002, and then [003_snapshot_save_version.sql](../supabase/migrations/003_snapshot_save_version.sql). Existing projects keep their snapshots and apply only the missing migrations. Migration 003 initializes existing snapshot rows to save version zero; no gameplay revisions or membership values are rewritten. Server-private cleanup fields are additive and require no separate table.

The migration notifies PostgREST to refresh its schema cache after commit. If the Data API still cannot find the new function or column, use [Supabase's schema-cache troubleshooting](https://supabase.com/docs/guides/troubleshooting/refresh-postgrest-schema) before starting play.

For the first upgrade from an unversioned server:

1. Announce a short maintenance window and stop new play. Gracefully stop/drain the old backend so its final snapshots finish **before** applying migration 003. Do not depend on an overlapping Render rollout to drain this first upgrade.
2. Apply migration 003 in Supabase. It installs the versioned six-argument RPC and deliberately replaces the old five-argument RPC with an error. This closes the legacy overwrite path immediately. An old server that was accidentally left running can no longer save; drain it and reconnect its clients rather than assuming its unsaved work was persisted.
3. Deploy this backend, keeping a single Render instance. Confirm health, reconnect the campaign, make one durable membership/configuration or image change, and confirm saving/reload. Validate the live project privately; repository tests do not constitute a live Supabase or Render deployment check.
4. For future deploys of CAS-aware servers, ordinary short process overlap is fenced at saves. A conflict can reconnect affected peers and discard the losing process's unsaved changes, so drain before deploying when those changes must be retained.

Do not roll back just the application to a pre-CAS build: the legacy RPC intentionally rejects it. Prefer a forward fix. Any emergency return to the old writer requires a maintenance window, all CAS-aware processes stopped, and an explicitly reviewed database rollback; restoring the legacy writer during mixed-version operation removes the safety guarantee.

## Private image cleanup

Deleting an unused image atomically removes its manifest entry and records a private cleanup intent in the durable snapshot **before** Storage deletion. Authorization immediately treats it as absent. Storage removal is idempotent, including already-missing files. Repeated DELETE requests can resume cleanup even though the manifest entry is gone.

Cleanup fences ownership through the same CAS save before touching bytes. A Storage error leaves the intent available for retry, and a crash after Storage removal but before its acknowledgment is saved simply repeats the removal. Acknowledgments are batched into normal snapshots. Pending cleanup retries once per minute, only for loaded rooms with pending intents. Hydrating a room after restart resumes its intents; unloaded campaigns are not globally scanned. A loaded room with pending cleanup is retained until it finishes rather than silently evicted. A prolonged Storage outage can consequently consume room capacity.

Uploads first persist a rollback intent, then upload, then atomically register the manifest and clear the intent. Upload transport requests have a 30-second deadline; unfinished/uncertain uploads receive a 15-minute cleanup grace period to avoid racing a request winding down on an old process. This is not a transactional guarantee from the Storage provider: an exceptionally late provider-side completion after that grace period requires operational investigation. The grace period is conservative compared with the bounded request, and no cleanup is attempted while that room's asset operation is still active in the same process.

If registration fails, a completed upload is cleaned up only after its rollback intent can be saved successfully. In particular, a lost RPC response after a successful registration causes CAS conflict on rollback; it does **not** delete the now-registered file. Failed cleanup remains durable and resumes after retry/restart. At most 64 pending cleanup intents are admitted per campaign, preventing failed uploads from growing snapshots without bound. No credentials or cleanup metadata are included in peer projections.

Uploads and deletes intentionally use a few immediate snapshot writes for their durable transitions. Movement, drawing, chat, and dice keep their original write cadence. The server's image download cache is capped at 16 MiB, deduplicates simultaneous cold reads, and rechecks each request's current image access after an awaited download.

## Verification

Run `npm test` and `npm run build`. Regression coverage includes independent manager CAS conflicts at equal gameplay revisions, concurrent membership/configuration rollback, legacy local snapshot upgrades, HTTP cache concurrency/accounting/eviction, Storage failures, replay after restart, cleanup acknowledgment crashes, interrupted uploads, and uncertain manifest commits. The PostgreSQL CI job additionally exercises the actual SQL RPC and concurrent database writers against a disposable database. Live Supabase and Render verification still requires an authorized deployment.
