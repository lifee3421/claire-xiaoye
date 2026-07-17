export async function writeClipboardText(text, environment = {}) {
  const value = String(text || "");
  if (!value) throw new Error("没有可以复制的内容");

  const windowRef = environment.windowRef ?? globalThis.window;
  const navigatorRef = environment.navigatorRef ?? globalThis.navigator;
  const documentRef = environment.documentRef ?? globalThis.document;

  if (
    windowRef?.isSecureContext &&
    navigatorRef?.clipboard &&
    typeof navigatorRef.clipboard.writeText === "function"
  ) {
    await navigatorRef.clipboard.writeText(value);
    return;
  }

  if (!documentRef?.createElement || !documentRef.body?.appendChild) {
    throw new Error("当前环境不支持剪贴板复制");
  }

  const textarea = documentRef.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  textarea.style.opacity = "0";

  documentRef.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    const succeeded = documentRef.execCommand?.("copy");
    if (!succeeded) throw new Error("浏览器拒绝复制");
  } finally {
    documentRef.body.removeChild(textarea);
  }
}

export async function readClipboardText(environment = {}) {
  const windowRef = environment.windowRef ?? globalThis.window;
  const navigatorRef = environment.navigatorRef ?? globalThis.navigator;

  if (
    windowRef?.isSecureContext &&
    navigatorRef?.clipboard &&
    typeof navigatorRef.clipboard.readText === "function"
  ) {
    return navigatorRef.clipboard.readText();
  }

  throw new Error("当前浏览器不允许网页直接读取剪贴板，请手动粘贴");
}
