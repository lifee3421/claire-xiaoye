# SnowDust Today standalone architecture

Status: Phase 1 read-only integration candidate

## Authority model

There is exactly one Planner authority.

- Desktop Web Planner is a presentation/client.
- SnowDustApp Today is a presentation/client.
- Snow-dust AI is a presentation/client/service actor.
- None of those clients owns a second copy of Planner data.

All persisted schedule state, task-pool placement, baseline/revision semantics and mutations converge on the existing canonical Planner backend.

## Route boundary

`/` remains the original desktop rewards-bank / full Planner application.

`/today` is a separate Vite HTML entry (`today.html`). It must never boot through desktop `AppRuntime` / `App.jsx` and must never render inside the desktop schedule tab.

The approved Today v14 product HTML is reconstructed and SHA-256 verified at build time, then emitted directly as `today.html`.

## Forbidden regressions

The standalone Today build fails if any of these reappear in `today.html`:

- an iframe wrapper around Today;
- runtime base64 / `atob()` UI loading;
- `TodayV14Frame`;
- desktop `AppRuntime`.

This is intentional. The Today page may use Web technology / Android WebView, but it must not depend on the desktop Web presentation shell.

## Phase 1: read-only proof

Before enabling writes, `/today` must prove that it can:

1. authenticate Claire as the same Firebase user;
2. read the same dated persisted Planner draft used by desktop and Snow-dust;
3. project real timeline blocks, pool segments, baseline and shared ledger into the approved v14 UI;
4. refresh after the shared user Planner document changes;
5. remain visually independent from desktop Web.

`/api/planner-ui-context` is a side-effect-free authenticated read projection served through the existing consolidated `api/planner.js` function. It is not a new Planner store or authority.

## Write phase

Only after the read-only proof is accepted should Today writes be enabled. Writes must call existing canonical mutation contracts and carry the existing revision / operation semantics; v14's standalone/mock local mutation code must never become persistence authority.

Suggested enablement order:

1. return timeline block to pool;
2. restore/schedule pool block to timeline;
3. move/swap/ripple placement;
4. resize;
5. completion/restore;
6. lock/protected-event changes;
7. Today Inbox mutations;
8. template/tracker management.

## Android

Android should treat `/today` as its own SnowDustApp surface. Native code may provide authentication handoff and native capabilities, but must not own Planner data.

The approved native auth direction remains: Credential Manager Google ID token -> one-shot Web message -> Firebase `signInWithCredential` -> browser-local Firebase persistence, with exact-origin gating.

## Multi-client synchronization

Desktop, Today and Snow-dust synchronize because they read/write the same canonical persisted state, not because one client synchronizes directly to another client.

A change from any authorized client should be observed through the shared backend and projected into the other clients. UI implementations are allowed to differ completely.
