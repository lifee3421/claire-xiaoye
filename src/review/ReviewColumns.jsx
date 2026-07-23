import ReviewField from "./ReviewField.jsx";

const SUBJECT_ICONS = {
  数学: "📐",
  专业课: "💰",
  英语: "📕",
  日语: "🌸",
  阅读: "📚",
};

function getState(draft, fieldId) {
  return draft?.fields?.[fieldId] || {};
}

function SourceBadge({ fieldId, draft }) {
  const state = getState(draft, fieldId);

  if (state.manuallyEdited) {
    return (
      <span className="review-source-badge review-source-badge--manual">
        手动覆盖
      </span>
    );
  }

  if (
    state.source &&
    state.source !== "default" &&
    state.source !== "manual"
  ) {
    return (
      <span className="review-source-badge review-source-badge--auto">
        自动值
      </span>
    );
  }

  return (
    <span className="review-source-badge review-source-badge--empty">
      待填写
    </span>
  );
}

function SubjectCard({
  group,
  draft,
  onChange,
  onRestore,
  disabled,
}) {
  const durationFields = group.fields.filter(
    (field) => field.kind === "duration"
  );

  const narrativeFields = group.fields.filter(
    (field) => field.kind !== "duration"
  );

  const totalField =
    durationFields.find((field) => field.id.endsWith(".totalMinutes")) ||
    durationFields[0];

  return (
    <article className="review-subject-card">
      <header className="review-subject-card__header">
        <div>
          <span className="review-subject-icon" aria-hidden="true">
            {SUBJECT_ICONS[group.title] || "📘"}
          </span>
          <h3>{group.title}</h3>
          {totalField && (
            <SourceBadge fieldId={totalField.id} draft={draft} />
          )}
        </div>
      </header>

      {durationFields.length > 0 && (
        <div className="review-subject-duration-grid">
          {durationFields.map((field) => (
            <ReviewField
              key={field.id}
              field={field}
              state={getState(draft, field.id)}
              onChange={onChange}
              onRestore={onRestore}
              disabled={disabled}
              dense
            />
          ))}
        </div>
      )}

      {narrativeFields.length > 0 && (
        <div className="review-subject-copy-grid">
          {narrativeFields.map((field) => (
            <ReviewField
              key={field.id}
              field={field}
              state={getState(draft, field.id)}
              onChange={onChange}
              onRestore={onRestore}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </article>
  );
}

function CompactGroupCard({
  group,
  draft,
  onChange,
  onRestore,
  onRemove,
  disabled,
  diary = false,
}) {
  return (
    <article
      className={[
        "review-compact-card",
        diary ? "review-compact-card--diary" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <header className="review-compact-card__header">
        <h3>{group.title}</h3>

        {group.temporaryId && (
          <button
            disabled={disabled}
            type="button"
            onClick={() => onRemove(group.temporaryId)}
          >
            删除当天项目
          </button>
        )}
      </header>

      <div className="review-compact-field-grid">
        {group.fields.map((field) => (
          <ReviewField
            key={field.id}
            field={field}
            state={getState(draft, field.id)}
            onChange={onChange}
            onRestore={onRestore}
            disabled={disabled}
            dense={field.kind !== "text"}
          />
        ))}
      </div>
    </article>
  );
}

function SectionShell({
  title,
  children,
  action,
  className = "",
}) {
  return (
    <section
      className={`review-dashboard-section ${className}`.trim()}
    >
      <header className="review-dashboard-section__header">
        <h2>{title}</h2>
        {action}
      </header>

      {children}
    </section>
  );
}

export function ReviewDashboardLayout({
  sections,
  otherSections,
  draft,
  onChange,
  onRestore,
  onRemoveProject,
  onAddProject,
  disabled = false,
}) {
  const sectionMap = new Map(
    sections.map((section) => [section.title, section])
  );

  const otherMap = new Map(
    otherSections.map((section) => [section.title, section])
  );

  const learning = sectionMap.get("学习");

  const secondarySections = [
    "项目",
    "工作",
    "兴趣",
    "娱乐",
    "家庭",
    "杂项",
  ]
    .map((title) => sectionMap.get(title))
    .filter(Boolean);

  const sideSections = ["睡眠", "状态", "运动", "个护"]
    .map((title) => otherMap.get(title))
    .filter(Boolean);

  const summary = otherMap.get("评分与总结");
  const diary = otherMap.get("日记");

  return (
    <main className="review-dashboard">
      <div className="review-dashboard-primary">
        <SectionShell
          title="学习与专注"
          className="review-learning-panel"
        >
          <div className="review-subject-list">
            {(learning?.groups || []).map((group) => (
              <SubjectCard
                key={group.title}
                group={group}
                draft={draft}
                onChange={onChange}
                onRestore={onRestore}
                disabled={disabled}
              />
            ))}
          </div>
        </SectionShell>

        <aside className="review-dashboard-side">
          {sideSections.map((group) => (
            <CompactGroupCard
              key={group.title}
              group={group}
              draft={draft}
              onChange={onChange}
              onRestore={onRestore}
              onRemove={() => {}}
              disabled={disabled}
            />
          ))}
        </aside>
      </div>

      <section className="review-dashboard-secondary">
        {secondarySections.map((section) => (
          <SectionShell
            key={section.title}
            title={section.title}
            action={
              section.title === "项目" ? (
                <button
                  className="review-section-action"
                  disabled={disabled}
                  type="button"
                  onClick={onAddProject}
                >
                  新增当天项目
                </button>
              ) : null
            }
          >
            <div className="review-secondary-group-grid">
              {section.groups.map((group) => (
                <CompactGroupCard
                  key={`${section.title}-${group.title}-${
                    group.temporaryId || "default"
                  }`}
                  group={group}
                  draft={draft}
                  onChange={onChange}
                  onRestore={onRestore}
                  onRemove={onRemoveProject}
                  disabled={disabled}
                />
              ))}
            </div>
          </SectionShell>
        ))}
      </section>

      <section className="review-dashboard-finish">
        {summary && (
          <CompactGroupCard
            group={summary}
            draft={draft}
            onChange={onChange}
            onRestore={onRestore}
            onRemove={() => {}}
            disabled={disabled}
          />
        )}

        {diary && (
          <CompactGroupCard
            group={diary}
            draft={draft}
            onChange={onChange}
            onRestore={onRestore}
            onRemove={() => {}}
            disabled={disabled}
            diary
          />
        )}
      </section>
    </main>
  );
}
