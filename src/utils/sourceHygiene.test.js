import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("App.jsx does not contain JSX-visible CJK unicode escape text", () => {
  const source = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  const jsxVisibleEscape = />[^<{}]*\\u(?:3[0-9a-fA-F]{3}|[4-9a-fA-F][0-9a-fA-F]{3})|\\u(?:3[0-9a-fA-F]{3}|[4-9a-fA-F][0-9a-fA-F]{3})[^<{}]*</;
  assert.equal(jsxVisibleEscape.test(source), false);
});
