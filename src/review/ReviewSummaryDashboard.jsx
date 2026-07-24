import { useState } from "react";
import {
  CATEGORY_EDITOR_CONFIG,
  effectiveValue,
  findCategorySection,
  formatMinutes,
  groupTotalMinutes,
  numericValue,
  summarizeGroup,
  deriveGroupCategoryId,
} from "./reviewSectionConfig.js";
import { DEFAULT_QUICK_DURATION_FIELDS, getQuickDurationFieldIds } from "./reviewQuickFieldConfig.js";
import { getQuickChoiceOptions, toggleMultiSelectValue, withHistoryOptions, MOOD_TAG_MAX_SELECTION, BODY_CONDITION_MAX_SELECTION } from "./reviewQuickChoices.js";
import { isAfterMidnightBedtime } from "./sleepTiming.js";
import {
  categoryEntryValue,
  categoryEntryNumericValue,
  hasCategoryEntryContent,
  getAddableDynamicLeaves,
  buildStudyGroupsFromTaxonomy,
  listAllStudyLeavesFromTaxonomy,
  sumStudyGroupMinutes,
  findNodeById,
} from "./reviewTaxonomyModel.js";
import { shouldShowTaxonomyNode } from "../taxonomy/taxonomyContract.js";
import InlineDurationInput from "./InlineDurationInput.jsx";
import FiveLevelSelector from "./FiveLevelSelector.jsx";
import { BoltIcon } from "./ratingIcons.jsx";
import QuickToggle from "./QuickToggle.jsx";
import QuickFieldSettings from "./QuickFieldSettings.jsx";
import QuickChoiceSettings from "./QuickChoiceSettings.jsx";
import ReviewField from "./ReviewField.jsx";
import { addTag, parseTagsText, removeTagAt } from "./diaryTags.js";

const SAFE_FIELD_STATE = { value: "", autoValue: "", source: "default", manuallyEdited: false };

