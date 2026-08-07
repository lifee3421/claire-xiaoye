# Reward Challenges & Surprise Drops

Status: implementation spec for `feature/reward-challenges-surprise`

## 1. Goal

Extend the existing reward shop without creating a second balance or reward system. `claire-xiaoye` remains the single source of truth for shop items, challenge state, reward instances and points. Cyberboss / 雪尘 is the conversational controller and WeChat delivery surface.

The feature adds two things:

1. **Multiple redemption methods** — rewards may be bought with points, earned by completing a machine-verifiable challenge, or unlocked by a challenge and then purchased with points.
2. **Surprise drops** — 雪尘 may publish limited / special offers. When a surprise drop goes live, the user must receive a proactive WeChat notification.

## 2. Redemption modes

Every offer has one of these modes:

- `points` — existing points-only purchase.
- `streak` — N consecutive qualifying local dates.
- `count_in_period` — N qualifying dates/events inside a bounded period; continuity is not required.
- `cumulative` — an aggregate metric reaches a target in a bounded period.
- `hybrid` — a challenge must first be complete, then a points price is charged when claimed.

Examples:

- streak: 3 consecutive days with bedtime <= 24:00.
- count_in_period: in the current Monday-Sunday week, at least 4 days with study >= 420 minutes.
- cumulative: current week total study >= 2100 minutes.
- hybrid: 4 qualifying study days, then pay 8 points for a limited reward.

## 3. Supported machine-verifiable metrics (v1)

A generated challenge MUST use authoritative data already available to Catkeeper. v1 supports:

- `study_minutes` — daily authoritative study total from submitted settlement / Daily Review facts.
- `reading_minutes` — daily review reading duration.
- `bedtime_minutes` — bedtime normalized onto a logical night clock so 23:40 < 24:00 < 00:20.
- `exercise_minutes` — Keep / exercise record duration.
- `exercise_session` — whether an exercise record exists and qualifies that day.
- `tracker_completion` — an existing tracker completion fact when its identity can be resolved unambiguously.

A challenge must never be created from a condition the system cannot verify (for example “be happy for 5 days”).

Unknown or missing source data is **not** silently treated as success. Challenge progress reports the day as `unknown` until authoritative evidence exists.

## 4. Challenge rule model

A normalized challenge stores:

```js
{
  mode: "streak" | "count_in_period" | "cumulative",
  metric: "study_minutes" | "reading_minutes" | "bedtime_minutes" | "exercise_minutes" | "exercise_session" | "tracker_completion",
  operator: ">=" | "<=" | "==",
  threshold: number,
  targetCount: number,       // streak/count targets
  targetTotal: number,       // cumulative targets
  period: {
    type: "rolling_days" | "calendar_week" | "date_range",
    days: number,
    startDate: "YYYY-MM-DD",
    endDate: "YYYY-MM-DD"
  },
  trackerId: "",             // only for tracker_completion
  timezone: "Asia/Shanghai"
}
```

The server recomputes progress from source facts. It does not maintain an unsafe mutable `progress += 1` counter, because a Daily Review or tracker record may later be corrected.

## 5. Challenge lifecycle

Challenge offers use this lifecycle:

`locked -> in_progress -> unlocked -> claimable -> claimed`

- `locked`: not started / no qualifying evidence yet.
- `in_progress`: valid progress exists but target is not complete.
- `unlocked`: challenge condition is complete.
- `claimable`: reward may now be claimed (for v1 this is normally the same effective state as unlocked, but kept explicit in the response contract).
- `claimed`: a reward instance was created exactly once.

Claiming is not using. Claim creates the existing `rewardInstance` with status `available`; later `use_reward` changes that instance to `used`.

For `hybrid`, the point charge happens atomically at claim time. For challenge-only offers, claim creates the reward instance without a point transaction.

## 6. Surprise drop model

A normal product may carry surprise metadata:

```js
{
  surprise: {
    enabled: true,
    kind: "limited_time" | "limited_stock" | "mystery" | "discount" | "event",
    revealMode: "immediate" | "after_claim",
    availableFrom: ISOString,
    expiresAt: ISOString,
    notifyOnPublish: true,
    publishedBy: "snowdust" | "user" | "system"
  }
}
```

Rules:

- A surprise item is visible only inside its availability window and while stock/status allow it.
- Mystery rewards may hide the final description until claim/redeem.
- Existing normal shop items remain backward compatible.
- Surprise publication is idempotent.

## 7. Surprise generation policy

