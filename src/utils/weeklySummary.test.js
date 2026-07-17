import test from "node:test";
import assert from "node:assert/strict";
import { buildWeeklySummary } from "./weeklySummary.js";

test("weekly summary includes active dynamic review projects in schema totals", () => {
  const summary = buildWeeklySummary([
    { reviewDate: "2026-07-13", reviewData: { projects: [{ name: "Project A", totalMinutes: 45 }] } },
    { reviewDate: "2026-07-14", reviewData: { projects: [{ name: "Project A", totalMinutes: 30 }, { name: "Archived", totalMinutes: 20 }] } },
  ], {
    startDate: "2026-07-13",
    endDate: "2026-07-14",
    dynamicProjects: [
      { id: "project-a", name: "Project A" },
      { id: "archived", name: "Archived", archived: true },
    ],
  });

  const row = summary.schemaTotals.find((item) => item.id === "project.dynamic.project-a.totalMinutes");
  assert.equal(row.minutes, 75);
  assert.equal(row.days, 2);
  assert.equal(summary.schemaTotals.some((item) => item.id === "project.dynamic.archived.totalMinutes"), false);
});
