import React from "react";
import "./todayV13Surface.css";

function clock(minutes) {
  const value = Math.max(0, Number(minutes || 0));
  const hours = Math.floor(value / 60) % 24;
  const mins = Math.round(value % 60);
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function duration(minutes) {
  const value = Math.max(0, Math.round(Number(minutes || 0)));
  if (value < 60) return `${value}min`;
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  return mins ? `${hours}h${mins}` : `${hours}h`;
}

function dateLabel(dateValue) {
  if (!dateValue) return "今天";
  const date = new Date(`${dateValue}T12:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return dateValue;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(date).replace(/\//g, "月").replace(/日?周/, "日 · 周");
}

function blockRhythm(block) {
  if (!block) return "";
  const work = Number(block.studyMinutes ?? block.workMinutes ?? block.taskGroup?.segments?.[Math.max(0, Number(block.segmentIndex || 1) - 1)] ?? block.end - block.start);
  const rest = Number(block.breakMinutes ?? block.restMinutes ?? 0);
  const total = Number(block.segmentTotal || block.taskGroup?.segments?.length || 1);
  const index = Number(block.segmentIndex || 1);
  const priority = Number(block.priority ?? block.taskGroup?.priority ?? 2);
  return `${work}${rest ? `+${rest}` : ""} · ${index}/${total} · P${priority}`;
}

function goalColor(categoryId = "") {
  const key = String(categoryId).toLowerCase();
  if (key.includes("math")) return "var(--sdv13-math)";
  if (key.includes("english") || key.includes("ielts")) return "var(--sdv13-english)";
  if (key.includes("professional") || key.includes("econ") || key.includes("finance")) return "var(--sdv13-pro)";
  if (key.includes("paper") || key.includes("thesis")) return "var(--sdv13-paper)";
  if (key.includes("reading")) return "var(--sdv13-reading)";
  return "var(--sdv13-snow2)";
}

export default function TodayV13Surface({
  targetDate,
  saveLabel = "已保存",
  hasUnsavedChanges = false,
  nowMinute = 0,
  currentBlock,
  nextBlock,
  completedCount = 0,
  remainingCount = 0,
  scheduledMinutes = 0,
  totalBlocks = 0,
  poolOpen = false,
  poolCount = 0,
  onTogglePool,
  onMore,
  onOverview,
  onInbox,
  onTrackers,
  onTemplates,
  onCurrent,
  onFocusCurrent,
  onToday,
  onFocusNav,
  onChatNav,
  poolNode,
  timelineNode,
  goals = [],
  inboxItems = [],
  onInboxItem,
}) {
  const progress = totalBlocks ? Math.max(0, Math.min(100, Math.round((completedCount / totalBlocks) * 100))) : 0;
  const activeInbox = (inboxItems || []).slice(0, 3);
  const goalRows = (goals || []).filter((item) => Number(item.targetMinutes || item.scheduledMinutes || 0) > 0).slice(0, 4);
  const goalTarget = goalRows.reduce((sum, item) => sum + Number(item.targetMinutes || 0), 0);
  const goalScheduled = goalRows.reduce((sum, item) => sum + Number(item.scheduledMinutes || 0), 0);
  const currentTitle = currentBlock?.title || "当前没有进行中的任务";
  const nextTitle = nextBlock?.title || "今天后面暂时没有下一项";

  return (
    <div className={`today-v13-surface ${poolOpen ? "arrange" : ""}`}>
      <aside className="sdv13-pool-drawer" aria-hidden={!poolOpen}>
        <div className="sdv13-pool-head">
          <b>任务池 · {poolCount}</b>
          <button className="sdv13-pool-close" type="button" onClick={onTogglePool} aria-label="收起任务池">×</button>
        </div>
        <p className="sdv13-pool-sub">拖的是下一块。空白处精确放；压到卡片上可插入、互换或替换。</p>
        <div className="sdv13-real-pool-host">{poolNode}</div>
        <div className="sdv13-pool-note">沿用原 Planner：5 分钟吸附 / 同长互换 / 插入顺延 / 硬边界防撞。</div>
      </aside>

      <main className="sdv13-app">
        <header className="sdv13-topbar">
          <button className="sdv13-date-button" type="button" onClick={onToday}>
            <h1>今天</h1><span>{dateLabel(targetDate)}⌄</span>
          </button>
          <div className="sdv13-top-actions">
            <span className={`sdv13-save-dot ${hasUnsavedChanges ? "pending" : ""}`}><i />{hasUnsavedChanges ? "未保存" : saveLabel}</span>
            <button className="sdv13-pool-trigger" type="button" onClick={onTogglePool}>任务池 <b>{poolCount}</b></button>
            <button className="sdv13-round" type="button" onClick={onMore} aria-label="更多">•••</button>
          </div>
        </header>

        <div className="sdv13-content">
          <section className="sdv13-now-card">
            <div className="sdv13-now-kicker"><i /><span>现在 · {clock(nowMinute)}</span></div>
            <div className="sdv13-now-main">
              <button className="sdv13-now-copy" type="button" onClick={onCurrent}>
                <h2>{currentTitle}</h2>
                <div className="sdv13-now-meta">
                  {currentBlock ? <><span>{clock(currentBlock.start)}–{clock(currentBlock.end)}</span><span>·</span><span className="rhythm">{blockRhythm(currentBlock)}</span></> : <span>查看时间线安排下一项</span>}
                </div>
              </button>
              <button className="sdv13-focus-btn" type="button" onClick={onFocusCurrent}>开始专注</button>
            </div>
            <button className="sdv13-next-line" type="button" onClick={onCurrent}>
              <span>接下来</span><strong>{nextTitle}</strong>{nextBlock && <time>{clock(nextBlock.start)}</time>}
            </button>
          </section>

          <div className="sdv13-summary-row">
            <button className="sdv13-tiny-link" type="button" onClick={onOverview}><strong>已完成 {completedCount}</strong> · 还剩 {remainingCount} 项</button>
            <div className="sdv13-summary-progress"><i style={{ width: `${progress}%` }} /></div>
            <button className="sdv13-tiny-link" type="button" onClick={onInbox}>🐾 一起记 · {inboxItems.length}</button>
          </div>

          <aside className="sdv13-landscape-panel">
            <section className="sdv13-landscape-card sdv13-goals-card">
              <div className="sdv13-landscape-card-head"><b>今日目标</b><button type="button" onClick={onOverview}>统计</button></div>
              <div className="sdv13-landscape-goal-total"><strong>{duration(goalTarget || scheduledMinutes)}</strong><span>已排 {duration(goalScheduled || scheduledMinutes)}</span></div>
              <div className="sdv13-landscape-goals">
                {goalRows.length ? goalRows.map((item) => {
                  const target = Math.max(0, Number(item.targetMinutes || 0));
                  const scheduled = Math.max(0, Number(item.scheduledMinutes || 0));
                  const ratio = target ? Math.min(100, Math.round((scheduled / target) * 100)) : 0;
                  return <button className="sdv13-goal-row" type="button" onClick={onOverview} key={item.categoryId || item.categoryLabel}>
                    <span className="sdv13-goal-row-top"><b>{item.categoryLabel || item.label || "目标"}</b><small>{duration(scheduled)} / {duration(target)}</small></span>
                    <span className="sdv13-goal-bar"><i style={{ width: `${ratio}%`, background: goalColor(item.categoryId) }} /></span>
                  </button>;
                }) : <p className="sdv13-empty">今天还没有设置分类目标</p>}
              </div>
            </section>

            <section className="sdv13-landscape-card sdv13-inbox-card">
              <div className="sdv13-landscape-card-head"><b>🐾 今天一起记</b><button type="button" onClick={onInbox}>全部</button></div>
              <div className="sdv13-landscape-inbox-list">
                {activeInbox.length ? activeInbox.map((item) => <button className="sdv13-landscape-inbox-row" type="button" key={item.id} onClick={() => onInboxItem?.(item)}>
                  <span className="mark">{item.status === "archived" ? "✓" : item.kind === "note" ? "•" : "○"}</span>
                  <span><strong>{item.title}</strong><small>{item.kind === "note" ? "记事" : `待办${item.estimatedMinutes ? ` · ${item.estimatedMinutes}min` : ""}`}{item.source === "snowdust" ? " · 雪尘记的" : ""}</small></span>
                  <span className="state">›</span>
                </button>) : <p className="sdv13-empty">今天还没有一起记的内容</p>}
              </div>
            </section>
          </aside>

          <section className="sdv13-timeline-zone">
            <div className="sdv13-timeline-head">
              <h3>时间线</h3>
              {poolOpen && <span className="sdv13-edit-mode-chip">排程中 · 5min吸附</span>}
              <div className="sdv13-timeline-tools">
                <button className="sdv13-tracker-mini" type="button" onClick={onTrackers}><i /><span>追踪</span></button>
                <button className="sdv13-template-mini" type="button" onClick={onTemplates}><span>模板</span><b>⌄</b></button>
              </div>
            </div>
            <div className="sdv13-timeline-window">
              <div className="sdv13-real-timeline-host">{timelineNode}</div>
            </div>
          </section>
        </div>
      </main>

      <nav className="sdv13-bottomnav" aria-label="SnowDustApp 常用入口">
        <button className="active" type="button" onClick={onToday}><b>⌁</b><span>今天</span></button>
        <button type="button" onClick={onFocusNav}><b>◉</b><span>专注</span></button>
        <button type="button" onClick={onChatNav}><b>◌</b><span>雪尘</span></button>
      </nav>
    </div>
  );
}
