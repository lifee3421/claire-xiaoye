import { useEffect, useMemo, useRef, useState } from "react";
import { allGroups, createReviewDraft, migrateFeatureDraft, otherSections } from "./dailyReviewSchema.js";
import { buildReviewMarkdown, buildStructuredReview } from "./reviewDraftSerializer.js";
import { buildSettlementInputFromReview } from "./reviewPointsAdapter.js";
import { parseReviewMarkdown } from "../utils/reviewParser.js";
import ReviewToolbar from "./ReviewToolbar.jsx";
import DailyReviewOverview from "./DailyReviewOverview.jsx";
import PointsSettlementPreview from "./PointsSettlementPreview.jsx";
import PointsSettlementBar from "./PointsSettlementBar.jsx";
import { runAutoDraftSave } from "./reviewSaveCoordinator.js";
import ScrollToTopButton from "./ScrollToTopButton.jsx";
import ReviewSummaryDashboard from "./ReviewSummaryDashboard.jsx";
import ReviewQuickCalibration from "./ReviewQuickCalibration.jsx";
import { calculatePeriodDay } from "./periodTracking.js";
import { resolveDefaultMinutesForAdd } from "./reviewStudyLeafDefaults.js";
import { findStudyLeaf } from "./reviewStudyLeafConfig.js";
import { buildReviewTaxonomyModel, setCategoryEntryField, getCategoryVisibility, resolveDynamicDefaultMinutesForAdd, findNodeById as findTaxonomyNodeById } from "./reviewTaxonomyModel.js";

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

