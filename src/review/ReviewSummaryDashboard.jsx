import {
  CATEGORY_EDITOR_CONFIG,
  STUDY_SUMMARY_CONFIG,
  buildStudyDurationSummary,
  buildStudyProgressSummary,
  effectiveValue,
  findCategorySection,
  findOtherSection,
  formatMinutes,
  getStudyCompletion,
  groupTotalMinutes,
  numericValue,
  summarizeGroup,
} from "./reviewSectionConfig.js";

function EditButton({ label, onClick }) {
  return (
    <button
      className="review-summary-edit"
      type="button"
      aria-label={`编辑${label}`}
      onClick={onClick}
    >
      ✎
    </button>
  );
}

function StudySummaryRow({
  config,
  draft,
  onEdit,
}) {
  const total = numericValue(draft, config.totalId);
  const completion = getStudyCompletion(config, draft);

  return (
    <article className="review-study-summary-row">
      <div className="review-study-summary-subject">
        <span className={`review-study-icon review-study-icon--${config.id}`}>
          {config.icon}
        </span>

        <strong>{config.title}</strong>
      </div>

      <div className="review-study-summary-total">
        <span>总时长</span>
        <strong>{formatMinutes(total)}</strong>
      </div>

      <div className="review-study-summary-split">
        <span>细分项目</span>
        <p title={buildStudyDurationSummary(config, draft)}>
          {buildStudyDurationSummary(config, draft)}
        </p>
      </div>

      <div className="review-study-summary-progress">
        <span>今日推进</span>
        <p title={buildStudyProgressSummary(config, draft)}>
          {buildStudyProgressSummary(config, draft)}
        </p>
      </div>

      <div className="review-study-summary-status">
        <span
          className={`review-completion-badge review-completion-badge--${completion.level}`}
        >
          {completion.label}
        </span>

        <EditButton
          label={config.title}
          onClick={() =>
            onEdit({
              kind: "study",
              id: config.id,
              title: config.title,
            })
          }
        />
      </div>
    </article>
  );
}

function SmallSummaryCard({
  title,
  icon,
  value,
  lines = [],
  chips = [],
  onEdit,
  className = "",
}) {
  return (
    <article
      className={`review-small-summary-card ${className}`.trim()}
    >
      <header>
        <div>
          <span>{icon}</span>
          <strong>{title}</strong>
        </div>

        <EditButton label={title} onClick={onEdit} />
      </header>

      {value && (
        <strong className="review-small-summary-card__value">
          {value}
        </strong>
      )}

      {chips.length > 0 && (
        <div className="review-summary-chips">
          {chips.map((chip) => (
            <span key={chip.id || chip.label}>
              {chip.label} {chip.value}
            </span>
          ))}
        </div>
      )}

      {lines.map((line) => (
        <p key={line.label}>
          <span>{line.label}</span>
          <strong>{line.value || "未填写"}</strong>
        </p>
      ))}
    </article>
  );
}

function CategorySummaryCard({
  config,
  section,
  draft,
  onEdit,
}) {
  const groups = section?.groups || [];

  const totalMinutes = groups.reduce(
    (sum, group) => sum + groupTotalMinutes(group, draft),
    0
  );

  const chips = groups
    .flatMap((group) => summarizeGroup(group, draft).chips)
    .slice(0, 4);

  const narrative =
    groups
      .map((group) => summarizeGroup(group, draft).narrative)
      .find((value) => value && value !== "尚未填写") ||
    "尚未填写";

  return (
    <SmallSummaryCard
      title={config.title}
      icon={config.icon}
      value={formatMinutes(totalMinutes)}
      chips={chips}
      lines={[
        {
          label: "今日记录",
          value: narrative,
        },
      ]}
      onEdit={() =>
        onEdit({
          kind: "category",
          id: Object.keys(CATEGORY_EDITOR_CONFIG).find(
            (key) =>
              CATEGORY_EDITOR_CONFIG[key].sourceTitle ===
              config.sourceTitle
          ),
          title: config.title,
          sourceTitle: config.sourceTitle,
        })
      }
    />
  );
}

function SummaryPreview({
  draft,
  onEdit,
}) {
  const quality = effectiveValue(
    draft,
    "summary.studyQuality"
  );

  const execution = effectiveValue(
    draft,
    "summary.execution"
  );

  const satisfaction = effectiveValue(
    draft,
    "summary.satisfaction"
  );

  const oneLine = String(
    effectiveValue(draft, "summary.oneLine") || ""
  ).trim();

  return (
    <article className="review-finish-preview">
      <header>
        <div>
          <span>📝</span>
          <strong>今日总结</strong>
        </div>

        <EditButton
          label="今日总结"
          onClick={() =>
            onEdit({
              kind: "other",
              id: "summary",
              title: "评分与总结",
              sourceTitle: "评分与总结",
            })
          }
        />
      </header>

      <div className="review-score-preview">
        <div>
          <span>学习质量</span>
          <strong>{quality === "" ? "—" : `${quality}/10`}</strong>
        </div>

        <div>
          <span>执行稳定度</span>
          <strong>
            {execution === "" ? "—" : `${execution}/10`}
          </strong>
        </div>

        <div>
          <span>今日满意度</span>
          <strong>
            {satisfaction === "" ? "—" : `${satisfaction}/10`}
          </strong>
        </div>
      </div>

      <p>
        {oneLine || "今天还没有写一句话总结。"}
      </p>
    </article>
  );
}

