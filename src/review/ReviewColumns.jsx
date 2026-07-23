import ReviewField from "./ReviewField.jsx";

function FieldRow({ field, draft, onChange, onRestore, disabled }) {
  return <ReviewField key={field.id} field={field} state={draft.fields[field.id]} onChange={onChange} onRestore={onRestore} disabled={disabled} />;
}

function GroupCard({ group, draft, onChange, onRestore, onRemove, disabled }) {
  return (
    <div className="review-group-card">
      <div className="review-card-head">
        <h3>{group.title}</h3>
        {group.temporaryId && <button disabled={disabled} type="button" onClick={() => onRemove(group.temporaryId)}>删除当天项目</button>}
      </div>
      <div className="review-field-grid">
        {group.fields.map((field) => <FieldRow key={field.id} field={field} draft={draft} onChange={onChange} onRestore={onRestore} disabled={disabled} />)}
      </div>
    </div>
  );
}

// Renders reviewSections + otherSections as a single ordered, always-expanded
// vertical stack (per the workbench UI-refresh spec: 学习 → 项目 → 工作 → 生活
//与状态 → 睡眠 → 评分与总结 → 日记), instead of the previous two-column split.
// `order` is WORKBENCH_SECTION_ORDER from dailyReviewSchema.js; a title missing
// from either `sections` or `otherSections` is simply skipped.
export function ReviewSectionStack({ sections, otherSections, order, draft, onChange, onRestore, onAddProject, onRemoveProject, disabled = false }) {
  const sectionByTitle = new Map(sections.map((section) => [section.title, section]));
  const otherByTitle = new Map(otherSections.map((section) => [section.title, section]));
  return (
    <div className="review-section-stack">
      {order.map((title) => {
        const section = sectionByTitle.get(title);
        if (section) {
          return (
            <section key={title} className="review-section-card">
              <div className="review-card-head">
                <h2>{title}</h2>
                {title === "项目" && <button disabled={disabled} type="button" onClick={onAddProject}>新增当天项目</button>}
              </div>
              {section.groups.map((group) => (
                <GroupCard key={`${group.title}-${group.temporaryId || "default"}`} group={group} draft={draft} onChange={onChange} onRestore={onRestore} onRemove={onRemoveProject} disabled={disabled} />
              ))}
            </section>
          );
        }
        const other = otherByTitle.get(title);
        if (other) {
          return (
            <section key={title} className={`review-section-card${title === "日记" ? " review-section-card--diary" : ""}`}>
              <div className="review-card-head"><h2>{title}</h2></div>
              <div className="review-field-grid">
                {other.fields.map((field) => <FieldRow key={field.id} field={field} draft={draft} onChange={onChange} onRestore={onRestore} disabled={disabled} />)}
              </div>
            </section>
          );
        }
        return null;
      })}
    </div>
  );
}
