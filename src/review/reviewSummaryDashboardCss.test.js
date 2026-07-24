import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const stylesPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "styles.css");
const css = readFileSync(stylesPath, "utf8");

test("styles.css never hides all inputs/textareas/selects inside .review-summary-dashboard", () => {
  // Regression guard: an earlier round left a blanket
  // `.review-summary-dashboard input/textarea/select { display: none !important; }`
  // rule from the drawer-only design, which silently hid every inline
  // editing control once the hybrid inline-editing dashboard replaced it.
  const blanketHideRule = /\.review-summary-dashboard[\s\S]{0,400}display:\s*none\s*!important/;
  assert.equal(
    blanketHideRule.test(css),
    false,
    "found a rule that would hide real editing controls on the main review page"
  );
});
