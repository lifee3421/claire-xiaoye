import { useEffect, useMemo, useRef, useState } from "react";
import { allGroups, createReviewDraft, migrateFeatureDraft, otherSections, WORKBENCH_SECTION_ORDER } from "./dailyReviewSchema.js";
import { buildReviewMarkdown, buildStructuredReview } from "./reviewDraftSerializer.js";
import { buildSettlementInputFromReview } from "./reviewPointsAdapter.js";
import { parseReviewMarkdown } from "../utils/reviewParser.js";
import ReviewToolbar from "./ReviewToolbar.jsx";
import DailyReviewOverview from "./DailyReviewOverview.jsx";
import { ReviewDashboardLayout } from "./ReviewColumns.jsx";
import PointsSettlementPreview from "./PointsSettlementPreview.jsx";
import PointsSettlementBar from "./PointsSettlementBar.jsx";
import { runAutoDraftSave } from "./reviewSaveCoordinator.js";
import ScrollToTopButton from "./ScrollToTopButton.jsx";

const todayDate = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
const legacySettlementMessage = "旧版记录尚未完整迁移，为避免覆盖原数据，暂不可修订";

function hasCompleteStructuredReview(settlement) {
  const review = settlement?.structuredReview;
  return Boolean(review?.fields && typeof review.fields === "object" && Object.keys(review.fields).length && (review.schemaVersion === 2 || settlement.reviewSchemaVersion === 2));
}

function fromSettlement(settlement, profile) {
  const candidate = settlement?.structuredReview || settlement?.reviewData;
  if (candidate?.fields) return migrateFeatureDraft({ ...candidate, date: settlement.reviewDate || candidate.date }, profile);
  const draft = createReviewDraft(settlement?.reviewDate || todayDate(), profile);
  const parsed = settlement?.rawReview ? parseReviewMarkdown(settlement.rawReview) : settlement || {};
  const put = (id, value) => {
    if (value !== undefined && value !== null && value !== "") draft.fields[id] = { ...draft.fields[id], value, autoValue: value, source: "legacy" };
  };
  put("study.math.totalMinutes", parsed.subjects?.math?.minutes);
  put("study.professional.totalMinutes", parsed.subjects?.economy?.minutes);
  put("study.english.totalMinutes", parsed.subjects?.english?.minutes);
  put("study.japanese.totalMinutes", parsed.subjects?.japanese?.minutes);
  put("study.reading.totalMinutes", parsed.readingMinutes || parsed.subjects?.reading?.minutes);
  put("work.redCross.totalMinutes", parsed.subjects?.work?.minutes);
  put("exercise.today.totalMinutes", parsed.exerciseMinutes);
  put("entertainment.today.totalMinutes", parsed.totalEntertainmentMinutes);
  put("sleep.yesterday.bedtime", parsed.bedtime);
  put("sleep.yesterday.durationText", parsed.sleepDuration);
  put("study.reading.bookTitle", parsed.readingBookTitle);
  put("study.reading.feeling", parsed.readingFeeling);
  put("selfcare.today.basicSkincare", parsed.health?.basicSkincareDone ? "是" : "否");
  put("selfcare.today.mask", parsed.health?.maskStatus === "已敷" ? "是" : "否/未确认");
  put("selfcare.today.waterMl", parsed.health?.waterMl);
  return draft;
}

