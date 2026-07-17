import fs from "node:fs";
import path from "node:path";

const target = process.argv[2];

if (!target) {
  console.error("Usage: node scripts/decode-cjk-unicode-source.mjs <file>");
  process.exit(1);
}

const absolutePath = path.resolve(target);
const source = fs.readFileSync(absolutePath, "utf8");

function isCjkUiCharacter(codePoint) {
  return (
    (codePoint >= 0x3000 && codePoint <= 0x303f) ||
    (codePoint >= 0x3400 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xff00 && codePoint <= 0xffef)
  );
}

const result = source.replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => {
  const codePoint = Number.parseInt(hex, 16);
  return isCjkUiCharacter(codePoint) ? String.fromCodePoint(codePoint) : match;
});

if (result === source) {
  console.log(`No CJK Unicode escapes found in ${target}`);
} else {
  fs.writeFileSync(absolutePath, result, "utf8");
  console.log(`Decoded CJK Unicode escapes in ${target}`);
}
