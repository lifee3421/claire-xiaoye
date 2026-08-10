import fs from "node:fs";

const file = "src/App.jsx";
let text = fs.readFileSync(file, "utf8");

function replaceOnce(before, after, label) {
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one anchor, found ${count}`);
  text = text.replace(before, after);
}

replaceOnce(
`  function archiveInboxItemById(id) {
    onSaveProfile({ plannerInbox: archiveInboxItem(inboxItems, id) });
    setSaveState("已归档待安排事项");
  }

  function deleteInboxItemById(id) {`,
`  function archiveInboxItemById(id) {
    onSaveProfile({ plannerInbox: archiveInboxItem(inboxItems, id) });
    setSaveState("已归档一起记事项");
  }

  function toggleInboxItemCompletionById(item) {
    if (!item?.id || item.kind === "followup") return;
    const completed = !item.completedAt;
    onSaveProfile({
      plannerInbox: updateInboxItem(inboxItems, item.id, { completedAt: completed ? new Date().toISOString() : "" }),
    });
    setSaveState(completed ? "已完成一起记事项" : "已恢复一起记事项");
  }

  function deleteInboxItemById(id) {`,
  "shared ledger completion handler",
);

replaceOnce(
`onInboxArchive={archiveInboxItemById} onInboxDelete={deleteInboxItemById} onInboxSchedule={(item) => scheduleInboxItemToToday(item)} />`,
`onInboxArchive={archiveInboxItemById} onInboxDelete={deleteInboxItemById} onInboxToggleComplete={toggleInboxItemCompletionById} onInboxSchedule={(item) => scheduleInboxItemToToday(item)} />`,
  "task pool shared ledger props",
);

replaceOnce(
`function TaskPoolPreview({ tasks, segments, order, categoryOrder = [], categoryCatalog = [], categoryColors = {}, onEdit, onCreate, onDelete, onClear, onArrange, onEditCategoryOrder, inboxItems = [], onInboxCreate, onInboxEdit, onInboxArchive, onInboxDelete, onInboxSchedule }) {`,
`function TaskPoolPreview({ tasks, segments, order, categoryOrder = [], categoryCatalog = [], categoryColors = {}, onEdit, onCreate, onDelete, onClear, onArrange, onEditCategoryOrder, inboxItems = [], onInboxCreate, onInboxEdit, onInboxArchive, onInboxDelete, onInboxToggleComplete, onInboxSchedule }) {`,
  "TaskPoolPreview signature",
);

const inboxCall = `<InboxSection items={inboxItems} onCreate={onInboxCreate} onEdit={onInboxEdit} onArchive={onInboxArchive} onDelete={onInboxDelete} onSchedule={onInboxSchedule} />`;
replaceOnce(
`      <div className="button-row"><button className="primary-button compact" type="button" onClick={onCreate}><Plus size={16} />新增当天任务块</button><button className="secondary-button compact danger-text" type="button" disabled={!segments.length} onClick={onClear}>清空任务池</button></div>
      <SortableContext`,
`      <div className="button-row"><button className="primary-button compact" type="button" onClick={onCreate}><Plus size={16} />新增当天任务块</button><button className="secondary-button compact danger-text" type="button" disabled={!segments.length} onClick={onClear}>清空任务池</button></div>
      <InboxSection items={inboxItems} onCreate={onInboxCreate} onEdit={onInboxEdit} onArchive={onInboxArchive} onDelete={onInboxDelete} onToggleComplete={onInboxToggleComplete} onSchedule={onInboxSchedule} />
      <SortableContext`,
  "move shared ledger above task list",
);
replaceOnce(`      ${inboxCall}\n`, "", "remove old bottom shared ledger");

replaceOnce(
`function InboxSection({ items = [], onCreate, onEdit, onArchive, onDelete, onSchedule }) {`,
`function InboxSection({ items = [], onCreate, onEdit, onArchive, onDelete, onToggleComplete, onSchedule }) {`,
  "InboxSection signature",
);

replaceOnce(
`      <div className="inbox-item-actions">
        {item.kind === "task" && <button className="secondary-button compact" type="button" onClick={() => onSchedule(item)}>放进今日任务池</button>}
        <button className="icon-button" type="button" onClick={() => onEdit(item)} aria-label="编辑"><Edit3 size={15} /></button>`,
`      <div className="inbox-item-actions">
        <button className="secondary-button compact" type="button" onClick={() => onToggleComplete(item)}>{item.completedAt ? "恢复" : "✓ 完成"}</button>
        {item.kind === "task" && !item.completedAt && <button className="secondary-button compact" type="button" onClick={() => onSchedule(item)}>放进今日任务池</button>}
        <button className="icon-button" type="button" onClick={() => onEdit(item)} aria-label="编辑"><Edit3 size={15} /></button>`,
  "ordinary completion action",
);

fs.writeFileSync(file, text, "utf8");
console.log("shared ledger UI polish applied");
