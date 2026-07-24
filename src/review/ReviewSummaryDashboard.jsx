import { useState } from "react";
import {
  CATEGORY_EDITOR_CONFIG,
  STUDY_SUMMARY_CONFIG,
  buildStudyProgressSummary,
  effectiveValue,
  findCategorySection,
  formatMinutes,
  getStudyCompletion,
  groupTotalMinutes,
  numericValue,
  summarizeGroup,
} from "./reviewSectionConfig.js";
import { DEFAULT_QUICK_DURATION_FIELDS, getQuickDurationFieldIds } from "./reviewQuickFieldConfig.js";
import InlineDurationInput from "./InlineDurationInput.jsx";
import FiveLevelSelector from "./FiveLevelSelector.jsx";
import QuickToggle from "./QuickToggle.jsx";
import QuickFieldSettings from "./QuickFieldSettings.jsx";
import ReviewField from "./ReviewField.jsx";
import { addTag, parseTagsText, removeTagAt } from "./diaryTags.js";

const SAFE_FIELD_STATE = { value: "", autoValue: "", source: "default", manuallyEdited: false };

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

function StudySummaryRow({ config, draft, onChange, onRestore, disabled, expandedSections, toggleExpanded }) {
  const totalState = draft?.fields?.[config.totalId];
  const completion = getStudyCompletion(config, draft);
  const isSingleField =
    config.durationFields.length === 1 &&
    config.durationFields[0].id === config.totalId;

  const longFields = [
    ...config.progressFields.map((field) => ({ ...field, kind: "text" })),
    { id: config.adjustmentId, label: `${config.title}调整`, kind: "text" },
  ];

  return (
    <article
      className="review-study-summary-row"
      id={config.id === "english" ? "review-card-study-english" : undefined}
    >
      <div className="review-study-summary-row__top">
        <div className="review-study-summary-subject">
          <span className={`review-study-icon review-study-icon--${config.id}`}>
            {config.icon}
          </span>

          <strong>{config.title}</strong>
        </div>

        <div className="review-study-summary-durations">
          {!isSingleField && (
            <div className="review-study-summary-total">
              <InlineDurationInput
                label="总时长"
                compact
                disabled={disabled}
                value={numericValue(draft, config.totalId)}
                onCommit={(minutes) => onChange(config.totalId, minutes)}
              />

              {totalState?.manuallyEdited && (
                <button
                  className="review-restore"
                  type="button"
                  disabled={disabled}
                  onClick={() => onRestore(config.totalId)}
                >
                  恢复自动
                </button>
              )}
            </div>
          )}

          {config.durationFields.map((field) => (
            <InlineDurationInput
              key={field.id}
              label={field.label}
              compact
              disabled={disabled}
              value={numericValue(draft, field.id)}
              onCommit={(minutes) => onChange(field.id, minutes)}
            />
          ))}
        </div>

        <div className="review-study-summary-progress">
          <span>今日推进</span>
          <p title={buildStudyProgressSummary(config, draft)}>
            {buildStudyProgressSummary(config, draft)}
          </p>
        </div>

        <span className={`review-completion-badge review-completion-badge--${completion.level}`}>
          {completion.label}
        </span>
      </div>

      <ExpandInPlace
        sectionId={`study-${config.id}`}
        label="补充推进"
        fields={longFields}
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

function SleepCard({ draft, onChange, onRestore, disabled, expandedSections, toggleExpanded }) {
  return (
    <article className="review-small-summary-card" id="review-card-sleep">
      <header>
        <div>
          <span>🌙</span>
          <strong>睡眠与作息</strong>
        </div>
      </header>

      <div className="review-inline-row">
        <label className="review-inline-time">
          <span>入睡</span>
          <input
            type="time"
            value={effectiveValue(draft, "sleep.yesterday.bedtime")}
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
      </div>

      <label className="review-inline-text">
        <span>睡眠时长</span>
        <input
          type="text"
          placeholder="7h45min"
          value={effectiveValue(draft, "sleep.yesterday.durationText")}
          disabled={disabled}
          onChange={(event) => onChange("sleep.yesterday.durationText", event.target.value)}
        />
      </label>

      <ExpandInPlace
        sectionId="sleep"
        label="更多"
        fields={[
          { id: "sleep.yesterday.lateReason", label: "晚睡原因", kind: "text" },
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

function StateCard({ draft, onChange, disabled }) {
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
        icon="⚡"
        disabled={disabled}
        value={effectiveValue(draft, "state.today.energy")}
        onChange={(value) => onChange("state.today.energy", value)}
      />

      <QuickChoice
        label="情绪"
        options={["开心", "平静", "放松", "期待", "焦虑", "烦躁", "低落", "麻木", "复杂"]}
        value={effectiveValue(draft, "state.today.moodTag")}
        disabled={disabled}
        onChange={(value) => onChange("state.today.moodTag", value)}
      />

      <QuickChoice
        label="身体状态"
        options={["很好", "正常", "疲惫", "乏力", "不舒服", "疼痛", "生病"]}
        value={effectiveValue(draft, "state.today.bodyCondition")}
        disabled={disabled}
        onChange={(value) => onChange("state.today.bodyCondition", value)}
      />

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

function SelfcareCard({ draft, onChange, onRestore, disabled, expandedSections, toggleExpanded }) {
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
        onChange={(value) => onChange("selfcare.today.period", value)}
      />

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
  disabled,
  expandedSections,
  toggleExpanded,
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const groups = section?.groups || [];
  const supportsQuickConfig = Boolean(DEFAULT_QUICK_DURATION_FIELDS[sectionId]);
  const settingsAvailableFields = (groups[0]?.fields || []).filter(
    (field) => field.kind === "duration" && !field.id.endsWith(".totalMinutes")
  );

  return (
    <article
      className="review-category-card"
      id={sectionId === "entertainment" ? "review-card-entertainment" : undefined}
    >
      <header>
        <div>
          <span>{config.icon}</span>
          <strong>{config.title}</strong>
        </div>

        <div className="review-category-card__actions">
          {config.title === "项目" && (
            <button type="button" disabled={disabled} onClick={onAddProject}>
              + 新增
            </button>
          )}

          {supportsQuickConfig && (
            <div className="review-card-settings-anchor">
              <button
                type="button"
                className="review-gear-button"
                aria-label="快捷项设置"
                disabled={disabled}
                onClick={() => setSettingsOpen((current) => !current)}
              >
                ⚙
              </button>

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
            </div>
          )}
        </div>
      </header>

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

        return (
          <div
            className="review-category-group"
            key={`${group.title}-${group.temporaryId || "fixed"}`}
          >
            {groups.length > 1 && (
              <div className="review-category-group__title">
                <span>{group.title}</span>

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
  disabled = false,
}) {
  const [expandedSections, setExpandedSections] = useState({});

  const toggleExpanded = (sectionId) => {
    setExpandedSections((current) => ({ ...current, [sectionId]: !current[sectionId] }));
  };

  return (
    <main className="review-summary-dashboard">
      <section className="review-main-summary-grid">
        <section className="review-study-summary-panel">
          <header>
            <div>
              <h2>学习与专注</h2>
              <span>时长直接填写，推进在卡片内展开补充</span>
            </div>
          </header>

          <div className="review-study-summary-table">
            {STUDY_SUMMARY_CONFIG.map((config) => (
              <StudySummaryRow
                key={config.id}
                config={config}
                draft={draft}
                onChange={onChange}
                onRestore={onRestore}
                disabled={disabled}
                expandedSections={expandedSections}
                toggleExpanded={toggleExpanded}
              />
            ))}
          </div>
        </section>

        <aside className="review-life-summary-column">
          <SleepCard
            draft={draft}
            onChange={onChange}
            onRestore={onRestore}
            disabled={disabled}
            expandedSections={expandedSections}
            toggleExpanded={toggleExpanded}
          />
          <StateCard draft={draft} onChange={onChange} disabled={disabled} />

          <div className="review-life-summary-pair">
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