function DiaryPreview({
  draft,
  onEdit,
}) {
  const title = String(
    effectiveValue(draft, "diary.title") || ""
  ).trim();

  const content = String(
    effectiveValue(draft, "diary.content") || ""
  )
    .replace(/\s+/g, " ")
    .trim();

  const tags = String(
    effectiveValue(draft, "diary.tags") || ""
  ).trim();

  return (
    <article className="review-finish-preview review-finish-preview--diary">
      <header>
        <div>
          <span>📖</span>
          <strong>日记</strong>
        </div>

        <EditButton
          label="日记"
          onClick={() =>
            onEdit({
              kind: "other",
              id: "diary",
              title: "日记",
              sourceTitle: "日记",
            })
          }
        />
      </header>

      <strong className="review-diary-preview-title">
        {title || "尚未填写标题"}
      </strong>

      <p>
        {content
          ? content.length > 140
            ? `${content.slice(0, 140)}…`
            : content
          : "今天还没有写日记。"}
      </p>

      {tags && (
        <div className="review-summary-chips">
          {tags
            .split(/[,，\s]+/)
            .filter(Boolean)
            .slice(0, 5)
            .map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
        </div>
      )}
    </article>
  );
}

export default function ReviewSummaryDashboard({
  sections,
  otherSections,
  draft,
  onEdit,
}) {
  const sleep = findOtherSection(otherSections, "睡眠");
  const state = findOtherSection(otherSections, "状态");
  const exercise = findOtherSection(otherSections, "运动");
  const selfcare = findOtherSection(otherSections, "个护");

  const sleepSummary = {
    bedtime:
      effectiveValue(draft, "sleep.yesterday.bedtime") ||
      "未填写",
    wakeTime:
      effectiveValue(draft, "sleep.yesterday.wakeTime") ||
      "未填写",
    duration:
      effectiveValue(
        draft,
        "sleep.yesterday.durationText"
      ) || "未填写",
  };

  const exerciseMinutes = numericValue(
    draft,
    "exercise.today.totalMinutes"
  );

  return (
    <main className="review-summary-dashboard">
      <section className="review-main-summary-grid">
        <section className="review-study-summary-panel">
          <header>
            <div>
              <h2>学习与专注</h2>
              <span>推进记录按二级分类汇总</span>
            </div>
          </header>

          <div className="review-study-summary-table">
            {STUDY_SUMMARY_CONFIG.map((config) => (
              <StudySummaryRow
                key={config.id}
                config={config}
                draft={draft}
                onEdit={onEdit}
              />
            ))}
          </div>
        </section>

        <aside className="review-life-summary-column">
          <SmallSummaryCard
            title="睡眠与作息"
            icon="🌙"
            value={sleepSummary.duration}
            lines={[
              {
                label: "入睡",
                value: sleepSummary.bedtime,
              },
              {
                label: "起床",
                value: sleepSummary.wakeTime,
              },
            ]}
            onEdit={() =>
              onEdit({
                kind: "other",
                id: "sleep",
                title: "睡眠与作息",
                sourceTitle: "睡眠",
              })
            }
          />

          <SmallSummaryCard
            title="状态与身体"
            icon="💗"
            lines={[
              {
                label: "精力",
                value:
                  effectiveValue(
                    draft,
                    "state.today.energy"
                  ) === ""
                    ? "未填写"
                    : `${effectiveValue(
                        draft,
                        "state.today.energy"
                      )}/10`,
              },
              {
                label: "情绪",
                value:
                  effectiveValue(
                    draft,
                    "state.today.mood"
                  ) === ""
                    ? "未填写"
                    : `${effectiveValue(
                        draft,
                        "state.today.mood"
                      )}/10`,
              },
              {
                label: "身体",
                value:
                  effectiveValue(
                    draft,
                    "state.today.body"
                  ) === ""
                    ? "未填写"
                    : `${effectiveValue(
                        draft,
                        "state.today.body"
                      )}/10`,
              },
            ]}
            onEdit={() =>
              onEdit({
                kind: "other",
                id: "state",
                title: "状态与身体",
                sourceTitle: "状态",
              })
            }
          />

          <div className="review-life-summary-pair">
            <SmallSummaryCard
              title="运动"
              icon="🏃"
              value={formatMinutes(exerciseMinutes)}
              lines={[
                {
                  label: "项目",
                  value:
                    effectiveValue(
                      draft,
                      "exercise.today.activity"
                    ) || "未填写",
                },
              ]}
              onEdit={() =>
                onEdit({
                  kind: "other",
                  id: "exercise",
                  title: "运动",
                  sourceTitle: "运动",
                })
              }
            />

            <SmallSummaryCard
              title="个护"
              icon="🌿"
              lines={[
                {
                  label: "护肤",
                  value:
                    effectiveValue(
                      draft,
                      "selfcare.today.basicSkincare"
                    ) || "未填写",
                },
                {
                  label: "面膜",
                  value:
                    effectiveValue(
                      draft,
                      "selfcare.today.mask"
                    ) || "未填写",
                },
              ]}
              onEdit={() =>
                onEdit({
                  kind: "other",
                  id: "selfcare",
                  title: "个护",
                  sourceTitle: "个护",
                })
              }
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
        ].map((config) => (
          <CategorySummaryCard
            key={config.sourceTitle}
            config={config}
            section={findCategorySection(
              sections,
              config.sourceTitle
            )}
            draft={draft}
            onEdit={onEdit}
          />
        ))}
      </section>

      <section className="review-finish-summary-grid">
        <SummaryPreview draft={draft} onEdit={onEdit} />
        <DiaryPreview draft={draft} onEdit={onEdit} />
      </section>
    </main>
  );
}
