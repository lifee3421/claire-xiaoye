import fs from "node:fs";

const file = "src/App.jsx";
let text = fs.readFileSync(file, "utf8");

function replaceOnce(before, after, label) {
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one anchor, found ${count}`);
  text = text.replace(before, after);
}

replaceOnce(
  'import { resolveInitialPlannerDraft } from "./schedule/plannerDatePersistence.js";',
  'import { isPlannerDateShell, mergePlannerArchives, resolveInitialPlannerDraft, resolveRemotePlannerHydration } from "./schedule/plannerDatePersistence.js";',
  "planner date imports",
);

replaceOnce(
`function shouldReuseScheduleDraft(saved = {}) {
  const targetDate = saved?.targetDate || saved?.savedOn || "";
  return Boolean(
    saved &&
    targetDate &&
    targetDate >= beijingIsoDate()
  );
}`,
`function shouldReuseScheduleDraft(saved = {}) {
  const targetDate = saved?.targetDate || saved?.savedOn || "";
  return Boolean(
    saved &&
    targetDate &&
    targetDate >= beijingIsoDate() &&
    !isPlannerDateShell(saved)
  );
}`,
  "date shell reuse guard",
);

const beforeHydration = `    const nextSettings = mergeScheduleSettings(data.profile.scheduleAssistantSettings);
    const isNewCalendarDay = profileIdRef.current === data.profile.id && previousBeijingDayRef.current !== beijingDay;
    const savedDraftNeedsArchive = data.profile.scheduleAssistantDraft?.targetDate && !shouldReuseScheduleDraft(data.profile.scheduleAssistantDraft);
    const recoveryTargetDate = data.profile.scheduleAssistantDraft?.targetDate || beijingIsoDate(1);
    const localRecovery = plannerFeatureFlags.localRecovery ? loadPlannerRecovery(data.profile.id || "demo", recoveryTargetDate) : null;
    const newest = isNewCalendarDay
      ? { source: "remote" }
      : chooseNewestPlannerState(data.profile.scheduleAssistantDraft, localRecovery, beijingDay);
    const recoveredDraft = newest.source === "local" ? localRecovery?.draft : data.profile.scheduleAssistantDraft;
    if (isNewCalendarDay || savedDraftNeedsArchive) {
      setScheduleDraftArchive((current) => archivePlannerDraft(
        current,
        isNewCalendarDay ? draft : data.profile.scheduleAssistantDraft,
        isNewCalendarDay ? previousBeijingDayRef.current : data.profile.scheduleAssistantDraft?.savedOn || previousBeijingDayRef.current
      ));
    } else if (profileIdRef.current !== data.profile.id) {
      setScheduleDraftArchive(normalizeScheduleDraftArchive(data.profile.scheduleAssistantDraftArchive));
    }
    previousBeijingDayRef.current = beijingDay;
    profileIdRef.current = data.profile.id;`;

const afterHydration = `    const nextSettings = mergeScheduleSettings(data.profile.scheduleAssistantSettings);
    const isNewCalendarDay = profileIdRef.current === data.profile.id && previousBeijingDayRef.current !== beijingDay;
    const remoteHydration = resolveRemotePlannerHydration(data.profile, beijingDay);
    // Recovery is date-scoped to TODAY. A legacy live Tomorrow draft must not
    // choose Tomorrow's recovery snapshot and then overwrite the first Today
    // render during hydration.
    const recoveryTargetDate = beijingDay;
    const localRecovery = plannerFeatureFlags.localRecovery ? loadPlannerRecovery(data.profile.id || "demo", recoveryTargetDate) : null;
    const newest = isNewCalendarDay
      ? { source: "remote" }
      : chooseNewestPlannerState(remoteHydration.draft, localRecovery, beijingDay);
    const recoveredDraft = newest.source === "local" ? localRecovery?.draft : remoteHydration.draft;
    // Preserve every mismatched live day exactly once. At an in-place midnight
    // rollover the in-memory draft may be newer than Firestore, so merge it
    // too before switching the visible day to Today.
    const rolloverArchive = isNewCalendarDay && draft?.targetDate && draft.targetDate !== beijingDay
      ? mergePlannerArchives(remoteHydration.archive, [draft])
      : remoteHydration.archive;
    const recoveredArchive = newest.source === "local"
      ? mergePlannerArchives(rolloverArchive, normalizeScheduleDraftArchive(localRecovery?.scheduleDraftArchive))
      : normalizeScheduleDraftArchive(rolloverArchive);
    previousBeijingDayRef.current = beijingDay;
    profileIdRef.current = data.profile.id;`;
replaceOnce(beforeHydration, afterHydration, "hydration source selection");

replaceOnce(
`    setScheduleDraftArchive((current) => {
      const nextArchive = normalizeScheduleDraftArchive(newest.source === "local" ? localRecovery?.scheduleDraftArchive : data.profile.scheduleAssistantDraftArchive);
      return plannerValuesDeepEqual(current, nextArchive) ? current : nextArchive;
    });`,
`    setScheduleDraftArchive((current) => plannerValuesDeepEqual(current, recoveredArchive) ? current : recoveredArchive);`,
  "single archive hydration write",
);

fs.writeFileSync(file, text, "utf8");
console.log("planner hydration date-scope patch applied");