function MultiChoice({ label, value, options, historyOptions = [], maxSelection, onChange, disabled }) {
  const selected = new Set(String(value || "").split(/[,，]+/).map((v) => v.trim()).filter(Boolean));

  return (
    <div className="review-quick-choice">
      <span>{label}</span>

      <div>
        {[...options, ...historyOptions].map((option) => (
          <button
            key={option}
            type="button"
            disabled={disabled}
            className={selected.has(option) ? "is-active" : ""}
            onClick={() => onChange(toggleMultiSelectValue(value, option, maxSelection))}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function QuickChoice({ label, value, options, onChange, disabled }) {
  return (
    <div className="review-quick-choice">
      <span>{label}</span>

      <div>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            disabled={disabled}
            className={value === option ? "is-active" : ""}
            onClick={() => onChange(value === option ? "" : option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

// Long-form fields expand in place inside the card — no drawer, no second
// surface. `fields` is a flat list of schema field objects.
function ExpandInPlace({ sectionId, label, fields, draft, onChange, onRestore, disabled, expandedSections, toggleExpanded }) {
  if (!fields.length) return null;
  const isOpen = Boolean(expandedSections[sectionId]);

  return (
    <div className="review-inline-expand">
      <button
        type="button"
        className="review-expand-toggle"
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => toggleExpanded(sectionId)}
      >
        {isOpen ? "收起" : label}
      </button>

      {isOpen && (
        <div className="review-expand-body">
          {fields.map((field) => (
            <ReviewField
              key={field.id}
              field={field}
              state={draft?.fields?.[field.id] || SAFE_FIELD_STATE}
              onChange={onChange}
              onRestore={onRestore}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Same idea, but grouped — used by category cards with multiple groups
// (项目 with dynamic entries, 工作 with 红会/党团) so each group's long
// fields stay under its own sub-heading instead of being flattened together.
function CategoryExpandInPlace({ sectionId, label, groups, draft, onChange, onRestore, disabled, expandedSections, toggleExpanded }) {
  const groupsWithLongFields = groups
    .map((group) => ({ group, fields: (group.fields || []).filter((field) => field.kind === "text") }))
    .filter((entry) => entry.fields.length > 0);

  if (!groupsWithLongFields.length) return null;
  const isOpen = Boolean(expandedSections[sectionId]);

  return (
    <div className="review-inline-expand">
      <button
        type="button"
        className="review-expand-toggle"
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => toggleExpanded(sectionId)}
      >
        {isOpen ? "收起" : label}
      </button>

      {isOpen && (
        <div className="review-expand-body">
          {groupsWithLongFields.map(({ group, fields }) => (
            <div className="review-expand-group" key={`${group.title}-${group.temporaryId || "fixed"}`}>
              {groupsWithLongFields.length > 1 && <p className="review-expand-group__title">{group.title}</p>}

              {fields.map((field) => (
                <ReviewField
                  key={field.id}
                  field={field}
                  state={draft?.fields?.[field.id] || SAFE_FIELD_STATE}
                  onChange={onChange}
                  onRestore={onRestore}
                  disabled={disabled}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// One row per SPECIFIC study item (线性代数, 雅思口语, ...) — never a whole
// subject lumped into one progress box. `item` comes from
// buildStudyGroupsFromTaxonomy: for a bound leaf (has a REVIEW_BINDINGS
// entry) values live in draft.fields via item.durationId/progressId/
// adjustmentId; for a dynamic leaf (taxonomy-only, no binding) values live
// in draft.categoryReviewEntries[item.id] and which fields render is driven
// by item.node.reviewConfig. Duration | 今日推进 | 今日调整 side by side,
// plus a per-row "移除今日" for anything the user doesn't want to see today
// (confirms first if the row actually has content, since removal only
// hides it — it never deletes the field value).
function StudyLeafRow({ item, draft, onChange, onChangeCategoryEntry, onRemoveToday, onRemoveDynamicCategoryToday, disabled }) {
  const reviewConfig = item.node?.reviewConfig;
  const showDuration = item.dynamic ? Boolean(reviewConfig?.recordDuration) : Boolean(item.durationId);
  const showProgress = item.dynamic ? Boolean(reviewConfig?.recordProgress) : Boolean(item.progressId);
  const showAdjustment = item.dynamic ? Boolean(reviewConfig?.recordAdjustment) : Boolean(item.adjustmentId);

  const durationValue = item.dynamic ? categoryEntryNumericValue(draft, item.id, "duration") : numericValue(draft, item.durationId);
  const progressValue = item.dynamic ? categoryEntryValue(draft, item.id, "progress") : effectiveValue(draft, item.progressId);
  const adjustmentValue = item.dynamic ? categoryEntryValue(draft, item.id, "adjustment") : effectiveValue(draft, item.adjustmentId);

  const handleRemove = () => {
    if (item.hasContent) {
      const confirmed = window.confirm("这项已经填写了内容。\n从今日页面隐藏不会删除数据，仍会计入统计。\n确认隐藏吗？");
      if (!confirmed) return;
    }
    if (item.dynamic) onRemoveDynamicCategoryToday(item.id);
    else onRemoveToday(item.legacyKey);
  };

  return (
    <div className="review-study-leaf-row">
      <span className="review-study-leaf-row__title">{item.title}</span>

      {showDuration && (
        <InlineDurationInput
          disabled={disabled}
          value={durationValue}
          onCommit={(minutes) => (item.dynamic ? onChangeCategoryEntry(item.id, "duration", minutes) : onChange(item.durationId, minutes))}
        />
      )}

      {showProgress && (
        <label className="review-study-leaf-row__note">
          <span className="sr-only">{item.title}今日推进</span>
          <textarea
            rows={2}
            placeholder="今日推进"
            value={progressValue}
            disabled={disabled}
            onChange={(event) => (item.dynamic ? onChangeCategoryEntry(item.id, "progress", event.target.value) : onChange(item.progressId, event.target.value))}
          />
        </label>
      )}

      {showAdjustment && (
        <label className="review-study-leaf-row__note">
          <span className="sr-only">{item.title}今日调整</span>
          <textarea
            rows={2}
            placeholder="今日调整"
            value={adjustmentValue}
            disabled={disabled}
            onChange={(event) => (item.dynamic ? onChangeCategoryEntry(item.id, "adjustment", event.target.value) : onChange(item.adjustmentId, event.target.value))}
          />
        </label>
      )}

      <button type="button" className="review-study-leaf-row__remove" disabled={disabled} onClick={handleRemove}>
        移除今日
      </button>
    </div>
  );
}

function StudyLeafGroupBlock({ group, draft, taxonomy, onChange, onChangeCategoryEntry, onRemoveToday, onRemoveDynamicCategoryToday, disabled }) {
  // Always the SAME computation source as DailyReviewOverview's "学习总时长"
  // metric and its bar chart (sumStudyGroupMinutes) — sums every leaf under
  // this group regardless of whether it's currently shown/hidden, so a leaf
  // hidden today with an already-recorded value still counts. Always shown,
  // even for a single-leaf group (math with only 高等数学 filled in still
  // shows "总计 40min" — the old `!isSingleItem` gate silently hid that).
  const total = sumStudyGroupMinutes(group.id, { taxonomy, draft });

  return (
    <div className="review-study-leaf-group">
      <div className="review-study-leaf-group__header">
        <span className="review-study-icon" style={group.color ? { background: group.color } : undefined}>{group.icon}</span>
        <strong>{group.title}</strong>
        <span className="review-study-leaf-group__total">总计 {formatMinutes(total)}</span>
      </div>

      <div className="review-study-leaf-list" id={group.id === "study.english" ? "review-card-study-english" : undefined}>
        {group.items.map((item) => (
          <StudyLeafRow
            key={item.id}
            item={item}
            draft={draft}
            onChange={onChange}
            onChangeCategoryEntry={onChangeCategoryEntry}
            onRemoveToday={onRemoveToday}
            onRemoveDynamicCategoryToday={onRemoveDynamicCategoryToday}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  );
}

// Single management surface (inline, not floating) for every study leaf,
// taxonomy-driven (allLeaves comes from listAllStudyLeavesFromTaxonomy —
// order/name/grouping/archived all read from classificationTaxonomy): show
// for today (draft-scoped), always show (profile-scoped pin, bound leaves
// only), and a per-leaf default duration. Bound leaves keep using the
// existing legacy-leafKey-keyed pin/default-minutes prefs (backward
// compatible); dynamic leaves' default minutes are configured once in
// TaxonomyManager's reviewConfig.defaultMinutes instead, so they have no
// pin/default-duration controls here.
function StudyLeafManager({
  allLeaves,
  defaultStudyLeaves,
  onToggleDefaultStudyLeaf,
  studyLeafDefaults,
  onSetStudyLeafDefaultMinutes,
  onAddStudyLeafToday,
  onRemoveStudyLeafToday,
  onAddDynamicCategoryToday,
  onRemoveDynamicCategoryToday,
  disabled,
  onClose,
}) {
  const groups = [];
  allLeaves.forEach((leaf) => {
    let group = groups.find((g) => g.id === leaf.groupId);
    if (!group) { group = { id: leaf.groupId, title: leaf.groupTitle, leaves: [] }; groups.push(group); }
    group.leaves.push(leaf);
  });

  return (
    <div className="review-inline-settings review-study-leaf-manager" role="group" aria-label="学习项管理">
      <header>
        <strong>学习项管理</strong>
        <span>今日显示只影响今天；默认显示会跨日期一直出现；默认时长只在"今日显示"打开的那一刻应用一次</span>
      </header>

      {groups.map((group) => (
        <div key={group.id} className="review-study-leaf-manager__group">
          <p className="review-study-leaf-manager__group-title">{group.title}</p>

          <ul>
            {group.leaves.map((leaf) => {
              const legacyKey = leaf.legacyKey;
              return (
                <li key={leaf.id} className="review-study-leaf-manager__row">
                  <label>
                    <input
                      type="checkbox"
                      checked={leaf.visible}
                      disabled={disabled}
                      onChange={() => {
                        if (leaf.dynamic) {
                          if (leaf.visible) onRemoveDynamicCategoryToday(leaf.id); else onAddDynamicCategoryToday(leaf.id);
                        } else if (leaf.visible) {
                          onRemoveStudyLeafToday(legacyKey);
                        } else {
                          onAddStudyLeafToday(legacyKey);
                        }
                      }}
                    />
                    {leaf.title}
                  </label>

                  {!leaf.dynamic && (
                    <label className="review-study-leaf-manager__pin">
                      <input
                        type="checkbox"
                        checked={defaultStudyLeaves.includes(legacyKey)}
                        disabled={disabled}
                        onChange={() => onToggleDefaultStudyLeaf(legacyKey)}
                      />
                      默认显示
                    </label>
                  )}

                  {!leaf.dynamic && (
                    <label className="review-study-leaf-manager__default-duration">
                      <span>默认时长</span>
                      <InlineDurationInput
                        compact
                        disabled={disabled}
                        value={studyLeafDefaults[legacyKey]?.defaultMinutes || ""}
                        onCommit={(minutes) => onSetStudyLeafDefaultMinutes(legacyKey, minutes === "" ? null : minutes)}
                      />
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <footer>
        <button className="primary-button" type="button" onClick={onClose}>
          完成
        </button>
      </footer>
    </div>
  );
}

function SleepCard({ draft, onChange, onRestore, disabled, expandedSections, toggleExpanded }) {
  const bedtime = effectiveValue(draft, "sleep.yesterday.bedtime");
  const lateAfterMidnight = isAfterMidnightBedtime(bedtime);

  return (
    <article className="review-small-summary-card" id="review-card-sleep">
      <header>
        <div>
          <span>🌙</span>
          <strong>睡眠与作息</strong>
        </div>
      </header>

      <div className="review-sleep-primary-row">
        <label className="review-inline-time">
          <span>入睡</span>
          <input
            type="time"
            value={bedtime}
            disabled={disabled}
            onChange={(event) => onChange("sleep.yesterday.bedtime", event.target.value)}
          />
        </label>

        <label className="review-inline-time">
          <span>起床</span>
          <input
            type="time"
            value={effectiveValue(draft, "sleep.yesterday.wakeTime")}
            disabled={disabled}
            onChange={(event) => onChange("sleep.yesterday.wakeTime", event.target.value)}
          />
        </label>

        <label className="review-inline-text">
          <span>睡眠时长</span>
          <input
            type="text"
            value={effectiveValue(draft, "sleep.yesterday.durationText")}
            disabled={disabled}
            onChange={(event) => onChange("sleep.yesterday.durationText", event.target.value)}
          />
        </label>
      </div>

      {lateAfterMidnight && (
        <label className="review-late-reason" id="review-late-reason-field">
          <span>已经超过 24:00，记录一下晚睡原因</span>
          <textarea
            rows={2}
            value={effectiveValue(draft, "sleep.yesterday.lateReason")}
            disabled={disabled}
            placeholder="是什么让今天超过零点才睡？"
            onChange={(event) => onChange("sleep.yesterday.lateReason", event.target.value)}
          />
        </label>
      )}

      <ExpandInPlace
        sectionId="sleep"
        label="更多"
        fields={[
          ...(lateAfterMidnight ? [] : [{ id: "sleep.yesterday.lateReason", label: "晚睡原因", kind: "text" }]),
          { id: "sleep.yesterday.feeling", label: "睡眠感受", kind: "text" },
          { id: "sleep.yesterday.adjustment", label: "调整", kind: "text" },
        ]}
        draft={draft}
        onChange={onChange}
        onRestore={onRestore}
        disabled={disabled}
        expandedSections={expandedSections}
        toggleExpanded={toggleExpanded}
      />
    </article>
  );
}

function StateCard({ draft, onChange, disabled, quickChoicesConfig, onQuickChoicesChange }) {
  const [managingMood, setManagingMood] = useState(false);
  const [managingBody, setManagingBody] = useState(false);

  const moodOptions = getQuickChoiceOptions("moodTags", quickChoicesConfig);
  const moodValue = effectiveValue(draft, "state.today.moodTag");
  const moodWithHistory = withHistoryOptions(moodOptions, moodValue);

  const bodyOptions = getQuickChoiceOptions("bodyConditions", quickChoicesConfig);
  const bodyValue = effectiveValue(draft, "state.today.bodyCondition");
  const bodyWithHistory = withHistoryOptions(bodyOptions, bodyValue);

  return (
    <article className="review-small-summary-card">
      <header>
        <div>
          <span>💗</span>
          <strong>状态与身体</strong>
        </div>
      </header>

      <FiveLevelSelector
        label="精力"
        icon={<BoltIcon />}
        disabled={disabled}
        value={effectiveValue(draft, "state.today.energy")}
        onChange={(value) => onChange("state.today.energy", value)}
      />

      <div className="review-quick-choice-row">
        <MultiChoice
          label="情绪"
          options={moodWithHistory.options}
          historyOptions={moodWithHistory.historyOptions}
          value={moodValue}
          maxSelection={MOOD_TAG_MAX_SELECTION}
          disabled={disabled}
          onChange={(value) => onChange("state.today.moodTag", value)}
        />
        <button type="button" className="review-manage-tags" disabled={disabled} onClick={() => setManagingMood((v) => !v)}>
          {managingMood ? "收起" : "管理标签"}
        </button>
      </div>

      {managingMood && (
        <QuickChoiceSettings
          title="情绪"
          options={moodOptions}
          defaults={getQuickChoiceOptions("moodTags", undefined)}
          disabled={disabled}
          onChange={(options) => onQuickChoicesChange("moodTags", options)}
          onClose={() => setManagingMood(false)}
        />
      )}

      <div className="review-quick-choice-row">
        <MultiChoice
          label="身体状态"
          options={bodyWithHistory.options}
          historyOptions={bodyWithHistory.historyOptions}
          value={bodyValue}
          maxSelection={BODY_CONDITION_MAX_SELECTION}
          disabled={disabled}
          onChange={(value) => onChange("state.today.bodyCondition", value)}
        />
        <button type="button" className="review-manage-tags" disabled={disabled} onClick={() => setManagingBody((v) => !v)}>
          {managingBody ? "收起" : "管理标签"}
        </button>
      </div>

      {managingBody && (
        <QuickChoiceSettings
          title="身体状态"
          options={bodyOptions}
          defaults={getQuickChoiceOptions("bodyConditions", undefined)}
          disabled={disabled}
          onChange={(options) => onQuickChoicesChange("bodyConditions", options)}
          onClose={() => setManagingBody(false)}
        />
      )}

      <QuickChoice
        label="睡眠影响"
        options={["大", "中", "小", "无"]}
        value={effectiveValue(draft, "state.today.sleepImpact")}
        disabled={disabled}
        onChange={(value) => onChange("state.today.sleepImpact", value)}
      />

      <QuickChoice
        label="手机干扰"
        options={["大", "中", "小", "无"]}
        value={effectiveValue(draft, "state.today.phoneInterference")}
        disabled={disabled}
        onChange={(value) => onChange("state.today.phoneInterference", value)}
      />
    </article>
  );
}

function ExerciseCard({ draft, onChange, onRestore, disabled, expandedSections, toggleExpanded }) {
  return (
    <article className="review-small-summary-card">
      <header>
        <div>
          <span>🏃</span>
          <strong>运动</strong>
        </div>
      </header>

      <InlineDurationInput
        label="总时长"
        compact
        disabled={disabled}
        value={numericValue(draft, "exercise.today.totalMinutes")}
        onCommit={(minutes) => onChange("exercise.today.totalMinutes", minutes)}
      />

      <label className="review-inline-text">
        <span>运动项目</span>
        <input
          type="text"
          value={effectiveValue(draft, "exercise.today.activity")}
          disabled={disabled}
          onChange={(event) => onChange("exercise.today.activity", event.target.value)}
        />
      </label>

      <QuickChoice
        label="强度感受"
        options={["轻松", "适中", "偏累", "太累"]}
        value={effectiveValue(draft, "exercise.today.feeling")}
        disabled={disabled}
        onChange={(value) => onChange("exercise.today.feeling", value)}
      />

      <QuickChoice
        label="系统计分强度"
        options={["无", "低强度", "中高强度"]}
        value={effectiveValue(draft, "exercise.today.intensity")}
        disabled={disabled}
        onChange={(value) => onChange("exercise.today.intensity", value)}
      />

      <ExpandInPlace
        sectionId="exercise"
        label="更多"
        fields={[
          { id: "exercise.today.bodyFeeling", label: "身体感受", kind: "text" },
          { id: "exercise.today.adjustment", label: "调整", kind: "text" },
        ]}
        draft={draft}
        onChange={onChange}
        onRestore={onRestore}
        disabled={disabled}
        expandedSections={expandedSections}
        toggleExpanded={toggleExpanded}
      />
    </article>
  );
}

function PeriodTracker({ draft, onChange, periodDay, disabled, onEndPeriodCycle }) {
  return (
    <div className="review-period-tracker">
      <div className="review-period-tracker__day">经期第 {periodDay ?? "?"} 天</div>

      <QuickChoice
        label="血量"
        options={["少量", "中等", "较多", "很多"]}
        value={effectiveValue(draft, "selfcare.today.periodFlow")}
        disabled={disabled}
        onChange={(value) => onChange("selfcare.today.periodFlow", value)}
      />

      <QuickChoice
        label="疼痛程度"
        options={["无", "轻微", "中等", "明显", "严重"]}
        value={effectiveValue(draft, "selfcare.today.periodPain")}
        disabled={disabled}
        onChange={(value) => onChange("selfcare.today.periodPain", value)}
      />

      <button type="button" className="review-period-tracker__end" disabled={disabled} onClick={onEndPeriodCycle}>
        结束本次经期
      </button>
    </div>
  );
}

function SelfcareCard({
  draft,
  onChange,
  onRestore,
  disabled,
  expandedSections,
  toggleExpanded,
  periodState,
  periodDay,
  onStartPeriodCycle,
  onEndPeriodCycle,
}) {
  return (
    <article className="review-small-summary-card">
      <header>
        <div>
          <span>🌿</span>
          <strong>个护</strong>
        </div>
      </header>

      <QuickToggle
        label="基础护肤"
        checked={effectiveValue(draft, "selfcare.today.basicSkincare") === "是"}
        disabled={disabled}
        onChange={(value) => onChange("selfcare.today.basicSkincare", value)}
      />

      <QuickToggle
        label="面膜"
        checked={effectiveValue(draft, "selfcare.today.mask") === "是"}
        offValue="否/未确认"
        disabled={disabled}
        onChange={(value) => onChange("selfcare.today.mask", value)}
      />

      <QuickToggle
        label="经期"
        checked={effectiveValue(draft, "selfcare.today.period") === "是"}
        disabled={disabled}
        onChange={(value) => {
          onChange("selfcare.today.period", value);
          if (value === "是" && periodState?.status !== "active") onStartPeriodCycle();
        }}
      />

      {periodState?.status === "active" && (
        <PeriodTracker
          draft={draft}
          onChange={onChange}
          periodDay={periodDay}
          disabled={disabled}
          onEndPeriodCycle={onEndPeriodCycle}
        />
      )}

      <label className="review-inline-text">
        <span>喝水量</span>
        <input
          type="number"
          inputMode="numeric"
          min="0"
          step="100"
          placeholder="ml"
          value={effectiveValue(draft, "selfcare.today.waterMl")}
          disabled={disabled}
          onChange={(event) => onChange("selfcare.today.waterMl", event.target.value)}
        />
      </label>

      <ExpandInPlace
        sectionId="selfcare"
        label="更多"
        fields={[{ id: "selfcare.today.other", label: "其他", kind: "text" }]}
        draft={draft}
        onChange={onChange}
        onRestore={onRestore}
        disabled={disabled}
        expandedSections={expandedSections}
        toggleExpanded={toggleExpanded}
      />
    </article>
  );
}

function CategoryDurationField({ field, draft, onChange, disabled }) {
  return (
    <InlineDurationInput
      label={field.label}
      compact
      disabled={disabled}
      value={numericValue(draft, field.id)}
      onCommit={(minutes) => onChange(field.id, minutes)}
    />
  );
}

function hasGroupContent(group, draft) {
  if (groupTotalMinutes(group, draft) > 0) return true;
  return (group.fields || []).some((field) => {
    const value = effectiveValue(draft, field.id);
    return typeof value === "number" ? value > 0 : String(value || "").trim().length > 0;
  });
}

function WorkArchiveManager({ groups, archivedGroups, onToggleArchivedWorkGroup, disabled, onClose }) {
  return (
    <div className="review-inline-settings" role="group" aria-label="管理工作项">
      <header>
        <strong>管理工作项</strong>
      </header>

      <ul className="review-work-archive-list">
        {groups.map((group) => {
          const archived = archivedGroups.includes(group.title);
          return (
            <li key={group.title}>
              <span>{group.title}</span>
              <button type="button" disabled={disabled} onClick={() => onToggleArchivedWorkGroup(group.title)}>
                {archived ? "恢复" : "归档"}
              </button>
            </li>
          );
        })}
      </ul>

      <p className="review-work-archive-note">
        归档后，没有新数据的日期不再显示该工作项；历史记录、积分记录都不会删除，随时可以恢复。
      </p>

      <footer>
        <button className="primary-button" type="button" onClick={onClose}>
          完成
        </button>
      </footer>
    </div>
  );
}

// One row per dynamic (taxonomy-only, no static schema field) leaf under a
// category — same duration | 今日推进 | 今日调整 layout as StudyLeafRow, but
// which fields actually render is driven by the node's own reviewConfig
// (not hardcoded), and storage is draft.categoryReviewEntries instead of
// draft.fields.
function DynamicCategoryLeafRow({ node, draft, onChangeCategoryEntry, onRemoveDynamicCategoryToday, disabled }) {
  const config = node.reviewConfig || {};
  const handleRemove = () => {
    if (hasCategoryEntryContent(draft, node.id)) {
      const confirmed = window.confirm("这项已经填写了内容。\n从今日页面隐藏不会删除数据，仍会计入统计。\n确认隐藏吗？");
      if (!confirmed) return;
    }
    onRemoveDynamicCategoryToday(node.id);
  };

  return (
    <div className="review-study-leaf-row">
      <span className="review-study-leaf-row__title">{node.name}</span>

      {config.recordDuration && (
        <InlineDurationInput
          disabled={disabled}
          value={categoryEntryNumericValue(draft, node.id, "duration")}
          onCommit={(minutes) => onChangeCategoryEntry(node.id, "duration", minutes)}
        />
      )}

      {config.recordProgress && (
        <label className="review-study-leaf-row__note">
          <span className="sr-only">{node.name}今日推进</span>
          <textarea
            rows={2}
            placeholder="今日推进"
            value={categoryEntryValue(draft, node.id, "progress")}
            disabled={disabled}
            onChange={(event) => onChangeCategoryEntry(node.id, "progress", event.target.value)}
          />
        </label>
      )}

      {config.recordAdjustment && (
        <label className="review-study-leaf-row__note">
          <span className="sr-only">{node.name}今日调整</span>
          <textarea
            rows={2}
            placeholder="今日调整"
            value={categoryEntryValue(draft, node.id, "adjustment")}
            disabled={disabled}
            onChange={(event) => onChangeCategoryEntry(node.id, "adjustment", event.target.value)}
          />
        </label>
      )}

      <button type="button" className="review-study-leaf-row__remove" disabled={disabled} onClick={handleRemove}>
        移除今日
      </button>
    </div>
  );
}

// "添加今日项目" — lists taxonomy leaves under this category with
// reviewConfig.enabled === true that aren't archived and aren't already
// shown today. Picking one only writes draft.ui.categoryVisibility, never
// profile — exactly like study's addStudyLeafToday.
function DynamicCategoryAddPicker({ addable, onAdd, onClose, disabled }) {
  if (!addable.length) {
    return (
      <div className="review-inline-settings" role="group" aria-label="添加今日项目">
        <p className="field-help">分类设置里没有可添加的项目——去"复盘与排程分类"里给某个分类勾选"在每日复盘中显示"。</p>
        <button className="primary-button" type="button" onClick={onClose}>完成</button>
      </div>
    );
  }
  return (
    <div className="review-inline-settings" role="group" aria-label="添加今日项目">
      <ul className="review-work-archive-list">
        {addable.map((node) => (
          <li key={node.id}>
            <span>{node.name}</span>
            <button type="button" disabled={disabled} onClick={() => onAdd(node.id)}>添加</button>
          </li>
        ))}
      </ul>
      <footer>
        <button className="primary-button" type="button" onClick={onClose}>完成</button>
      </footer>
    </div>
  );
}

function CategoryQuickCard({
  sectionId,
  config,
  section,
  draft,
  onChange,
  onRestore,
  onAddProject,
  onRemoveProject,
  quickFieldConfig,
  onQuickFieldConfigChange,
  archivedWorkGroups,
  onToggleArchivedWorkGroup,
  taxonomy,
  taxonomyModel,
  isHistoricalDate,
  onChangeCategoryEntry,
  onAddDynamicCategoryToday,
  onRemoveDynamicCategoryToday,
  disabled,
  expandedSections,
  toggleExpanded,
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [archiveManagerOpen, setArchiveManagerOpen] = useState(false);
  const [addPickerOpen, setAddPickerOpen] = useState(false);
  const dynamicLeaves = taxonomyModel?.categoryGroups?.[sectionId] || [];
  const addableLeaves = taxonomy ? getAddableDynamicLeaves(taxonomy, sectionId, draft) : [];
  const dynamicTotalMinutes = dynamicLeaves.reduce((sum, node) => sum + categoryEntryNumericValue(draft, node.id, "duration"), 0);
  const allGroups = section?.groups || [];
  const supportsQuickConfig = Boolean(DEFAULT_QUICK_DURATION_FIELDS[sectionId]);
  const supportsArchive = sectionId === "work";
  const settingsAvailableFields = (allGroups[0]?.fields || []).filter(
    (field) => field.kind === "duration" && !field.id.endsWith(".totalMinutes")
  );

  const groups = allGroups
    .filter((group) => !supportsArchive || !archivedWorkGroups.includes(group.title) || hasGroupContent(group, draft))
    .filter((group) => {
      if (!taxonomy) return true;
      const categoryId = deriveGroupCategoryId(group);
      const node = categoryId ? findNodeById(taxonomy, categoryId) : null;
      if (!node) return true;
      return shouldShowTaxonomyNode({ node, isHistoricalDate, hasCurrentRecord: hasGroupContent(group, draft) });
    });

  return (
    <article
      className="review-category-card"
      id={sectionId === "entertainment" ? "review-card-entertainment" : undefined}
    >
      <header>
        <div>
          <span>{config.icon}</span>
          <strong>{config.title}</strong>
          {dynamicTotalMinutes > 0 && (
            <span className="review-category-group__total review-category-card__dynamic-total">
              动态项目 {formatMinutes(dynamicTotalMinutes)}
            </span>
          )}
        </div>

        <div className="review-category-card__actions">
          {config.title === "项目" && (
            <button type="button" disabled={disabled} onClick={onAddProject}>
              + 新增
            </button>
          )}

          {supportsArchive && (
            <button type="button" disabled={disabled} onClick={() => setArchiveManagerOpen((current) => !current)}>
              管理工作项
            </button>
          )}

          {supportsQuickConfig && (
            <button
              type="button"
              className="review-gear-button"
              aria-label="快捷项设置"
              disabled={disabled}
              onClick={() => setSettingsOpen((current) => !current)}
            >
              ⚙
            </button>
          )}

          {Boolean(taxonomy) && (
            <button type="button" disabled={disabled} onClick={() => setAddPickerOpen((current) => !current)}>
              + 添加今日项目
            </button>
          )}
        </div>
      </header>

      {addPickerOpen && (
        <DynamicCategoryAddPicker
          addable={addableLeaves}
          disabled={disabled}
          onAdd={(categoryId) => onAddDynamicCategoryToday(categoryId)}
          onClose={() => setAddPickerOpen(false)}
        />
      )}

      {archiveManagerOpen && (
        <WorkArchiveManager
          groups={allGroups}
          archivedGroups={archivedWorkGroups}
          onToggleArchivedWorkGroup={onToggleArchivedWorkGroup}
          disabled={disabled}
          onClose={() => setArchiveManagerOpen(false)}
        />
      )}

      {settingsOpen && (
        <QuickFieldSettings
          sectionId={sectionId}
          title={config.title}
          availableFields={settingsAvailableFields}
          value={getQuickDurationFieldIds(sectionId, settingsAvailableFields, quickFieldConfig)}
          onChange={(ids) => onQuickFieldConfigChange(sectionId, ids)}
          onClose={() => setSettingsOpen(false)}
          disabled={disabled}
        />
      )}

      {groups.map((group) => {
        const availableFields = (group.fields || []).filter(
          (field) => field.kind === "duration" && !field.id.endsWith(".totalMinutes")
        );
        const quickIds = supportsQuickConfig
          ? getQuickDurationFieldIds(sectionId, availableFields, quickFieldConfig)
          : availableFields.map((field) => field.id);
        const quickFields = quickIds
          .map((id) => availableFields.find((field) => field.id === id))
          .filter(Boolean);
        const selectFields = (group.fields || []).filter((field) => field.kind === "select");
        const totalMinutes = groupTotalMinutes(group, draft);
        const narrative = summarizeGroup(group, draft).narrative;
        const archived = supportsArchive && archivedWorkGroups.includes(group.title);

        return (
          <div
            className={`review-category-group${archived ? " is-archived" : ""}`}
            key={`${group.title}-${group.temporaryId || "fixed"}`}
          >
            {(allGroups.length > 1 || archived) && (
              <div className="review-category-group__title">
                <span>{group.title}{archived ? "（已归档，仅保留历史）" : ""}</span>

                {group.temporaryId && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onRemoveProject(group.temporaryId)}
                  >
                    删除
                  </button>
                )}
              </div>
            )}

            <div className="review-category-group__durations">
              <span className="review-category-group__total">
                {formatMinutes(totalMinutes)}
              </span>

              {quickFields.map((field) => (
                <CategoryDurationField
                  key={field.id}
                  field={field}
                  draft={draft}
                  onChange={onChange}
                  disabled={disabled}
                />
              ))}
            </div>

            {selectFields.map((field) => (
              <QuickChoice
                key={field.id}
                label={field.label}
                options={field.options}
                value={effectiveValue(draft, field.id)}
                disabled={disabled}
                onChange={(value) => onChange(field.id, value)}
              />
            ))}

            {narrative !== "尚未填写" && (
              <p className="review-category-group__narrative">{narrative}</p>
            )}
          </div>
        );
      })}

      {dynamicLeaves.length > 0 && (
        <div className="review-study-leaf-list review-category-dynamic-list">
          {dynamicLeaves.map((node) => (
            <DynamicCategoryLeafRow
              key={node.id}
              node={node}
              draft={draft}
              onChangeCategoryEntry={onChangeCategoryEntry}
              onRemoveDynamicCategoryToday={onRemoveDynamicCategoryToday}
              disabled={disabled}
            />
          ))}
        </div>
      )}

      <CategoryExpandInPlace
        sectionId={sectionId}
        label="更多"
        groups={groups}
        draft={draft}
        onChange={onChange}
        onRestore={onRestore}
        disabled={disabled}
        expandedSections={expandedSections}
        toggleExpanded={toggleExpanded}
      />
    </article>
  );
}

function SummaryCard({ draft, onChange, onRestore, disabled, expandedSections, toggleExpanded }) {
  return (
    <article className="review-finish-preview">
      <header>
        <div>
          <span>📝</span>
          <strong>评分与总结</strong>
        </div>
      </header>

      <FiveLevelSelector
        label="学习质量"
        disabled={disabled}
        value={effectiveValue(draft, "summary.studyQuality")}
        onChange={(value) => onChange("summary.studyQuality", value)}
      />

      <FiveLevelSelector
        label="执行稳定度"
        disabled={disabled}
        value={effectiveValue(draft, "summary.execution")}
        onChange={(value) => onChange("summary.execution", value)}
      />

      <FiveLevelSelector
        label="今日满意度"
        disabled={disabled}
        value={effectiveValue(draft, "summary.satisfaction")}
        onChange={(value) => onChange("summary.satisfaction", value)}
      />

      <label className="review-inline-text">
        <span>今日一句话总结</span>
        <input
          type="text"
          value={effectiveValue(draft, "summary.oneLine")}
          disabled={disabled}
          onChange={(event) => onChange("summary.oneLine", event.target.value)}
        />
      </label>

      <QuickToggle
        label="今天是出游日"
        checked={effectiveValue(draft, "summary.isTravelDay") === "是"}
        disabled={disabled}
        onChange={(value) => onChange("summary.isTravelDay", value)}
      />

      <ExpandInPlace
        sectionId="summary"
        label="更多"
        fields={[{ id: "summary.special", label: "今日特殊情况", kind: "text" }]}
        draft={draft}
        onChange={onChange}
        onRestore={onRestore}
        disabled={disabled}
        expandedSections={expandedSections}
        toggleExpanded={toggleExpanded}
      />
    </article>
  );
}

function DiaryTagsInput({ value, onChange, disabled }) {
  const [draftText, setDraftText] = useState("");
  const tags = parseTagsText(value);

  const commit = () => {
    if (!draftText.trim()) return;
    onChange(addTag(value, draftText));
    setDraftText("");
  };

  return (
    <div className="review-diary-tags">
      {tags.length > 0 && (
        <div className="review-diary-tags__chips">
          {tags.map((tag, index) => (
            <span key={`${tag}-${index}`} className="review-diary-tag-chip">
              {tag}
              <button
                type="button"
                disabled={disabled}
                aria-label={`删除标签 ${tag}`}
                onClick={() => onChange(removeTagAt(value, index))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        type="text"
        placeholder="学习记录, 自我成长"
        value={draftText}
        disabled={disabled}
        onChange={(event) => setDraftText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "," || event.key === "，") {
            event.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}

function DiaryCard({ draft, onChange, disabled }) {
  return (
    <article className="review-finish-preview review-finish-preview--diary" id="daily-review-diary">
      <header>
        <div>
          <span>📖</span>
          <strong>日记</strong>
        </div>
      </header>

      <label className="review-inline-text">
        <span>标题</span>
        <input
          type="text"
          value={effectiveValue(draft, "diary.title")}
          disabled={disabled}
          onChange={(event) => onChange("diary.title", event.target.value)}
        />
      </label>

      <label className="review-diary-content">
        <span>正文</span>
        <textarea
          rows={6}
          value={effectiveValue(draft, "diary.content")}
          disabled={disabled}
          onChange={(event) => onChange("diary.content", event.target.value)}
        />
      </label>

      <label className="review-inline-text">
        <span>标签</span>
      </label>

      <DiaryTagsInput
        value={effectiveValue(draft, "diary.tags")}
        disabled={disabled}
        onChange={(next) => onChange("diary.tags", next)}
      />
    </article>
  );
}

export default function ReviewSummaryDashboard({
  sections,
  draft,
  onChange,
  onRestore,
  onAddProject,
  onRemoveProject,
  quickFieldConfig,
  onQuickFieldConfigChange,
  defaultStudyLeaves = [],
  onToggleDefaultStudyLeaf,
  studyLeafDefaults = {},
  onSetStudyLeafDefaultMinutes,
  onAddStudyLeafToday,
  onRemoveStudyLeafToday,
  periodState,
  periodDay,
  onStartPeriodCycle,
  onEndPeriodCycle,
  quickChoicesConfig,
  onQuickChoicesChange,
  archivedWorkGroups = [],
  onToggleArchivedWorkGroup,
  taxonomy,
  taxonomyModel,
  isHistoricalDate = false,
  onChangeCategoryEntry,
  onAddDynamicCategoryToday,
  onRemoveDynamicCategoryToday,
  disabled = false,
}) {
  const [expandedSections, setExpandedSections] = useState({});
  const [studyManagerOpen, setStudyManagerOpen] = useState(false);
  const [studyAddPickerOpen, setStudyAddPickerOpen] = useState(false);

  const toggleExpanded = (sectionId) => {
    setExpandedSections((current) => ({ ...current, [sectionId]: !current[sectionId] }));
  };

  const draftAdded = draft?.ui?.studyLeafVisibility?.added || [];
  const draftHidden = draft?.ui?.studyLeafVisibility?.hidden || [];
  const studyGroups = buildStudyGroupsFromTaxonomy({ taxonomy, draft, defaultLeafIds: defaultStudyLeaves, draftAdded, draftHidden, isHistoricalDate });
  const allStudyLeaves = listAllStudyLeavesFromTaxonomy({ taxonomy, draft, defaultLeafIds: defaultStudyLeaves, draftAdded, draftHidden, isHistoricalDate });
  const hiddenCount = allStudyLeaves.filter((leaf) => !leaf.visible).length;

  return (
    <main className="review-summary-dashboard">
      <section className="review-core-layout">
        <section className="review-study-leaf-panel">
          <header>
            <div>
              <h2>学习与专注</h2>
              <span>今天真实发生了什么，就显示什么；每个具体学习项单独一行</span>
            </div>

            <div className="review-category-card__actions">
              {Boolean(taxonomy) && (
                <button type="button" disabled={disabled} onClick={() => setStudyAddPickerOpen((current) => !current)}>
                  + 添加今日学习项目
                </button>
              )}
              <button type="button" disabled={disabled} onClick={() => setStudyManagerOpen((current) => !current)}>
                {studyManagerOpen ? "收起" : `学习项管理${hiddenCount ? ` (${hiddenCount})` : ""}`}
              </button>
            </div>
          </header>

          {studyAddPickerOpen && (
            <DynamicCategoryAddPicker
              addable={taxonomy ? getAddableDynamicLeaves(taxonomy, "study", draft) : []}
              disabled={disabled}
              onAdd={(categoryId) => onAddDynamicCategoryToday(categoryId)}
              onClose={() => setStudyAddPickerOpen(false)}
            />
          )}

          {studyManagerOpen && (
            <StudyLeafManager
              allLeaves={allStudyLeaves}
              defaultStudyLeaves={defaultStudyLeaves}
              onToggleDefaultStudyLeaf={onToggleDefaultStudyLeaf}
              studyLeafDefaults={studyLeafDefaults}
              onSetStudyLeafDefaultMinutes={onSetStudyLeafDefaultMinutes}
              onAddStudyLeafToday={onAddStudyLeafToday}
              onRemoveStudyLeafToday={onRemoveStudyLeafToday}
              onAddDynamicCategoryToday={onAddDynamicCategoryToday}
              onRemoveDynamicCategoryToday={onRemoveDynamicCategoryToday}
              disabled={disabled}
              onClose={() => setStudyManagerOpen(false)}
            />
          )}

          <div className="review-study-leaf-group-list">
            {studyGroups.map((group) => (
              <StudyLeafGroupBlock
                key={group.id}
                group={group}
                draft={draft}
                taxonomy={taxonomy}
                onChange={onChange}
                onChangeCategoryEntry={onChangeCategoryEntry}
                onRemoveToday={onRemoveStudyLeafToday}
                onRemoveDynamicCategoryToday={onRemoveDynamicCategoryToday}
                disabled={disabled}
              />
            ))}

            {!studyGroups.length && (
              <p className="review-study-empty-state">今天还没有学习记录——点击上方"学习项管理"开始填写。</p>
            )}
          </div>
        </section>

        <aside className="review-core-side">
          <SleepCard
            draft={draft}
            onChange={onChange}
            onRestore={onRestore}
            disabled={disabled}
            expandedSections={expandedSections}
            toggleExpanded={toggleExpanded}
          />
          <StateCard
            draft={draft}
            onChange={onChange}
            disabled={disabled}
            quickChoicesConfig={quickChoicesConfig}
            onQuickChoicesChange={onQuickChoicesChange}
          />

          <div className="review-core-side-pair">
            <ExerciseCard
              draft={draft}
              onChange={onChange}
              onRestore={onRestore}
              disabled={disabled}
              expandedSections={expandedSections}
              toggleExpanded={toggleExpanded}
            />
            <SelfcareCard
              draft={draft}
              onChange={onChange}
              onRestore={onRestore}
              disabled={disabled}
              expandedSections={expandedSections}
              toggleExpanded={toggleExpanded}
              periodState={periodState}
              periodDay={periodDay}
              onStartPeriodCycle={onStartPeriodCycle}
              onEndPeriodCycle={onEndPeriodCycle}
            />
          </div>
        </aside>
      </section>

      <section className="review-category-summary-grid">
        {[
          CATEGORY_EDITOR_CONFIG.project,
          CATEGORY_EDITOR_CONFIG.work,
          CATEGORY_EDITOR_CONFIG.hobby,
          CATEGORY_EDITOR_CONFIG.entertainment,
          CATEGORY_EDITOR_CONFIG.family,
          CATEGORY_EDITOR_CONFIG.misc,
        ].map((config) => {
          const sectionId = Object.keys(CATEGORY_EDITOR_CONFIG).find(
            (key) => CATEGORY_EDITOR_CONFIG[key].sourceTitle === config.sourceTitle
          );

          return (
            <CategoryQuickCard
              key={config.sourceTitle}
              sectionId={sectionId}
              config={config}
              section={findCategorySection(sections, config.sourceTitle)}
              draft={draft}
              onChange={onChange}
              onRestore={onRestore}
              onAddProject={onAddProject}
              onRemoveProject={onRemoveProject}
              quickFieldConfig={quickFieldConfig}
              onQuickFieldConfigChange={onQuickFieldConfigChange}
              archivedWorkGroups={archivedWorkGroups}
              onToggleArchivedWorkGroup={onToggleArchivedWorkGroup}
              taxonomy={taxonomy}
              taxonomyModel={taxonomyModel}
              isHistoricalDate={isHistoricalDate}
              onChangeCategoryEntry={onChangeCategoryEntry}
              onAddDynamicCategoryToday={onAddDynamicCategoryToday}
              onRemoveDynamicCategoryToday={onRemoveDynamicCategoryToday}
              disabled={disabled}
              expandedSections={expandedSections}
              toggleExpanded={toggleExpanded}
            />
          );
        })}
      </section>

      <section className="review-finish-summary-grid">
        <SummaryCard
          draft={draft}
          onChange={onChange}
          onRestore={onRestore}
          disabled={disabled}
          expandedSections={expandedSections}
          toggleExpanded={toggleExpanded}
        />
        <DiaryCard draft={draft} onChange={onChange} disabled={disabled} />
      </section>
    </main>
  );
}
