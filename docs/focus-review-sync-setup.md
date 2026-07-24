# Focus → Daily Review sync: one-time setup

This is the only manual step left after this branch's code — everything else
is already written and tested. Nothing here has been applied yet; these are
exact instructions for you to run once.

## 1. Get a Firebase service account key

1. Firebase Console → Project settings → **Service accounts** → **Generate
   new private key**. This downloads a JSON file — treat it like a password,
   never commit it.
2. Open the file and copy its entire contents as a single line (or leave it
   multi-line; Vercel accepts either — just paste the whole JSON).

## 2. Set the four Vercel environment variables (Production + Preview)

In the `claire-xiaoye` Vercel project → Settings → Environment Variables, add:

| Name | Value |
|---|---|
| `CATKEEPER_USER_UID` | Your Firebase Auth `uid` (Firebase Console → Authentication → Users → copy the UID column for your one account) |
| `CATKEEPER_FOCUS_SYNC_SECRET` | A long random string, e.g. generate with `openssl rand -hex 32` — this is the HMAC signing secret, shared with Cyberboss below |
| `CATKEEPER_FIREBASE_SERVICE_ACCOUNT` | The full service-account JSON from step 1, pasted as the value |

Redeploy (or it'll apply on the next deploy) so the new `api/focus-review-sync.js`
function picks them up.

## 3. Set the matching Cyberboss environment variables

In Cyberboss's own env (wherever `CYBERBOSS_*` vars already live for your
running instance):

| Name | Value |
|---|---|
| `CATKEEPER_FOCUS_SYNC_URL` | `https://<your-vercel-domain>/api/focus-review-sync` |
| `CATKEEPER_FOCUS_SYNC_SECRET` | The exact same value as `CATKEEPER_FOCUS_SYNC_SECRET` above — must match byte-for-byte |
| `CATKEEPER_FOCUS_SYNC_ENABLED` | `true` (leave unset/`false` to keep it fully off) |
| `CATKEEPER_FOCUS_SYNC_TIMEZONE` | `Asia/Shanghai` (optional — this is already the default) |

## 4. Verify

From the Cyberboss repo:

```bash
npm run sync:focus-review -- --date 2026-07-24 --dry-run
```

This makes **no network request** — it just builds today's projection locally
and prints a summary (session count, mapped/unmapped, category totals,
sourceRevision). Once that looks right:

```bash
npm run sync:focus-review -- --date 2026-07-24 --apply
```

This is the one real network call — it POSTs the projection to your Vercel
endpoint. Check the 小猫管家 Daily Review page for that date afterward; you
should see a compact "Focus 已同步 …" line near the top and the matching
study/category durations filled in as `autoValue` (still overridable by
typing a manual value, which always wins).

Once `CATKEEPER_FOCUS_SYNC_ENABLED=true` is set, Cyberboss also does this
automatically — once at its own startup, and every 10 minutes after — so the
manual `--apply` run above is only needed for this first verification.
