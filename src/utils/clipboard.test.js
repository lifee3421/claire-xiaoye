import assert from "node:assert/strict";
import test from "node:test";
import { writeClipboardText, readClipboardText } from "./clipboard.js";

test("writeClipboardText uses Clipboard API when available", async () => {
  let written = "";
  await writeClipboardText("hello", {
    windowRef: { isSecureContext: true },
    navigatorRef: { clipboard: { writeText: async (value) => { written = value; } } },
  });
  assert.equal(written, "hello");
});

test("writeClipboardText falls back to textarea copy without Clipboard API", async () => {
  const created = [];
  const removed = [];
  const textarea = {
    style: {},
    setAttribute(name, value) { this[name] = value; },
    focus() { this.focused = true; },
    select() { this.selected = true; },
  };
  const documentRef = {
    createElement(tag) {
      assert.equal(tag, "textarea");
      created.push(textarea);
      return textarea;
    },
    execCommand(command) {
      assert.equal(command, "copy");
      return true;
    },
    body: {
      appendChild(node) { created.push(node); },
      removeChild(node) { removed.push(node); },
    },
  };
  await writeClipboardText("fallback", {
    windowRef: { isSecureContext: false },
    navigatorRef: {},
    documentRef,
  });
  assert.equal(textarea.value, "fallback");
  assert.equal(textarea.selected, true);
  assert.equal(removed[0], textarea);
});

test("readClipboardText reports a clear permission error without Clipboard API", async () => {
  await assert.rejects(
    () => readClipboardText({ windowRef: { isSecureContext: false }, navigatorRef: {} }),
    /不允许网页直接读取剪贴板/,
  );
});
