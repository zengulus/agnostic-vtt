# Repository rules

## P1: Save and Supabase traffic efficiency

Treat efficient persistence and low Supabase traffic as a P1 requirement, alongside
correctness, privacy and responsiveness. Design every feature to minimize durable
writes, reads and transferred bytes without weakening data integrity or recovery.

- Keep transient interactions, previews, camera state and visual animation local or
  ephemeral. Persist meaningful state changes in compact, bounded representations.
- Reuse hydrated room state and batch or coalesce durable changes through the
  established save scheduler. Avoid per-frame, per-pointer-move or per-client saves.
- Preserve snapshot concurrency checks, explicit durability boundaries and retry
  behavior. Do not trade away confirmed recovery or access-control guarantees.
- Measure or test write frequency and payload growth for affected workflows, and
  document material durability and traffic tradeoffs.

## Interaction responsiveness: 400 ms

Treat the Doherty Threshold as a core product requirement. User actions should
produce a meaningful, perceptible response within 400 ms. Design and review
interactions against this budget, including tabletop controls, character sheets,
dialogs, dice, and campaign management.

- Start feedback immediately: update the interface or show an appropriate pending
  state without waiting for network, storage, animation, or expensive work.
- When an operation cannot reliably finish within 400 ms, keep the interface
  responsive and communicate progress, completion, and failure. Never imply an
  unconfirmed server action has succeeded; reconcile optimistic changes and
  surface errors when needed.
- Avoid blocking the main thread with large computations or rendering. Use
  incremental work, caching, workers, or other appropriate techniques where needed.
- Verify responsiveness for affected workflows under representative conditions.
  Measure from user input to the first meaningful feedback, and distinguish that
  from time to complete. Document material limitations and regressions.

The 400 ms budget is a requirement for perceived feedback, not a promise that
remote services or all operations will complete within that time.