export default function DailyReviewWorkbench({ profile, taxonomy = [], settlements = [], dailyReviewDrafts = [], diaryEntries = [], onSubmit, onSaveDraft, onSaveProfile }) {
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
  const [dailyReviewUi, setDailyReviewUi] = useState(() => profile?.dailyReviewUi || {});
  const [dailyReviewUiError, setDailyReviewUiError] = useState("");
  // profile.periodCycle already exists (HealthQuickCards in App.jsx reads/
  // writes it as { status: "active"|"inactive", startedOn, endedOn }, and it
  // is already whitelisted in dataService.saveProfileSettings). Reusing the
  // exact same field — instead of the profile.healthTracking.period this
  // workbench previously invented — means starting/ending a cycle here and
  // on the other health card stay in sync instead of silently disagreeing.
  const [periodCycle, setPeriodCycle] = useState(() => profile?.periodCycle || { status: "inactive", startedOn: "", endedOn: "" });
  const saving = saveState.phase === "saving";
  const existing = useMemo(() => settlements.find((item) => item.reviewDate === date), [settlements, date]);
  const savedDraft = useMemo(() => dailyReviewDrafts.find((item) => item.date === date), [dailyReviewDrafts, date]);
  const legacyReadOnly = Boolean(existing && !hasCompleteStructuredReview(existing));

  useEffect(() => { saveDraftRef.current = onSaveDraft; }, [onSaveDraft]);
  useEffect(() => {
    setDailyReviewUi(profile?.dailyReviewUi || {});
  }, [profile?.dailyReviewUi]);
  useEffect(() => {
    setPeriodCycle(profile?.periodCycle || { status: "inactive", startedOn: "", endedOn: "" });
  }, [profile?.periodCycle]);
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
  // Every "customize what shows on the main page" preference (which
  // duration fields, which study subjects stay pinned, mood/body tag
  // lists, archived work groups) lives under profile.dailyReviewUi and
  // shares this one optimistic-update + rollback-on-failure path.
  const saveDailyReviewUi = async (partial, errorLabel) => {
    const previous = dailyReviewUi;
    const next = { ...previous, ...partial };
    setDailyReviewUi(next);
    setDailyReviewUiError("");
    if (!onSaveProfile) return;
    try {
      await onSaveProfile({ dailyReviewUi: next });
    } catch (error) {
      setDailyReviewUi(previous);
      setDailyReviewUiError(`${errorLabel}保存失败：${error.message || "请重试"}`);
    }
  };
  const quickFieldConfig = dailyReviewUi.quickDurationFields || {};
  const onQuickFieldConfigChange = (sectionId, ids) =>
    saveDailyReviewUi({ quickDurationFields: { ...quickFieldConfig, [sectionId]: ids } }, "快捷项设置");

  // Cross-date "always show" list for individual study leaves (线性代数,
  // 雅思口语, ...) — a profile preference. Contrast with addStudyLeafToday
  // below, which is scoped to draft.ui and never touches this.
  const defaultStudyLeaves = dailyReviewUi.defaultStudyLeaves || [];
  const onToggleDefaultStudyLeaf = (leafKey) => {
    const next = defaultStudyLeaves.includes(leafKey)
      ? defaultStudyLeaves.filter((key) => key !== leafKey)
      : [...defaultStudyLeaves, leafKey];
    saveDailyReviewUi({ defaultStudyLeaves: next }, "学习项默认显示设置");
  };

  const studyLeafDefaults = dailyReviewUi.studyLeafDefaults || {};
  const onSetStudyLeafDefaultMinutes = (leafKey, minutes) => {
    const next = { ...studyLeafDefaults, [leafKey]: { ...studyLeafDefaults[leafKey], defaultMinutes: minutes } };
    saveDailyReviewUi({ studyLeafDefaults: next }, "学习项默认时长设置");
  };

  // Today-only add/remove for a specific study leaf. This is draft-scoped
  // (draft.ui.studyLeafVisibility), never profile-scoped, so it can never
  // leak into another date — that was the bug in the previous round.
  const addStudyLeafToday = (leafKey) => setDraft((current) => {
    const visibility = current.ui?.studyLeafVisibility || { added: [], hidden: [] };
    if (visibility.added.includes(leafKey)) return current;
    const defaultMinutes = resolveDefaultMinutesForAdd(leafKey, studyLeafDefaults, "");
    const durationFieldId = findStudyLeaf(leafKey)?.item?.durationId;
    let nextFields = current.fields;
    if (defaultMinutes !== null && durationFieldId) {
      const currentValue = current.fields[durationFieldId]?.value;
      if (currentValue === "" || currentValue === null || currentValue === undefined) {
        nextFields = { ...current.fields, [durationFieldId]: { ...current.fields[durationFieldId], value: defaultMinutes, autoValue: defaultMinutes, source: "default" } };
      }
    }
    return {
      ...current,
      status: "editing",
      fields: nextFields,
      ui: { ...current.ui, studyLeafVisibility: { added: [...visibility.added, leafKey], hidden: visibility.hidden.filter((key) => key !== leafKey) } },
    };
  });
  const removeStudyLeafToday = (leafKey) => setDraft((current) => {
    const visibility = current.ui?.studyLeafVisibility || { added: [], hidden: [] };
    return {
      ...current,
      ui: {
        ...current.ui,
        studyLeafVisibility: {
          added: visibility.added.filter((key) => key !== leafKey),
          hidden: visibility.hidden.includes(leafKey) ? visibility.hidden : [...visibility.hidden, leafKey],
        },
      },
    };
  });

  // Taxonomy-driven daily review: dynamic (no static schema field) leaves
  // under project/work/hobby/entertainment/family/misc/study. Storage is
  // draft.categoryReviewEntries; today-only add/remove is draft.ui.categoryVisibility
  // (kept separate from draft.ui.studyLeafVisibility so it never leaks across
  // dates and never touches profile).
  const isHistoricalDate = date !== todayDate();
  const taxonomyModel = useMemo(
    () => buildReviewTaxonomyModel({ taxonomy, draft, reviewDate: date, isHistoricalDate }),
    [taxonomy, draft, date, isHistoricalDate]
  );
  const changeCategoryEntry = (categoryId, field, rawValue) => setDraft((current) => {
    const value = field === "duration" ? (rawValue === "" ? "" : Number(rawValue)) : rawValue;
    const next = setCategoryEntryField(current, categoryId, field, value);
    return { ...next, status: "editing", updatedAt: new Date().toISOString() };
  });
  const addDynamicCategoryToday = (categoryId) => setDraft((current) => {
    const visibility = getCategoryVisibility(current);
    if (visibility.added.includes(categoryId)) return current;
    const node = findTaxonomyNodeById(taxonomy, categoryId);
    const defaultMinutes = node ? resolveDynamicDefaultMinutesForAdd(node, current, categoryId) : null;
    let next = { ...current, ui: { ...current.ui, categoryVisibility: { added: [...visibility.added, categoryId], hidden: visibility.hidden.filter((id) => id !== categoryId) } } };
    if (defaultMinutes !== null) next = setCategoryEntryField(next, categoryId, "duration", defaultMinutes);
    return { ...next, status: "editing" };
  });
  const removeDynamicCategoryToday = (categoryId) => setDraft((current) => {
    const visibility = getCategoryVisibility(current);
    return {
      ...current,
      ui: {
        ...current.ui,
        categoryVisibility: {
          added: visibility.added.filter((id) => id !== categoryId),
          hidden: visibility.hidden.includes(categoryId) ? visibility.hidden : [...visibility.hidden, categoryId],
        },
      },
    };
  });

  const startPeriodCycle = () => {
    if (periodCycle.status === "active") return;
    const previous = periodCycle;
    const next = { status: "active", startedOn: date, endedOn: "" };
    setPeriodCycle(next);
    if (onSaveProfile) {
      onSaveProfile({ periodCycle: next }).catch((error) => {
        setPeriodCycle(previous);
        setDailyReviewUiError(`经期记录保存失败：${error.message || "请重试"}`);
      });
    }
  };
  const endPeriodCycle = () => {
    const previous = periodCycle;
    const next = { ...periodCycle, status: "inactive", endedOn: date };
    setPeriodCycle(next);
    if (onSaveProfile) {
      onSaveProfile({ periodCycle: next }).catch((error) => {
        setPeriodCycle(previous);
        setDailyReviewUiError(`经期记录保存失败：${error.message || "请重试"}`);
      });
    }
  };
  const periodDay = periodCycle.status === "active" ? calculatePeriodDay(periodCycle.startedOn, date) : null;

  const quickChoicesConfig = dailyReviewUi.quickChoices || {};
  const onQuickChoicesChange = (kind, options) =>
    saveDailyReviewUi({ quickChoices: { ...quickChoicesConfig, [kind]: options } }, "标签设置");

  const archivedWorkGroups = dailyReviewUi.archivedWorkGroups || [];
  const onToggleArchivedWorkGroup = (groupTitle) => {
    const next = archivedWorkGroups.includes(groupTitle)
      ? archivedWorkGroups.filter((title) => title !== groupTitle)
      : [...archivedWorkGroups, groupTitle];
    saveDailyReviewUi({ archivedWorkGroups: next }, "工作项归档设置");
  };
  // Revising an already-submitted day prefers its saved taxonomySnapshot (the
  // historical name/color at settlement time) over the live taxonomy, so a
  // category renamed/archived since never rewrites past exports.
  const taxonomySnapshot = existing?.structuredReview?.taxonomySnapshot || [];
  const exportMarkdown = () => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([buildReviewMarkdown(draft, profile, { taxonomy, taxonomySnapshot })], { type: "text/markdown;charset=utf-8" }));
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
      // periodDay is computed for display only while editing — it's only
      // written into the persisted record here, at submit time, so ending
      // or restarting a cycle later never rewrites a past day's number.
      const draftForSubmit = periodDay === null ? draft : {
        ...draft,
        fields: { ...draft.fields, "selfcare.today.periodDay": { ...draft.fields["selfcare.today.periodDay"], value: periodDay, autoValue: periodDay, source: "default" } },
      };
      const structuredReview = buildStructuredReview(draftForSubmit, { taxonomy });
      const diaryContent = draftForSubmit.fields["diary.content"]?.value || "";
      const diaryExisting = diaryEntries.find((item) => item.date === date);
      let strategy = "overwrite";
      if (diaryContent && diaryExisting && (diaryExisting.manuallyEdited || diaryExisting.source === "manual")) {
        const choice = window.prompt("今天的日记已手动编辑：1 覆盖，2 只补标签，3 取消", "2");
        if (choice === "3" || choice === null) strategy = "cancel";
        else strategy = choice === "1" ? "overwrite" : "tags";
      }
      await onSubmit({ ...settlement, rawReview: buildReviewMarkdown(draftForSubmit, profile, { taxonomy, taxonomySnapshot: structuredReview.taxonomySnapshot }), reviewData: structuredReview, structuredReview, reviewSchemaVersion: 2, reviewDraftDate: date, manualOverridePaths: structuredReview.manualOverridePaths, existingSettlementId: existing?.id || "" }, draftForSubmit, { sync: Boolean(diaryContent), diary: diaryContent ? { title: draftForSubmit.fields["diary.title"]?.value || "", content: diaryContent, rawTags: draftForSubmit.fields["diary.tags"]?.value || "" } : null, strategy });
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

      {dailyReviewUiError && (
        <p className="review-save-state error" role="alert">
          {dailyReviewUiError}
        </p>
      )}

      <DailyReviewOverview
        draft={draft}
        profile={profile}
        taxonomy={taxonomy}
        settlement={settlement}
        pointDelta={pointDelta}
        onChange={change}
        disabled={legacyReadOnly}
      />

      <ReviewQuickCalibration draft={draft} />

      <ReviewSummaryDashboard
        sections={sections}
        draft={draft}
        date={date}
        onChange={change}
        onRestore={restore}
        onAddProject={addProject}
        onRemoveProject={removeProject}
        quickFieldConfig={quickFieldConfig}
        onQuickFieldConfigChange={onQuickFieldConfigChange}
        defaultStudyLeaves={defaultStudyLeaves}
        onToggleDefaultStudyLeaf={onToggleDefaultStudyLeaf}
        studyLeafDefaults={studyLeafDefaults}
        onSetStudyLeafDefaultMinutes={onSetStudyLeafDefaultMinutes}
        onAddStudyLeafToday={addStudyLeafToday}
        onRemoveStudyLeafToday={removeStudyLeafToday}
        periodState={periodCycle}
        periodDay={periodDay}
        onStartPeriodCycle={startPeriodCycle}
        onEndPeriodCycle={endPeriodCycle}
        quickChoicesConfig={quickChoicesConfig}
        onQuickChoicesChange={onQuickChoicesChange}
        archivedWorkGroups={archivedWorkGroups}
        onToggleArchivedWorkGroup={onToggleArchivedWorkGroup}
        taxonomy={taxonomy}
        taxonomyModel={taxonomyModel}
        isHistoricalDate={isHistoricalDate}
        onChangeCategoryEntry={changeCategoryEntry}
        onAddDynamicCategoryToday={addDynamicCategoryToday}
        onRemoveDynamicCategoryToday={removeDynamicCategoryToday}
        disabled={legacyReadOnly}
      />

      <div className="review-settlement-widget">
        <PointsSettlementPreview settlement={settlement} open={detailOpen} />

        <PointsSettlementBar
          pointDelta={pointDelta}
          profile={profile}
          saving={saving || !loaded || legacyReadOnly}
          onSubmit={submit}
          revision={Boolean(existing)}
          detailOpen={detailOpen}
          onToggleDetail={() => setDetailOpen((current) => !current)}
        />
      </div>

      <ScrollToTopButton />
    </section>
  );
}
