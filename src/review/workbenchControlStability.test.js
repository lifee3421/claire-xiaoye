import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// These are source-scan tests, not rendered-component tests, because this
// repo runs plain `node --test` with no JSX transform available. The thing
// we actually need to guarantee — "this control can't silently revert after
// an autosave/snapshot echo" — reduces to a testable structural property:
// the control must be a plain controlled component (its displayed
// value/checked/active state comes ONLY from a prop, never duplicated into
// its own useState), so there is nothing local left to go stale. Once that's
// true, protection is inherited for free from shouldAcceptRemoteDraft (see
// reviewDraftSync.test.js) via the single shared `draft` state in
// DailyReviewWorkbench.

function readSource(file) {
  return readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), file), "utf8");
}

test("QuickChoice (mood/body/sleep-impact/phone/entertainment tags) renders its active option purely from the `value` prop, with no local useState to revert after an echo", () => {
  const source = readSource("ReviewSummaryDashboard.jsx");
  const start = source.indexOf("function QuickChoice(");
  const closeMatch = /\r?\n\}\r?\n/.exec(source.slice(start));
  const body = source.slice(start, start + closeMatch.index);
  assert.match(body, /className=\{value === option \? "is-active" : ""\}/);
  assert.match(body, /onClick=\{\(\) => onChange\(value === option \? "" : option\)\}/);
  assert.doesNotMatch(body, /useState/, "QuickChoice must not keep its own local copy of the selected value");
  assert.match(body, /key=\{option\}/, "options must use a stable key, not index");
});

test("QuickToggle (skincare/mask/period toggles) derives checked purely from the `checked` prop, with no local useState", () => {
  const source = readSource("QuickToggle.jsx");
  assert.match(source, /aria-checked=\{checked\}/);
  assert.match(source, /className=\{checked \? "is-on" : ""\}/);
  assert.doesNotMatch(source, /useState/, "QuickToggle must not keep its own local copy of checked");
});

test("InlineDurationInput (sleep time / water amount / study duration) only re-syncs its local text buffer from `value` while NOT focused, so a mid-typing autosave echo cannot overwrite what the user is typing", () => {
  const source = readSource("InlineDurationInput.jsx");
  assert.match(source, /if \(focused\) return;/);
  assert.match(source, /\}, \[value, focused\]\);/);
  assert.match(source, /onBlur=\{\(\) => \{\s*setFocused\(false\);\s*commit\(\);/);
});

test("DiaryCard's title/content/tags are plain controlled fields bound directly to draft via effectiveValue, so typing goes straight into the shared draft state instead of an isolated local buffer that could diverge", () => {
  const source = readSource("ReviewSummaryDashboard.jsx");
  const start = source.indexOf("function DiaryCard(");
  const end = source.indexOf("export default function ReviewSummaryDashboard", start);
  const body = source.slice(start, end);
  assert.match(body, /value=\{effectiveValue\(draft, "diary\.title"\)\}/);
  assert.match(body, /value=\{effectiveValue\(draft, "diary\.content"\)\}/);
  assert.doesNotMatch(body, /useState/, "DiaryCard must not keep its own local buffer for title/content");
});