export default function DailyReviewWorkbench({ profile, settlements = [], dailyReviewDrafts = [], diaryEntries = [], onSubmit, onSaveDraft }) {
  const toolbarRef = useRef(null);
  const saveDraftRef = useRef(onSaveDraft);
  const debounce = useRef();
  const formalSavingRef = useRef(false);
  const autoSavePromiseRef = useRef(Promise.resolve());
  const [date, setDate] = useState(todayDate);
  const [draft, setDraft] = useState(() => createReviewDraft(todayDate(), profile));
  const [saveState, setSaveState] = useState({ phase: "idle", message: "" });
  const [loaded, setLoaded] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const saving = saveState.phase === "saving";
  const existing = useMemo(() => settlements.find((item) => item.reviewDate === date), [settlements, date]);
  const savedDraft = useMemo(() => dailyReviewDrafts.find((item) => item.date === date), [dailyReviewDrafts, date]);
  const legacyReadOnly = Boolean(existing && !hasCompleteStructuredReview(existing));

  useEffect(() => { saveDraftRef.current = onSaveDraft; }, [onSaveDraft]);
  useEffect(() => {
    setLoaded(false);
    const saved = savedDraft?.fields ? migrateFeatureDraft(savedDraft, profile) : null;
    const hasSavedFacts = Object.values(saved?.fields || {}).some((field) => field.value !== "" && field.value !== null && field.value !== undefined);
    setDraft(saved && (!existing || hasSavedFacts) ? saved : existing ? fromSettlement(existing, profile) : createReviewDraft(date, profile));
    setSaveState({ phase: "idle", message: "" });
    setLoaded(true);
  }, [date, savedDraft, existing, profile]);
  useEffect(() => {
    if (!loaded || legacyReadOnly || draft.status === "submitted") return undefined;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      if (formalSavingRef.current) return;
      setSaveState({ phase: "saving", message: "正在保存草稿…" });
      const automaticSave = runAutoDraftSave({
        formalSavingRef,
        payload: { ...draft, status: draft.status === "not_generated" ? "auto_draft" : draft.status },
        save: saveDraftRef.current,
        onSuccess: () => setSaveState({ phase: "success", message: "草稿已保存" }),
        onError: (error) => setSaveState({ phase: "error", message: `草稿保存失败：${error.message || "请重试"}` }),
      });
      autoSavePromiseRef.current = automaticSave;
    }, 700);
    return () => clearTimeout(debounce.current);
  }, [draft, loaded, legacyReadOnly]);

  const sections = useMemo(() => allGroups(profile, draft.temporaryProjects), [profile, draft.temporaryProjects]);
  const settlement = useMemo(() => buildSettlementInputFromReview(draft, profile, todayDate()), [draft, profile]);
  const pointDelta = Number(settlement.pointsAdded || 0) - Number(existing?.pointsAdded || 0);
  const status = legacyReadOnly ? legacySettlementMessage : saving ? "保存中" : saveState.phase === "error" ? "保存失败" : saveState.phase === "success" ? "已保存" : existing ? "已保存，可修订" : draft.status === "editing" ? "已修改" : draft.status === "auto_draft" ? "草稿" : "未生成";
  const fields = [...sections.flatMap((section) => section.groups), ...otherSections].flatMap((group) => group.fields);
  const change = (id, rawValue) => setDraft((current) => {
    const field = fields.find((item) => item.id === id);
    const value = ["duration", "score"].includes(field?.kind) ? (rawValue === "" ? "" : Number(rawValue)) : rawValue;
    const next = { ...current, status: "editing", updatedAt: new Date().toISOString(), fields: { ...current.fields, [id]: { ...(current.fields[id] || {}), value, manuallyEdited: true, source: "manual", editedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } } };
    fields.filter((item) => item.parts?.includes(id) && !current.fields[item.id]?.manuallyEdited).forEach((total) => {
      const totalValue = total.parts.reduce((sum, part) => sum + Number(next.fields[part]?.value || 0), 0);
      next.fields[total.id] = { ...next.fields[total.id], value: totalValue, autoValue: totalValue, source: "default" };
    });
    return next;
  });
  const restore = (id) => setDraft((current) => {
    const field = fields.find((item) => item.id === id);
    const automatic = field?.parts ? field.parts.reduce((sum, part) => sum + Number(current.fields[part]?.value || 0), 0) : current.fields[id].autoValue;
    return { ...current, fields: { ...current.fields, [id]: { ...current.fields[id], value: automatic, autoValue: automatic, manuallyEdited: false, source: "default" } } };
  });
  const addProject = () => {
    const name = window.prompt("今天的临时项目名称");
    if (!name?.trim()) return;
    const temporaryId = crypto.randomUUID();
    setDraft((current) => ({ ...current, status: "editing", temporaryProjects: [...current.temporaryProjects, { name: name.trim(), id: `temp-${temporaryId}`, temporaryId }] }));
  };
  const removeProject = (temporaryId) => setDraft((current) => ({ ...current, status: "editing", temporaryProjects: current.temporaryProjects.filter((item) => item.temporaryId !== temporaryId) }));
  const exportMarkdown = () => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([buildReviewMarkdown(draft, profile)], { type: "text/markdown;charset=utf-8" }));
    link.download = `${date}-复盘.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const submit = async () => {
    if (!loaded || saving || legacyReadOnly) return;
    clearTimeout(debounce.current);
    formalSavingRef.current = true;
    setSaveState({ phase: "saving", message: "正在保存复盘…" });
    try {
      await autoSavePromiseRef.current;
      const structuredReview = buildStructuredReview(draft);
      const diaryContent = draft.fields["diary.content"]?.value || "";
      const diaryExisting = diaryEntries.find((item) => item.date === date);
      let strategy = "overwrite";
      if (diaryContent && diaryExisting && (diaryExisting.manuallyEdited || diaryExisting.source === "manual")) {
        const choice = window.prompt("今天的日记已手动编辑：1 覆盖，2 只补标签，3 取消", "2");
        if (choice === "3" || choice === null) strategy = "cancel";
        else strategy = choice === "1" ? "overwrite" : "tags";
      }
      await onSubmit({ ...settlement, rawReview: buildReviewMarkdown(draft, profile), reviewData: structuredReview, structuredReview, reviewSchemaVersion: 2, reviewDraftDate: date, manualOverridePaths: structuredReview.manualOverridePaths, existingSettlementId: existing?.id || "" }, draft, { sync: Boolean(diaryContent), diary: diaryContent ? { title: draft.fields["diary.title"]?.value || "", content: diaryContent, rawTags: draft.fields["diary.tags"]?.value || "" } : null, strategy });
      setDraft((current) => ({ ...current, status: "submitted", submittedAt: new Date().toISOString(), linkedSettlementId: existing?.id || current.linkedSettlementId }));
      setSaveState({ phase: "success", message: "复盘与结算已保存" });
    } catch (error) {
      setSaveState({ phase: "error", message: `保存失败：${error.message || "请重试"}` });
    } finally {
      formalSavingRef.current = false;
    }
  };

  return (
    <section className="review-workbench">
      <div ref={toolbarRef}>
        <ReviewToolbar
          date={date}
          status={status}
          saving={saving || !loaded}
          readOnly={legacyReadOnly}
          onDate={setDate}
          onExport={exportMarkdown}
          onSubmit={submit}
        />
      </div>

      {saveState.phase === "error" && (
        <p className="review-save-state error" role="alert">
          {saveState.message}
        </p>
      )}

      {legacyReadOnly && (
        <p className="review-save-state">
          {legacySettlementMessage}
        </p>
      )}

      <DailyReviewOverview
        draft={draft}
        profile={profile}
        settlement={settlement}
        pointDelta={pointDelta}
        onChange={change}
        disabled={legacyReadOnly}
      />

      <ReviewDashboardLayout
        sections={sections}
        otherSections={otherSections}
        draft={draft}
        onChange={change}
        onRestore={restore}
        onAddProject={addProject}
        onRemoveProject={removeProject}
        disabled={legacyReadOnly}
      />

      <PointsSettlementPreview
        settlement={settlement}
        pointDelta={pointDelta}
        profile={profile}
        open={detailOpen}
        setOpen={setDetailOpen}
      />

      <PointsSettlementBar
        pointDelta={pointDelta}
        profile={profile}
        saving={saving || !loaded || legacyReadOnly}
        onSubmit={submit}
        revision={Boolean(existing)}
      />

      <ScrollToTopButton />
    </section>
  );
}
