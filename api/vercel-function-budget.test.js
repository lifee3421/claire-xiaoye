import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = resolve(root, "api");
const ignoreText = readFileSync(resolve(root, ".vercelignore"), "utf8");
const vercelConfig = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));

const exactIgnoredApiFiles = new Set(
  ignoreText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^api\/[\w.-]+\.js$/.test(line) && !line.includes("*")),
);

const productionApiFiles = readdirSync(apiDir)
  .filter((name) => name.endsWith(".js") && !name.endsWith(".test.js"))
  .map((name) => `api/${name}`)
  .filter((name) => !exactIgnoredApiFiles.has(name));

const consolidatedPublicRoutes = new Map([
  ["/api/planner-mutate", "mutate"],
  ["/api/planner-direct-edit", "direct-edit"],
  ["/api/planner-draft-sidecar", "draft-sidecar"],
  ["/api/planner-ui-proposal", "ui-proposal"],
  ["/api/planner-ui-proposal-apply", "ui-proposal-apply"],
]);

test("Vercel Hobby deployment stays at or below 12 top-level Functions", () => {
  assert.ok(
    productionApiFiles.length <= 12,
    `expected <= 12 deployable api functions, found ${productionApiFiles.length}: ${productionApiFiles.join(", ")}`,
  );
  assert.equal(productionApiFiles.length, 12);
  assert.ok(productionApiFiles.includes("api/planner.js"));
});

test("every ignored Planner compatibility wrapper has a rewrite to the shared Function", () => {
  for (const [source, route] of consolidatedPublicRoutes) {
    const rewrite = vercelConfig.rewrites.find((item) => item.source === source);
    assert.ok(rewrite, `missing Vercel rewrite for ${source}`);
    assert.equal(rewrite.destination, `/api/planner?__plannerRoute=${route}`);
    assert.ok(exactIgnoredApiFiles.has(`api/${source.slice("/api/".length)}.js`));
  }
});
