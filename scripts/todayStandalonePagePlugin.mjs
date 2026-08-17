import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";

const EXPECTED_SHA256 = "d4a721f64d2ec293d774e6df56ffca7eaf51e517a938f6535dbace13fe1a8784";
const SOURCE_PARTS = ["00.b64", "01a2.b64", "01b.b64", "02.b64", "03.b64", "04.b64"];

function approvedTodaySource(rootDir) {
  const partsDir = path.resolve(rootDir, "scripts/today-v14-source");
  const encoded = SOURCE_PARTS.map((name) => fs.readFileSync(path.join(partsDir, name), "utf8").trim()).join("");
  const source = zlib.gunzipSync(Buffer.from(encoded, "base64")).toString("utf8");
  const digest = crypto.createHash("sha256").update(source, "utf8").digest("hex");
  if (digest !== EXPECTED_SHA256) throw new Error(`Today v14 source verification failed: expected ${EXPECTED_SHA256}, got ${digest}`);
  return source;
}

function assertStandaloneAssets(rootDir) {
  const assets = [
    "public/today-standalone-bridge.js",
    "public/today-projection-polish.js",
    "public/today-template-scope-bridge.js",
    "public/today-reminder-edit-bridge.js",
  ];
  for (const relative of assets) {
    const filename = path.resolve(rootDir, relative);
    const source = fs.readFileSync(filename, "utf8");
    try {
      new Function(source);
    } catch (error) {
      throw new Error(`Today standalone asset syntax failed (${relative}): ${error.message}`);
    }
    if (/同步联调中|这一版先只读|Phase 1.*只读/i.test(source)) {
      throw new Error(`Today standalone invariant failed: read-only interception returned in ${relative}`);
    }
  }
}

function assertStandaloneOutput(output) {
  const forbidden = [
    [/<iframe\b/i, "iframe"],
    [/\batob\s*\(/, "runtime atob/base64 loader"],
    [/TodayV14Frame|AppRuntime/, "desktop App runtime"],
  ];
  for (const [pattern, label] of forbidden) {
    if (pattern.test(output)) throw new Error(`Today standalone invariant failed: ${label} reappeared in today.html`);
  }
  const required = [
    "/today-standalone-bridge.js",
    "/today-projection-polish.js",
    "/today-template-scope-bridge.js",
    "/today-reminder-edit-bridge.js",
    "/src/today/standaloneRuntime.js",
  ];
  if (required.some((value) => !output.includes(value))) throw new Error("Today standalone invariant failed: standalone runtime boot scripts are missing");
  return output;
}

function injectStandaloneRuntime(source) {
  const marker = "</body>";
  if (!source.includes(marker)) throw new Error("Today v14 source has no </body> marker");
  const boot = [
    '<style id="snowdust-live-boot-hide">#root{visibility:hidden}</style>',
    '<script src="/today-standalone-bridge.js"></script>',
    '<script src="/today-projection-polish.js"></script>',
    '<script src="/today-template-scope-bridge.js"></script>',
    '<script src="/today-reminder-edit-bridge.js"></script>',
    '<script type="module" src="/src/today/standaloneRuntime.js"></script>',
  ].join("\n");
  const output = source
    .replace(/<title>[^<]*<\/title>/, "<title>今日排程</title>")
    .replace(marker, `${boot}\n${marker}`);
  return assertStandaloneOutput(output);
}

export function todayStandalonePagePlugin() {
  let rootDir = process.cwd();
  return {
    name: "snowdust-today-standalone-page",
    enforce: "pre",
    configResolved(config) { rootDir = config.root || process.cwd(); },
    transformIndexHtml: {
      order: "pre",
      handler(html, context) {
        const filename = String(context?.filename || "").replace(/\\/g, "/");
        if (!filename.endsWith("/today.html")) return html;
        assertStandaloneAssets(rootDir);
        return injectStandaloneRuntime(approvedTodaySource(rootDir));
      },
    },
  };
}

export { approvedTodaySource, injectStandaloneRuntime, assertStandaloneOutput, assertStandaloneAssets };