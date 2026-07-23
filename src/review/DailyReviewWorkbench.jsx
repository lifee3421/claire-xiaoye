import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Save } from "lucide-react";
import { createReviewDraft, otherSections, reviewSections } from "./dailyReviewSchema.js";
import { buildLegacyReviewValues, buildReviewMarkdown, buildStructuredReview } from "./reviewDraftSerializer.js";
import { buildSettlementInputFromReview } from "./reviewPointsAdapter.js";

function dateShift(date, offset) { const next = new Date(`${date}T12:00:00`); next.setDate(next.getDate() + offset); return next.toISOString().slice(0, 10); }
function dynamicProjectGroups(profile) {
  return (Array.isArray(profile?.reviewProjects) ? profile.reviewProjects : [])
    .map((project) => typeof project === "string" ? { id: project, name: project } : project)
    .filter((project) => project?.name && project.name !== "个人管理系统 / DustSnow")
    .map((project) => [project.name, `projects.${String(project.id || project.name).trim().replace(/[^a-zA-Z0-9_-]+/g, "_")}`, ["总时长|min", "今日推进|text", "调整|text"]]);
}
function Field({ draft, path, definition, onChange }) { const [label, kind = "text"] = definition.split("|"); const state = draft.fields[path] || {}; const isText = kind === "text"; if (kind.startsWith("select:")) return <label className="review-field"><span>{label}</span><select value={state.value ?? ""} onChange={(event) => onChange(path, event.target.value)}><option value="">未填写</option>{kind.slice(7).split(",").map((item) => <option key={item}>{item}</option>)}</select>{state.manuallyEdited && <small>手动修改</small>}</label>; return <label className="review-field"><span>{label}</span>{isText ? <textarea rows={2} value={state.value ?? ""} onChange={(event) => onChange(path, event.target.value)} /> : <input type={kind === "time" ? "time" : "number"} min={kind === "score" ? 0 : 0} max={kind === "score" ? 10 : undefined} value={state.value ?? ""} onChange={(event) => onChange(path, kind === "time" ? event.target.value : Number(event.target.value || 0))} />}{state.manuallyEdited && <small>手动修改</small>}</label>; }
function Group({ draft, group, onChange }) { const [title, prefix, definitions] = group; return <section className="review-section-card"><h3>{title}</h3><div className="review-field-grid">{definitions.map((definition) => <Field key={definition} draft={draft} path={`${prefix}.${definition.split("|")[0]}`} definition={definition} onChange={onChange} />)}</div></section>; }

export default function DailyReviewWorkbench({ profile, settlements = [], onSubmit }) {
  const toolbarRef = useRef(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  const [draft, setDraft] = useState(() => createReviewDraft(today));
  const settlementInput = useMemo(() => buildSettlementInputFromReview(draft, profile, today), [draft, profile, today]);
  const categories = useMemo(() => reviewSections.map(([title, groups]) => title === "项目" ? [title, [...groups, ...dynamicProjectGroups(profile)]] : [title, groups]), [profile]);
  const legacy = settlementInput;
  const existingSettlement = useMemo(() => settlements.find((item) => item.reviewDate === draft.date), [settlements, draft.date]);
  const settlementPointDelta = Number(settlementInput.pointsAdded || 0) - Number(existingSettlement?.pointsAdded || 0);
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return undefined;
    const update = () => setToolbarHeight(Math.ceil(toolbar.getBoundingClientRect().height));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);
  const changeField = (path, value) => setDraft((current) => ({ ...current, status: "editing", updatedAt: new Date().toISOString(), fields: { ...current.fields, [path]: { ...(current.fields[path] || {}), value, manuallyEdited: true, source: "manual", editedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } } }));
  const changeDate = (date) => setDraft(createReviewDraft(date));
  const submit = () => { const markdown = buildReviewMarkdown(draft); const structuredReview = buildStructuredReview(draft); onSubmit({ ...settlementInput, rawReview: markdown, reviewData: structuredReview, structuredReview, reviewSchemaVersion: 2, reviewDraftDate: draft.date, manualOverridePaths: structuredReview.manualOverridePaths, settlementRevision: Number(existingSettlement?.settlementRevision || 0), existingSettlementId: existingSettlement?.id || "" }, { sync: Boolean(draft.fields["diary.正文"]?.value), diary: draft.fields["diary.正文"]?.value ? { title:draft.fields["diary.标题"]?.value, content:draft.fields["diary.正文"]?.value, rawTags:draft.fields["diary.标签"]?.value } : null, strategy:"overwrite" }, existingSettlement); setDraft((current)=>({ ...current, status:"submitted", submittedAt:new Date().toISOString() })); };
  return <section className="review-workbench" style={{ "--review-toolbar-height": `${toolbarHeight}px` }}><header ref={toolbarRef} className="review-toolbar"><div><p className="eyebrow">Daily review</p><h2>今日复盘与结算</h2><p>系统先整理事实，你只负责修改和补充。</p></div><div className="review-date-controls"><button type="button" onClick={()=>changeDate(dateShift(draft.date,-1))}><ChevronLeft size={16}/>前一天</button><strong>{draft.date}</strong><input aria-label="复盘日期" type="date" value={draft.date} onChange={(event)=>changeDate(event.target.value)} /><button type="button" onClick={()=>changeDate(dateShift(draft.date,1))}>后一天<ChevronRight size={16}/></button><button type="button" onClick={()=>changeDate(today)}>回到今天</button></div><div className="review-toolbar-actions"><span>{existingSettlement ? "已保存，可修订" : "已修改"}</span><button type="button" onClick={() => { const blob = new Blob([buildReviewMarkdown(draft)], { type: "text/markdown;charset=utf-8" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${draft.date}-复盘.md`; link.click(); URL.revokeObjectURL(link.href); }}><Download size={16}/>导出 Markdown</button><button className="primary-button" type="button" onClick={submit}><Save size={16}/>{existingSettlement ? "修订复盘并校准" : "保存复盘并结算"}</button></div></header><section className="focus-overview-panel"><strong>专注数据</strong><span>数据来源：滴答 Focus</span><p>原始数据，仅供核对；当前阶段尚未同步 Focus，所有复盘字段均可手动填写。</p></section><main className="review-columns"><div>{categories.map(([title, groups])=><section key={title} className="review-category"><h2>{title}</h2>{groups.map((group)=><Group key={group[1]} draft={draft} group={group} onChange={changeField}/>)}</section>)}</div><div>{otherSections.map((group)=><Group key={group[1]} draft={draft} group={group} onChange={changeField}/>)}</div></main><section className="points-settlement-preview"><h2>结算预览</h2><strong>预计 {settlementPointDelta >= 0 ? "+" : ""}{settlementPointDelta} 分</strong><span>保存后余额 {Number(profile?.points || 0) + settlementPointDelta} 分 · 真实学习 {legacy.studyMinutes}min · 运动 {legacy.exerciseMinutes}min · 工作 {legacy.workMinutes}min · 娱乐 {legacy.totalEntertainmentMinutes}/90min</span><button className="primary-button" type="button" onClick={submit}>{existingSettlement ? "修订复盘并校准" : "保存复盘并结算"}</button></section></section>;
}
