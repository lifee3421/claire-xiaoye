import fs from "node:fs";

const file = "src/App.jsx";
let text = fs.readFileSync(file, "utf8");

function replaceOnce(before, after, label) {
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one anchor, found ${count}`);
  text = text.replace(before, after);
}

replaceOnce(
  '{ id: "schedule", label: "明日排程", icon: Wand2 },',
  '{ id: "schedule", label: "排程", icon: Wand2 },',
  "schedule tab label",
);

replaceOnce(
  'inboxItems={selectActiveInboxItems(inboxItems)}',
  'inboxItems={selectActiveInboxItems(inboxItems).filter((item) => !item.targetDate || item.targetDate === draft.targetDate)}',
  "date-scoped shared ledger",
);

replaceOnce(
  '{inboxItemDrawer && <InboxItemDrawer item={inboxItemDrawer} taxonomy={classificationTaxonomy} onCancel={() => setInboxItemDrawer(null)} onSave={saveInboxItem} />}',
  '{inboxItemDrawer && <InboxItemDrawer item={inboxItemDrawer} taxonomy={classificationTaxonomy} targetDate={draft.targetDate} onCancel={() => setInboxItemDrawer(null)} onSave={saveInboxItem} />}',
  "drawer target date",
);

const inboxStart = text.indexOf('function InboxSection({ items = [], onCreate, onEdit, onArchive, onDelete, onSchedule }) {');
const drawerStart = text.indexOf('\nfunction InboxItemDrawer(', inboxStart);
if (inboxStart < 0 || drawerStart < 0) throw new Error("InboxSection boundary not found");
const inboxReplacement = `function InboxSection({ items = [], onCreate, onEdit, onArchive, onDelete, onSchedule }) {
  const followups = items.filter((item) => item.kind === "followup");
  const ordinary = items.filter((item) => item.kind !== "followup");
  const renderOrdinary = (item) => (
    <div className="inbox-item-card" key={item.id}>
      <div className="inbox-item-main">
        <strong>{item.title}</strong>
        <span className="inbox-item-meta">
          {item.kind === "note" ? "记事" : INBOX_PRIORITY_LABEL[item.priority]}
          {item.kind === "task" ? (item.estimatedMinutes ? \` · \${item.estimatedMinutes}分钟\` : " · 时长未定") : ""}
          {item.deadline ? \` · 截止\${item.deadline}\` : ""}
          {item.source === "snowdust" ? " · 雪尘记的" : ""}
          {item.completedAt ? " · ✓ 已完成" : ""}
        </span>
      </div>
      <div className="inbox-item-actions">
        {item.kind === "task" && <button className="secondary-button compact" type="button" onClick={() => onSchedule(item)}>放进今日任务池</button>}
        <button className="icon-button" type="button" onClick={() => onEdit(item)} aria-label="编辑"><Edit3 size={15} /></button>
        <button className="icon-button" type="button" onClick={() => onArchive(item.id)} aria-label="归档"><History size={15} /></button>
        <button className="icon-button danger-text" type="button" onClick={() => onDelete(item.id)} aria-label="删除"><Trash2 size={15} /></button>
      </div>
    </div>
  );
  const renderFollowup = (item) => (
    <div className="inbox-item-card" key={item.id}>
      <div className="inbox-item-main">
        <strong>{item.title}</strong>
        <span className="inbox-item-meta">
          {item.completedAt
            ? \`✓ 已追问 · \${formatDateTime(item.completedAt)}\`
            : item.boundBlockId
              ? "跟随日程 · 待追问"
              : item.dueAt
                ? \`待追问 · \${formatDateTime(item.dueAt)}\`
                : "待追问"}
        </span>
      </div>
      <div className="inbox-item-actions">
        <span className="field-help">改时间 / 取消可直接告诉雪尘</span>
      </div>
    </div>
  );
  return (
    <section className="schedule-inbox-panel">
      <div className="mini-section-title">
        <div>
          <strong><Inbox size={14} style={{ verticalAlign: "-2px", marginRight: "0.25rem" }} />今天一起记</strong>
          <span>你和雪尘共用的小本本</span>
        </div>
      </div>
      <div className="button-row"><button className="primary-button compact" type="button" onClick={onCreate}><Plus size={16} />新增记事 / 待办</button></div>
      {ordinary.length === 0 && followups.length === 0 ? (
        <p className="field-help">今天还没有额外记下的事情。</p>
      ) : (
        <div className="inbox-item-list">
          {ordinary.length > 0 && <div className="task-pool-category-title">事项<span>{ordinary.length} 条</span></div>}
          {ordinary.map(renderOrdinary)}
          {followups.length > 0 && <div className="task-pool-category-title">🐾 雪尘等会儿会问<span>{followups.filter((item) => !item.completedAt).length} 待问</span></div>}
          {followups.map(renderFollowup)}
        </div>
      )}
    </section>
  );
}`;
text = `${text.slice(0, inboxStart)}${inboxReplacement}${text.slice(drawerStart)}`;

const newDrawerStart = text.indexOf('function InboxItemDrawer(');
const scheduleDialogStart = text.indexOf('\nfunction InboxScheduleMinutesDialog(', newDrawerStart);
if (newDrawerStart < 0 || scheduleDialogStart < 0) throw new Error("InboxItemDrawer boundary not found");
const drawerReplacement = `function InboxItemDrawer({ item, taxonomy = [], targetDate = "", onCancel, onSave }) {
  const editing = item && item !== "create";
  const [form, setForm] = useState({
    title: editing ? item.title : "",
    kind: editing && item.kind === "note" ? "note" : editing ? "task" : "note",
    targetDate: editing ? item.targetDate || "" : targetDate,
    categoryId: editing ? item.categoryId : "personal",
    estimatedMinutes: editing ? item.estimatedMinutes || 0 : 0,
    priority: editing ? item.priority : 2,
    deadline: editing ? item.deadline : "",
    note: editing ? item.note : "",
  });
  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }
  return (
    <div className="drawer-backdrop">
      <form className="today-task-drawer" onSubmit={(event) => {
        event.preventDefault();
        onSave({
          ...form,
          estimatedMinutes: form.kind === "task" && Number(form.estimatedMinutes) > 0 ? Number(form.estimatedMinutes) : null,
        });
      }}>
        <div className="panel-title">
          <div>
            <p className="eyebrow">今天一起记；需要时间时再放进时间线</p>
            <h2>{editing ? "编辑记事 / 待办" : "新增记事 / 待办"}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onCancel} aria-label="关闭">×</button>
        </div>
        <TextField label="标题" value={form.title} onChange={(value) => update("title", value)} required />
        <div className="two-column-fields">
          <SelectField label="类型" value={form.kind} onChange={(value) => update("kind", value)} options={[["note", "记事（不占时间）"], ["task", "待办（可安排进任务池）"]]} />
          <SelectField label="显示范围" value={form.targetDate ? "today" : "global"} onChange={(value) => update("targetDate", value === "today" ? targetDate : "")} options={[["today", "只在这一天显示"], ["global", "跨天待办 / 以后再做"]]} />
        </div>
        {form.kind === "task" && (
          <div className="two-column-fields">
            <CascadingCategoryFields taxonomy={taxonomy} categoryId={form.categoryId} onChange={(value) => update("categoryId", value)} />
            <SelectField label="优先级" value={String(form.priority)} onChange={(value) => update("priority", Number(value))} options={[["1", "P1"], ["2", "P2"], ["3", "P3"]]} />
            <NumberField label="预计时长（分钟，0 = 暂不填写）" value={form.estimatedMinutes} onChange={(value) => update("estimatedMinutes", value)} />
            <TextField label="截止日期（可选）" type="date" value={form.deadline} onChange={(value) => update("deadline", value)} />
          </div>
        )}
        <label className="field">
          <span>备注</span>
          <textarea value={form.note} onChange={(event) => update("note", event.target.value)} placeholder="例如：晚上记得拿充电器 / 下次有空再处理" />
        </label>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>取消</button>
          <button className="primary-button" type="submit">保存到一起记</button>
        </div>
      </form>
    </div>
  );
}`;
text = `${text.slice(0, newDrawerStart)}${drawerReplacement}${text.slice(scheduleDialogStart)}`;

fs.writeFileSync(file, text, "utf8");
console.log("shared ledger UI patch applied");
