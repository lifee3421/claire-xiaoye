import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { parseReviewMarkdown } from "./utils/reviewParser.js";
import { reviewValueText } from "./utils/reviewValue.js";

async function loadJuly17Markdown() {
  const fixture = await readFile(new URL("./utils/reviewParserJuly17.test.js", import.meta.url), "utf8");
  const match = fixture.match(/const july17Markdown = `([\s\S]*?)`;/);
  if (!match) throw new Error("July 17 Markdown fixture not found");
  return match[1];
}

test("每日结算识别后的预览可重渲染对象型 progress，且保留原 Markdown", async (t) => {
  const july17Markdown = await loadJuly17Markdown();
  const parsed = parseReviewMarkdown(july17Markdown);
  const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
  t.after(() => vite.close());

  const { ReviewParsePreview } = await vite.ssrLoadModule("/src/App.jsx");
  const html = renderToStaticMarkup(createElement(ReviewParsePreview, { parsed }));

  assert.equal(typeof parsed.subjects.math.progress, "object");
  assert.match(html, /识别预览/);
  assert.match(html, /数学 212min；专业课 43min；英语 119min；/);
  assert.match(html, /4h37min；娱乐 140min/);
  assert.match(reviewValueText(parsed.subjects.math.progress), /线性代数：/);
  assert.equal(july17Markdown.includes("线性代数：3h32min"), true);
});
