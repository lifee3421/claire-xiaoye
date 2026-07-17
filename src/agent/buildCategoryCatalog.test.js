import test from "node:test";
import assert from "node:assert/strict";
import { buildCatkeeperCategoryCatalog } from "./buildCategoryCatalog.js";

test("builds a public category catalog without taxonomy keywords, colors, or targets", () => {
  const catalog = buildCatkeeperCategoryCatalog({
    now: new Date("2026-07-17T01:02:03.000Z"),
    taxonomy: [{
      id: "study",
      name: "Study",
      children: [{ id: "development", name: "Development", color: "#123456", keywords: "personal alias" }],
    }],
    scheduleSettings: {
      commonTasks: [{ id: "task-1", title: "Build project", categoryId: "development" }],
      dayTemplates: [{ content: { defaultTaskGroups: [{ templateItemId: "task-2", title: "Review code", categoryId: "development" }] } }],
    },
  });
  assert.deepEqual(catalog, {
    schemaVersion: 1,
    generatedAt: "2026-07-17T01:02:03.000Z",
    categories: [{ categoryId: "development", name: "Development" }],
    taskTemplates: [
      { taskId: "task-1", title: "Build project", categoryId: "development" },
      { taskId: "task-2", title: "Review code", categoryId: "development" },
    ],
  });
});
