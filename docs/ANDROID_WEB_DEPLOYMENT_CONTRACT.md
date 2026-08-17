# v13 Planner Web Deployment Contract

Status: route and browser-auth behavior are implemented locally. The actual
production origin remains operator-owned and is not assigned by this document.
No Android code, Firebase token bridge, or second Planner store is part of this
contract.

## Stable URL

The production Today URL is exactly:

```text
TODAY_PAGE_URL=https://<operator-approved-planner-origin>/today
```

`<operator-approved-planner-origin>` must be one permanent HTTPS host. It must
not be a Vite development address, a LAN IP, `chat.snowdust.local`, a preview
deployment, or an Android asset URL. `/today` is a browser-history route that
opens the existing `schedule` surface; it is not a separate Planner, an iframe,
or a native projection. The deployment must rewrite `/today` to the SPA entry
document while preserving the browser path.

The operator must record the final host here before Android integration starts.
No production deployment was made while establishing this contract.

## Auth Contract

The deployed origin is an authorized Firebase Auth domain and Google OAuth
redirect origin. The app uses Firebase Auth's `browserLocalPersistence`; auth
state is restored before the app subscribes to user data. Credentials remain in
Firebase/browser-managed storage for that HTTPS origin only. Android must not
read, write, copy, or forward Firebase tokens, cookies, localStorage, or
SharedPreferences.

First open at `/today`:

1. Firebase has no current user, so the existing login screen is shown.
2. The user selects Google login and completes the Firebase-managed OAuth flow
   at the same approved HTTPS origin.
3. `onAuthStateChanged` seeds/subscribes to `users/{uid}` and the existing
   ScheduleAssistant renders. No Planner data is sent to Android.

Reopen, foreground, and reload:

1. The same approved HTTPS `TODAY_PAGE_URL` is loaded.
2. Firebase restores its local persisted user and then the app re-subscribes to
   the canonical Firestore data.
3. Planner autosave/recovery and Firestore state continue to use their existing
   paths. Android has no cache authority.

Logout or an expired/revoked session:

1. Existing logout calls Firebase `signOut` for this origin.
2. Firebase emits a null auth state and the app returns to the login screen.
3. A protected mutation rejects as unauthenticated until the user signs in
   again; the client must not retry by borrowing a native token.

## Required Origin Capabilities

The one HTTPS origin must provide all of the following:

- SPA fallback for `GET /today`.
- Production Firebase configuration for Auth, Firestore, and Storage.
- Firebase/Google configuration authorizing the exact origin and its OAuth
  continuation flow.
- Same-origin `POST /api/reward-shop`, which verifies the user's Firebase ID
  token before executing reward-shop mutations.
- Network access to Firebase Auth, Firestore, Storage, and any configured
  same-origin API from ordinary external browsers and Android WebView.

Cloudflare may protect that single origin only when its Access flow permits the
same browser/WebView to complete Google sign-in and load `/today`; Cloudflare
does not create a separate Today URL. LAN addresses are development-only and
not part of this contract. One public HTTPS origin is sufficient for LAN,
Cloudflare-protected external access, and ordinary external access when the
operator configures DNS/access policy accordingly.

The optional Snow-dust Agent/Focus endpoint currently configured as
`127.0.0.1:4319` is desktop-local and optional. It is not required for Planner
DnD, Inbox, templates, Tracker, Firestore persistence, or canonical Planner
mutations, and it must not be treated as reachable from Android.

## Android Boundary

Android's only required Planner input is a navigation request to the fixed
`TODAY_PAGE_URL` in the existing product WebView. On foreground it may reload
that URL or restore the WebView; Firebase and the Planner own refresh and
authentication. It must not create Planner state, route mutation intents,
persist a duplicate day plan, or expose a native JavaScript token API.

## Production Acceptance

Before the host is frozen, an operator must verify on the final HTTPS origin:

1. First Google sign-in from a clean browser profile.
2. Reload and foreground restoration without a second login.
3. Logout, expired/revoked-session return to login, and subsequent re-login.
4. Firestore reads/writes, Storage upload, and same-origin `/api/reward-shop`.
5. v13 desktop and mobile interaction: DnD/resize, Inbox, template apply/save,
   Tracker reads, and timeline mutation through `commitDraftChange` plus
   `timelineRescheduleGate`.
6. External and Cloudflare-protected access using the same `/today` URL.

An authenticated production check is intentionally not simulated with demo
data or an injected token.
