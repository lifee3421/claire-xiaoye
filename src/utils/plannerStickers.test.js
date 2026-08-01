import test from "node:test";
import assert from "node:assert/strict";
import {
  createStickerTemplate,
  updateStickerTemplate,
  archiveStickerTemplate,
  restoreStickerTemplate,
  listActiveStickerTemplates,
  normalizeStickerTemplates,
  snapStickerMinute,
  createStickerInstance,
  createTrackerSticker,
  completeStickerInstance,
  moveStickerInstance,
  toggleStickerCompletion,
  removeStickerInstance,
  countStickerCompletion,
  normalizeStickerInstances,
} from "./plannerStickers.js";

test("createStickerTemplate builds a real template with defaults, and rejects a blank title", () => {
  const template = createStickerTemplate({ title: "吃补剂", emoji: "💊", color: "#f59e0b" });
  assert.equal(template.title, "吃补剂");
  assert.equal(template.emoji, "💊");
  assert.equal(template.archived, false);
  assert.ok(template.id);
  assert.equal(createStickerTemplate({ title: "   " }), null);
});

test("createStickerTemplate defaults emoji when none is given", () => {
  const template = createStickerTemplate({ title: "取快递" });
  assert.equal(template.emoji, "📌");
});

test("updateStickerTemplate patches only the matching template, bumping updatedAt", () => {
  const a = createStickerTemplate({ title: "浇花", emoji: "🌱" });
  const b = createStickerTemplate({ title: "带教材", emoji: "🎒" });
  const next = updateStickerTemplate([a, b], a.id, { emoji: "🪴", color: "#22c55e" });
  const updatedA = next.find((t) => t.id === a.id);
  assert.equal(updatedA.emoji, "🪴");
  assert.equal(updatedA.color, "#22c55e");
  assert.equal(next.find((t) => t.id === b.id).emoji, "🎒", "the other template must be untouched");
});

test("archiveStickerTemplate marks archived without deleting; listActiveStickerTemplates excludes it", () => {
  const a = createStickerTemplate({ title: "浇花" });
  const b = createStickerTemplate({ title: "带教材" });
  const archived = archiveStickerTemplate([a, b], a.id);
  assert.equal(archived.find((t) => t.id === a.id).archived, true);
  assert.equal(archived.length, 2, "archiving is never a delete");
  const active = listActiveStickerTemplates(archived);
  assert.deepEqual(active.map((t) => t.id), [b.id]);
});

test("restoreStickerTemplate un-archives", () => {
  const a = createStickerTemplate({ title: "浇花" });
  const archived = archiveStickerTemplate([a], a.id);
  const restored = restoreStickerTemplate(archived, a.id);
  assert.equal(restored[0].archived, false);
});

test("snapStickerMinute rounds to the nearest 5 minutes and clamps below zero", () => {
  assert.equal(snapStickerMinute(1172), 1170);
  assert.equal(snapStickerMinute(1173), 1175);
  assert.equal(snapStickerMinute(-30), 0);
  assert.equal(snapStickerMinute("not a number"), 0);
});

test("createStickerInstance snapshots the template's own emoji/title/color and snaps anchorMinute", () => {
  const template = createStickerTemplate({ title: "吃补剂", emoji: "💊", color: "#f59e0b" });
  const instance = createStickerInstance(template, 1172);
  assert.equal(instance.templateId, template.id);
  assert.equal(instance.title, "吃补剂");
  assert.equal(instance.emoji, "💊");
  assert.equal(instance.anchorMinute, 1170);
  assert.equal(instance.status, "pending");
  assert.equal(createStickerInstance(null, 100), null);
});

test("a later template edit never changes an already-placed instance (the instance owns its own snapshot)", () => {
  const template = createStickerTemplate({ title: "吃补剂", emoji: "💊" });
  const instance = createStickerInstance(template, 600);
  const editedTemplates = updateStickerTemplate([template], template.id, { title: "吃维生素", emoji: "🍊" });
  assert.equal(instance.title, "吃补剂", "instance snapshot must be untouched by the template edit");
  assert.equal(editedTemplates[0].title, "吃维生素");
});

test("moveStickerInstance repositions only the matching sticker, snapping to 5 minutes", () => {
  const template = createStickerTemplate({ title: "浇花", emoji: "🌱" });
  const a = createStickerInstance(template, 600);
  const b = createStickerInstance(template, 700);
  const next = moveStickerInstance([a, b], a.id, 613);
  assert.equal(next.find((s) => s.id === a.id).anchorMinute, 615);
  assert.equal(next.find((s) => s.id === b.id).anchorMinute, 700, "the other instance must be untouched");
});

test("toggleStickerCompletion flips pending<->completed and stamps/clears completedAt, undo included", () => {
  const template = createStickerTemplate({ title: "浇花", emoji: "🌱" });
  const instance = createStickerInstance(template, 600);
  const completed = toggleStickerCompletion([instance], instance.id);
  assert.equal(completed[0].status, "completed");
  assert.ok(completed[0].completedAt);
  const undone = toggleStickerCompletion(completed, instance.id);
  assert.equal(undone[0].status, "pending");
  assert.equal(undone[0].completedAt, "");
});

test("removeStickerInstance deletes only the matching TODAY instance", () => {
  const template = createStickerTemplate({ title: "浇花", emoji: "🌱" });
  const a = createStickerInstance(template, 600);
  const b = createStickerInstance(template, 700);
  const next = removeStickerInstance([a, b], a.id);
  assert.deepEqual(next.map((s) => s.id), [b.id]);
});

