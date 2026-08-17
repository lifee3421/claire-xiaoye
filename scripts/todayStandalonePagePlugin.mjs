import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";

const EXPECTED_SHA256 = "d4a721f64d2ec293d774e6df56ffca7eaf51e517a938f6535dbace13fe1a8784";
const PART_COUNT = 5;

function approvedTodaySource(rootDir) {
  const partsDir = path.resolve(rootDir, "scripts/today-v14-source");
  const encoded = Array.from({ length: PART_COUNT }, (_, index) => {
    const file = path.join(partsDir, `${String(index).padStart(2, "0")}.b64`);
    return fs.readFileSync(file, "utf8").trim();
  }).join("");
  const source = zlib.gunzipSync(Buffer.from(encoded, "base64")).toString("utf8");
  const digest = crypto.createHash("sha256").update(source, "utf8").digest("hex");
  if (digest !== EXPECTED_SHA256) {
    throw new Error(`Today v14 source verification failed: expected ${EXPECTED_SHA256}, got ${digest}`);
  }
  return source;
}

function injectStandaloneRuntime(source) {
  const marker = "</body>";
  if (!source.includes(marker)) throw new Error("Today v14 source has no </body> marker");
  const boot = [
    '<style id="snowdust-live-boot-hide">#root{visibility:hidden}</style>',
    '<script src="/today-standalone-bridge.js"></script>',
    '<script type="module" src="/src/today/standaloneRuntime.js"></script>',
  ].join("\n");
  return source
    .replace(/<title>[^<]*<\/title>/, "<title>今日排程</title>")
    .replace(marker, `${boot}\n${marker}`);
}

export function todayStandalonePagePlugin() {
  let rootDir = process.cwd();
  return {
    name: "snowdust-today-standalone-page",
    enforce: "pre",
    configResolved(config) {
      rootDir = config.root || process.cwd();
    },
    transformIndexHtml: {
      order: "pre",
      handler(html, context) {
        const filename = String(context?.filename || "").replace(/\\/g, "/");
        if (!filename.endsWith("/today.html")) return html;
        return injectStandaloneRuntime(approvedTodaySource(rootDir));
      },
    },
  };
}

export { approvedTodaySource, injectStandaloneRuntime };
