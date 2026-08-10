import fs from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8");

test("planner advanced settings exposes persistent Snow-dust planning rules", () => {
  assert.match(appSource, /雪尘排程规则/);
  assert.match(appSource, /snowdustPlannerRules/);
  assert.match(appSource, /雪尘排程规则已保存/);
});

test("shared planner ledger is a visible checklist above the task list", () => {
  assert.match(appSource, /今天一起记/);
  assert.match(appSource, /雪尘等会儿会问/);
  assert.match(appSource, /toggleInboxItemCompletionById/);
  assert.match(appSource, /item\.completedAt \? "恢复" : "✓ 完成"/);
  const ledger = appSource.indexOf("<InboxSection items={inboxItems}");
  const sortable = appSource.indexOf("<SortableContext items={sortedTasks", ledger - 1500);
  assert.ok(ledger >= 0 && sortable >= 0 && ledger < sortable, "shared ledger should render above the task card list");
});