test("countStickerCompletion reports completed/total independent of any task-block completion rate", () => {
  const template = createStickerTemplate({ title: "浇花", emoji: "🌱" });
  const a = toggleStickerCompletion([createStickerInstance(template, 600)], undefined)[0]; // still pending (no matching id)
  const stickers = [
    { ...createStickerInstance(template, 600), status: "completed" },
    { ...createStickerInstance(template, 650), status: "completed" },
    { ...createStickerInstance(template, 700), status: "completed" },
    { ...createStickerInstance(template, 750), status: "pending" },
    { ...createStickerInstance(template, 800), status: "pending" },
  ];
  assert.deepEqual(countStickerCompletion(stickers), { completed: 3, total: 5 });
  assert.equal(a.status, "pending");
});

test("normalizeStickerTemplates drops malformed entries and fills safe defaults, never throwing on garbage input", () => {
  const normalized = normalizeStickerTemplates([
    { id: "t1", title: "浇花", emoji: "🌱", color: "#22c55e", archived: false },
    { id: "t2" }, // no title/emoji/color at all
    { title: "no id" }, // missing id — dropped
    null,
    "garbage",
  ]);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].title, "浇花");
  assert.equal(normalized[1].id, "t2");
  assert.equal(normalized[1].title, "贴纸");
  assert.equal(normalized[1].emoji, "📌");
  assert.deepEqual(normalizeStickerTemplates(undefined), []);
  assert.deepEqual(normalizeStickerTemplates(null), []);
});

test("normalizeStickerInstances drops malformed entries, snaps anchorMinute, and never throws on garbage input", () => {
  const normalized = normalizeStickerInstances([
    { id: "s1", templateId: "t1", title: "吃补剂", emoji: "💊", anchorMinute: 1172, status: "completed", completedAt: "2026-07-28T10:00:00.000Z" },
    { id: "s2", anchorMinute: "not a number" },
    { noId: true },
    undefined,
  ]);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].anchorMinute, 1170);
  assert.equal(normalized[0].status, "completed");
  assert.equal(normalized[1].anchorMinute, 0);
  assert.equal(normalized[1].status, "pending");
  assert.deepEqual(normalizeStickerInstances(undefined), []);
});

test("createTrackerSticker: builds a reminder sticker with tracker identity fields, parses HH:mm into anchorMinute", () => {
  const sticker = createTrackerSticker({ trackerId: "family-a", generationKey: "family-a:2026-07-27", stickerType: "reminder", emoji: "📞", title: "联系外婆", time: "09:30" });
  assert.equal(sticker.origin, "tracker");
  assert.equal(sticker.trackerId, "family-a");
  assert.equal(sticker.generationKey, "family-a:2026-07-27");
  assert.equal(sticker.stickerType, "reminder");
  assert.equal(sticker.anchorMinute, 570); // 09:30
  assert.equal(sticker.status, "pending");
});

test("createTrackerSticker: missing trackerId/generationKey returns null (never a half-identified sticker)", () => {
  assert.equal(createTrackerSticker({ trackerId: "", generationKey: "x" }), null);
  assert.equal(createTrackerSticker({ trackerId: "t1", generationKey: "" }), null);
});

test("createTrackerSticker: invalid timeline time never falls back to 09:00", () => {
  assert.equal(createTrackerSticker({ trackerId: "t1", generationKey: "t1:2026-07-27" }), null);
  assert.equal(createTrackerSticker({ trackerId: "t1", generationKey: "t1:2026-07-27", time: "garbage" }), null);
});

test("createTrackerSticker: sticker_bar has no required time or timeline anchor", () => {
  const sticker = createTrackerSticker({ trackerId: "t1", generationKey: "t1:2026-07-27", placementMode: "sticker_bar" });
  assert.equal(sticker.placementMode, "sticker_bar");
  assert.equal(sticker.anchorMinute, null);
});

test("completeStickerInstance: idempotent, only touches the matching sticker, never un-completes on repeat calls", () => {
  const stickers = [
    { id: "s1", status: "pending", completedAt: "" },
    { id: "s2", status: "pending", completedAt: "" },
  ];
  const once = completeStickerInstance(stickers, "s1");
  assert.equal(once[0].status, "completed");
  assert.ok(once[0].completedAt);
  assert.equal(once[1].status, "pending"); // untouched
  const twice = completeStickerInstance(once, "s1");
  assert.equal(twice[0].completedAt, once[0].completedAt); // same timestamp, not re-stamped
});

test("normalizeStickerInstances: preserves tracker origin/identity fields through a reload, defaults manual stickers safely", () => {
  const normalized = normalizeStickerInstances([
    { id: "s1", origin: "tracker", trackerId: "family-a", generationKey: "family-a:2026-07-27", stickerType: "reminder" },
    { id: "s2" }, // manual, no tracker fields at all
  ]);
  assert.equal(normalized[0].origin, "tracker");
  assert.equal(normalized[0].trackerId, "family-a");
  assert.equal(normalized[0].generationKey, "family-a:2026-07-27");
  assert.equal(normalized[0].stickerType, "reminder");
  assert.equal(normalized[1].origin, "manual");
  assert.equal(normalized[1].trackerId, "");
  assert.equal(normalized[1].stickerType, ""); // never undefined — Firestore rejects undefined field values
});
