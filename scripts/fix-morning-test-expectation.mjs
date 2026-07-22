import fs from "node:fs";

const path = "src/utils/unifiedPlannerCards.test.js";
const source = fs.readFileSync(path, "utf8");
const needle = '  assert.equal(result.todayCustomBlocks[0].id, "legacy");';
const replacement = '  assert.equal(result.todayCustomBlocks.find((item) => item.id === "legacy")?.id, "legacy");';
if (!source.includes(needle)) throw new Error("Expected legacy-card assertion was not found");
fs.writeFileSync(path, source.replace(needle, replacement), "utf8");
console.log("updated legacy-card assertion for permanent morning card");
