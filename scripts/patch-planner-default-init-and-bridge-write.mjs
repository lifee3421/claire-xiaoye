import fs from "node:fs";

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`missing patch anchor: ${label}`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`ambiguous patch anchor: ${label}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

const appPath = "src/App.jsx";
let app = fs.readFileSync(appPath, "utf8");
const makeDraftStart = app.indexOf("function makeScheduleDraft(saved = {}, rawSettings = {}, autoContext = {}) {");
if (makeDraftStart < 0) throw new Error("makeScheduleDraft not found");
const makeDraftEnd = app.indexOf("\nfunction ", makeDraftStart + 10);
if (makeDraftEnd < 0) throw new Error("makeScheduleDraft end not found");
let makeDraft = app.slice(makeDraftStart, makeDraftEnd);

makeDraft = replaceOnce(
  makeDraft,
  "  const baseDraft = {\n",
  "  const uninitializedBaseDraft = {\n",
  "fresh base draft declaration",
);

const freshDraftStart = makeDraft.indexOf("  const uninitializedBaseDraft = {\n");
const freshDraftClose = makeDraft.indexOf("\n  };\n", freshDraftStart);
if (freshDraftClose < 0) throw new Error("fresh base draft closing brace not found");
const insertionPoint = freshDraftClose + "\n  };\n".length;
const defaultTemplateInitialization = `\n  // A selected default template is the initializer for a genuinely new day,\n  // not merely metadata on an otherwise-empty draft. Reusing an existing\n  // same-day draft must never re-apply the template: an intentionally emptied\n  // or manually edited day belongs to the user.\n  const defaultTemplate = !shouldReuseSaved\n    ? normalizePlannerTemplates(settings.dayTemplates, settings.deletedDayTemplateSystemKeys)\n      .find((template) => template.id === settings.defaultDayTemplateId)\n    : null;\n  const baseDraft = defaultTemplate\n    ? instantiateTemplateForDay(defaultTemplate, uninitializedBaseDraft, {\n        boundaries: true,\n        fixedEvents: true,\n        defaultTasks: true,\n        // Match the manual \"应用模板\" default: seed the day's cards, but do\n        // not force a saved timeline onto a fresh day unless the user asks.\n        timeline: false,\n      })\n    : uninitializedBaseDraft;\n`;
makeDraft = makeDraft.slice(0, insertionPoint) + defaultTemplateInitialization + makeDraft.slice(insertionPoint);

app = app.slice(0, makeDraftStart) + makeDraft + app.slice(makeDraftEnd);
fs.writeFileSync(appPath, app);

const proposalPath = "api/planner-proposal.js";
let proposal = fs.readFileSync(proposalPath, "utf8");
proposal = replaceOnce(
  proposal,
  '      transaction.get(proposalsRef.where("targetDate", "==", body.targetDate).where("status", "==", "open")),\n',
  '      // Query only by date and filter open proposals in memory. A single-field\n      // Firestore query is index-safe in every deployment; proposal counts per\n      // day are tiny, so the extra local filter costs effectively nothing.\n      transaction.get(proposalsRef.where("targetDate", "==", body.targetDate)),\n',
  "same-day proposal query",
);
proposal = replaceOnce(
  proposal,
  "    const supersedePatches = supersedeOpenProposalsForDate(sameDaySnap.docs.map((doc) => doc.data()), body.targetDate, { excludeId: body.id, newProposalId: body.id, now });\n",
  "    const openSameDayProposals = sameDaySnap.docs\n      .map((doc) => doc.data())\n      .filter((proposal) => proposal?.status === \"open\");\n    const supersedePatches = supersedeOpenProposalsForDate(openSameDayProposals, body.targetDate, { excludeId: body.id, newProposalId: body.id, now });\n",
  "same-day open proposal filtering",
);
proposal = replaceOnce(
  proposal,
  '    res.status(500).json({ error: error?.message || "internal error" });\n',
  '    res.status(500).json({ code: "planner_proposal_write_failed", error: error?.message || "internal error" });\n',
  "proposal write error code",
);
fs.writeFileSync(proposalPath, proposal);

// One-shot helper: leave the product tree clean after the branch patches itself.
for (const path of [
  "scripts/patch-planner-default-init-and-bridge-write.mjs",
  ".github/workflows/patch-planner-default-init-and-bridge-write.yml",
]) {
  if (fs.existsSync(path)) fs.rmSync(path);
}
