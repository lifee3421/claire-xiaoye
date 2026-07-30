# Emulator tests (test-only, not a deployment artifact)

This directory is a self-contained Firestore Emulator test harness for the
unified tracker fact layer (`trackerReconcileJobs`, `completionEvents`). It
is **not** the project's real Firestore rules/indexes — those still need to
be exported from the live Firebase project (pending the user's own
`firebase login`; see the chat history for why the agent doesn't do this
itself) and merged into a real `firestore.rules`/`firestore.indexes.json` at
the repo root. `test.rules` here only assumes the same `users/{uid}` owner
pattern the rest of the app already uses, for the purpose of exercising the
new collections against a real Firestore Emulator instead of guessing at
behavior.

## Running

```bash
cd emulator-tests
npm install   # NOT pnpm — the repo root has its own pnpm-workspace.yaml,
              # which silently swallows this directory's install into the
              # workspace instead of giving it its own node_modules; plain
              # npm sidesteps that entirely since this is an independent,
              # throwaway test project, not a workspace package.
npx firebase emulators:start --only firestore --project demo-claire-xiaoye-test
# in a second terminal:
FIRESTORE_EMULATOR_HOST=127.0.0.1:8089 node --test emulator.test.mjs
```

Uses a `demo-*` Firebase project id, which the emulator serves entirely
offline — no real project credentials or `firebase login` needed to run
these.

## What's covered

- Owner-only read/write on `trackerReconcileJobs`/`completionEvents`; a
  different authenticated uid and an unauthenticated client are both denied.
- `settlement` + `trackerReconcileJobs` doc written in the same transaction:
  succeed together, and — critically — if the job-doc write is denied by
  rules, the *whole* transaction fails, so a settlement can never end up
  saved without its reconcile job.
- Two concurrent transactions racing to claim the same job: exactly one
  ends up owning the lease.
- A stale revision-2 write never overwrites an already-stored revision-10
  event.
- Both composite queries this feature actually needs
  (`trackerReconcileJobs`: `status in [...]` + `orderBy(createdAt)`;
  `completionEvents`: `trackerId ==` + `state ==`) run correctly against a
  real emulator, not just a hand-rolled index-requirement guess.
