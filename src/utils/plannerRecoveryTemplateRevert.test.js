import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  chooseNewestPlannerState,
  preservePlannerTemplateAuthority,
  PLANNER_TEMPLATE_AUTHORITY_FIELDS,
} from "./plannerDraftRecovery.js";

// REGRESSION #1 — "计划模板回去了 / dayTemplates 回退"
//
// Symptom: the user edits their day-template library, reloads, and the planner
// comes back with an OLDER set of templates (and an older default selection).
// The revert then becomes permanent, because the autosave effect pushes the
// recovered settings straight back to Firestore.
//
// Mechanism: `chooseNewestPlannerState` decides local-vs-remote purely from the
// *draft's* `updatedAt`. A local crash-recovery snapshot also carries a whole
// `settings` blob, so whenever its draft is newer, its stale template library
// used to ride along and overwrite the newer remote one.
//
// Fix: `preservePlannerTemplateAuthority` re-asserts the remote copy as the
// source of truth for the template-library fields after a local draft win.

const APP_SOURCE = readFileSync(fileURLToPath(new URL("../App.jsx", import.meta.url)), "utf8");

// Stand-in for App.jsx's `mergeScheduleSettings`. Faithful for the fields under
// test: the real one deliberately does NOT inject factory day templates (see
// App.jsx:7654-7660 — doing so used to trigger exactly this class of silent
// rewrite), it only shape-migrates what was saved.
const mergeScheduleSettings = (saved) => ({ ...(saved || {}) });

// Mirrors the reload effect in App.jsx (the `recoveredSettings` line).
function simulateReload({ profile, localRecovery, currentDate }) {
  const nextSettings = mergeScheduleSettings(profile.scheduleAssistantSettings);
  const newest = chooseNewestPlannerState(profile.scheduleAssistantDraft, localRecovery, currentDate);
  const recoveredSettings = newest.source === "local"
    ? preservePlannerTemplateAuthority(mergeScheduleSettings(localRecovery?.settings), nextSettings)
    : nextSettings;
  return { source: newest.source, settings: recoveredSettings };
}

const NEW_TEMPLATES = [
  { id: "tpl-new-a", name: "2026 冲刺日" },
  { id: "tpl-new-b", name: "休息日" },
];
const OLD_TEMPLATES = [{ id: "tpl-old", name: "旧版模板" }];

// A profile whose template library was edited recently (remote = newest), but
// whose day-draft is older than a local crash snapshot.
function makeScenario() {
  return {
    currentDate: "2026-08-03",
    profile: {
      id: "user-1",
      scheduleAssistantDraft: { targetDate: "2026-08-03", updatedAt: "2026-08-03T09:00:00.000Z" },
      scheduleAssistantSettings: {
        dayTemplates: NEW_TEMPLATES,
        defaultDayTemplateId: "tpl-new-a",
        deletedDayTemplateSystemKeys: ["system-focus"],
        wakeTime: "07:00",
      },
    },
    localRecovery: {
      updatedAt: "2026-08-03T11:30:00.000Z", // draft IS newer — local legitimately wins
      draft: { targetDate: "2026-08-03", notes: "本机未同步的草稿内容" },
      settings: {
        dayTemplates: OLD_TEMPLATES,
        defaultDayTemplateId: "tpl-old",
        deletedDayTemplateSystemKeys: [],
        wakeTime: "06:30",
      },
    },
  };
}

test("新模板 + 旧本地 recovery：reload 后新模板仍保留", () => {
  const { profile, localRecovery, currentDate } = makeScenario();
  const result = simulateReload({ profile, localRecovery, currentDate });

  // The local snapshot still wins for the DRAFT — that is its whole purpose.
  assert.equal(result.source, "local", "较新的本地草稿仍应胜出（本修复不改变草稿恢复行为）");

  // ...but it must not drag its stale template library along.
  assert.deepEqual(result.settings.dayTemplates, NEW_TEMPLATES, "远端较新的 dayTemplates 必须保留，不能被旧快照覆盖");
  assert.equal(result.settings.defaultDayTemplateId, "tpl-new-a", "defaultDayTemplateId 不能回退到旧快照的值");
  assert.deepEqual(result.settings.deletedDayTemplateSystemKeys, ["system-focus"], "已删除的系统模板不能被旧快照复活");
});

test("非模板设置仍然由胜出的本地快照恢复", () => {
  const { profile, localRecovery, currentDate } = makeScenario();
  const result = simulateReload({ profile, localRecovery, currentDate });
  assert.equal(result.settings.wakeTime, "06:30", "模板以外的设置应保持原有的本地恢复语义");
});

test("远端没有任何模板时，不会把本地快照里的模板抹空", () => {
  const remote = { dayTemplates: [], defaultDayTemplateId: "", deletedDayTemplateSystemKeys: [] };
  const recovered = { dayTemplates: OLD_TEMPLATES, defaultDayTemplateId: "tpl-old" };
  const merged = preservePlannerTemplateAuthority(recovered, remote);
  assert.deepEqual(merged.dayTemplates, OLD_TEMPLATES, "远端为空时应回退到本地，避免首次离线使用被清空");
  assert.equal(merged.defaultDayTemplateId, "tpl-old");
});

test("模板权威字段清单覆盖 dayTemplates / defaultDayTemplateId / deletedDayTemplateSystemKeys", () => {
  assert.deepEqual(
    [...PLANNER_TEMPLATE_AUTHORITY_FIELDS].sort(),
    ["dayTemplates", "defaultDayTemplateId", "deletedDayTemplateSystemKeys"],
  );
});

// Wiring guard: the helper is worthless if App.jsx's reload effect stops
// calling it. This is the assertion that goes red if someone reinstates the
// bare `mergeScheduleSettings(localRecovery?.settings)` line.
test("App.jsx 的本地恢复分支确实调用了 preservePlannerTemplateAuthority", () => {
  assert.match(
    APP_SOURCE,
    /newest\.source === "local"\s*\r?\n?\s*\?\s*preservePlannerTemplateAuthority\(mergeScheduleSettings\(localRecovery\?\.settings\), nextSettings\)/,
    "App.jsx 的 recoveredSettings 必须经过 preservePlannerTemplateAuthority 包装",
  );
  assert.ok(
    !/const recoveredSettings = newest\.source === "local" \? mergeScheduleSettings\(localRecovery\?\.settings\) : nextSettings;/.test(APP_SOURCE),
    "旧的无保护写法不得再出现",
  );
});