雪尘 may propose/publish a surprise only through an **internal/system-authorized path**. A normal user chat request such as “给我刷一个惊喜商品” must not directly invoke surprise generation.

Generation policy:

- use only machine-verifiable challenge metrics;
- prefer a mild stretch over recent baseline, not an extreme target;
- avoid repeatedly targeting the same behavior;
- respect stock/expiry and do not flood the shop;
- never fabricate source data or mark a challenge complete from conversation memory.

The user may still create ordinary products manually through the existing shop tools.

## 8. Proactive WeChat notification (required)

A surprise drop is not considered fully published until a notification event exists.

Catkeeper writes a server-authoritative `rewardNotifications` outbox document in the same transaction as the surprise publication where practical. The notification has a stable event id and enough safe snapshot data to compose a message.

Cyberboss's long-running `cyberboss start` process polls pending reward notifications and routes them into the existing `SystemMessageQueueStore` / `SystemMessageDispatcher` path with:

```js
systemDelivery: {
  eventType: "reward_surprise_drop",
  deliveryMode: "must_send",
  eventId: "reward-surprise:<notificationId>",
  fallbackText: "..."
}
```

Delivery semantics:

1. poll/lease notification;
2. enqueue one system message;
3. send to WeChat through the existing system-delivery pipeline;
4. ACK Catkeeper only after successful WeChat delivery;
5. if the process crashes before ACK, the lease eventually expires and the same stable event may be retried;
6. duplicate polls/messages must never create duplicate shop items or duplicate notification acknowledgements.

Do not mark a notification delivered merely because Cyberboss fetched it.

## 9. Server-authoritative collections

New server-only collections under `users/{uid}`:

- `rewardChallenges` — challenge offer definitions and immutable reward snapshots.
- `rewardChallengeClaims` — optional audit rows for claims (or equivalent transaction metadata).
- `rewardNotifications` — surprise/challenge notification outbox with lease/ack state.

Browser direct writes to these collections are not allowed. Existing `rewardInstances`, `rewardIdempotency`, `pointTransactions` remain authoritative.

## 10. Idempotency / atomicity

All side-effecting operations accept a stable idempotency key derived from the original WeChat message id where applicable.

Must be safe under response loss and retry:

- publish surprise: one product/offer + one notification event;
- create challenge: one challenge;
- claim challenge: one reward instance; hybrid charge at most once;
- notification ACK: idempotent;
- existing redeem/use guarantees remain unchanged.

## 11. API/tool surface

Catkeeper reward-shop actions to add:

- `list_reward_challenges`
- `get_reward_challenge_progress`
- `create_reward_challenge` (trusted Snow-dust/admin path)
- `claim_reward_challenge`
- `publish_surprise_drop` (system-authorized, not ordinary user-chat callable)
- `list_pending_reward_notifications`
- `lease_reward_notification`
- `ack_reward_notification`

Snow-dust user-facing tools:

- list challenge offers/progress;
- claim a completed challenge reward.

Snow-dust internal services:

- create/publish a challenge or surprise from a system trigger;
- poll/lease/ACK notification outbox;
- proactive WeChat delivery.

## 12. UI

Mall groups offers into:

- 🛍 常驻商城
- ✨ 惊喜上新
- 🎯 雪尘的挑战

Challenge cards show current progress, e.g. `3 / 4 天`, `2 / 3 连续`, or `29.3 / 35h`, plus expiry and point co-pay when hybrid.

## 13. Acceptance tests

At minimum:

1. 3-day bedtime streak resets when a confirmed non-qualifying day occurs.
2. unknown day does not falsely qualify a streak.
3. 4-of-7 study-day challenge is non-consecutive.
4. weekly cumulative study challenge recomputes after source edits.
5. challenge-only claim creates exactly one available reward instance and charges 0 points.
6. hybrid claim charges points exactly once and creates one reward instance under concurrent/retried calls.
7. surprise publish creates exactly one outbox notification under retry.
8. notification is not ACKed on fetch/lease alone.
9. successful WeChat system delivery ACKs notification once.
10. failed/crashed delivery becomes retryable after lease expiry.
11. ordinary user chat cannot force the internal surprise-generator capability.
12. legacy products and points-only redemption continue to behave exactly as before.

## 14. Explicit non-goals for this patch

- Do not change the existing 59.84 historical balance.
- Do not change point earning precision yet; the separate desired rule is future points in 0.5-point increments.
- Do not run the historical reward-shop migration `--apply` as part of this feature.
