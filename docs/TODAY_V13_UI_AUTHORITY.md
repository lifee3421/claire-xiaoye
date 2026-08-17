# Today v13 UI Authority Freeze

## Frozen authorities

- Desktop Web Planner presentation authority: `3f0be0e7c47f7fa7df6019036a1cc50dd36ba050`
- Approved SnowDustApp Today v13 source SHA-256: `7957481b4a28c6d77169f3b8a644a6fd64d98d15b60bc7e18d01968ab428ce89`
- Previous real-data integration checkpoint: `checkpoint/today-v13-integration-ddae3f8`

## Phase 1: UI-only

`/today` must render the approved v13 source itself with its standalone mock data and mock interactions.

Do not connect Firebase, Planner state, canonical mutations, native auth, or Focus in this phase.

The browser loader reconstructs the frozen source and checks the SHA-256 before rendering. A source mismatch must fail closed instead of showing an approximate UI.

## Phase 2: data/function integration

The approved DOM, CSS, responsive composition, timeline geometry, task-pool geometry, and interaction affordances are presentation authority and must not be redesigned during integration.

Integrate one boundary at a time:

1. Read-only current/next/date/summary data.
2. Read-only timeline and task-pool projection.
3. Inbox / Tracker / Template read models.
4. Existing Planner mutation handlers for edit, move, resize, completion, lock, pool return, swap, insert/ripple, conflict handling.
5. Focus comparison/navigation.
6. Native auth and persistence.

For each boundary, replace only the mock data source or event handler. Do not replace the v13 DOM with legacy Planner presentation components.

## Hard invariants

- Desktop `App.jsx` / `styles.css` presentation must remain the original desktop UI unless a separate desktop task explicitly changes it.
- `/today` must never mount legacy `TimelinePreview` or `TaskPoolPreview` as its visual surface.
- Desktop and Today share Planner authority/data, not presentation components.
- `/today` visual comparison against the frozen UI must remain zero-diff before and after each integration step.
