(() => {
  document.documentElement.dataset.todayStandalone = "1";
  let lastPayload = null;

  function catId(value) {
    const raw = String(value || "").toLowerCase();
    if (raw.includes("math") || raw.includes("数学")) return "math";
    if (raw.includes("english") || raw.includes("ielts") || raw.includes("英语") || raw.includes("雅思")) return "english";
    if (raw.includes("economics") || raw.includes("professional") || raw.includes("finance") || raw.includes("经济") || raw.includes("专业")) return "pro";
    if (raw.includes("paper") || raw.includes("thesis") || raw.includes("论文")) return "paper";
    if (raw.includes("exercise") || raw.includes("sport") || raw.includes("运动")) return "exercise";
    if (raw.includes("reading") || raw.includes("阅读")) return "reading";
    if (raw.includes("entertainment") || raw.includes("rest") || raw.includes("娱乐") || raw.includes("休息")) return "rest";
    return "life";
  }

  function toSegment(item, placement) {
    const work = Number(item.work ?? item.workMinutes ?? item.activeMinutes ?? item.duration ?? 50);
    const rest = Number(item.rest ?? item.breakMinutes ?? item.breakAfter ?? 0);
    return {
      id: String(item.id || item.blockId || item.segmentId || "segment"),
      work: Number.isFinite(work) ? work : 50,
      rest: Number.isFinite(rest) ? rest : 0,
      placement,
      ...(placement === "timeline" ? { start: Number(item.start) } : {}),
      status: item.status || "pending",
      ...(Number.isFinite(Number(item.lastTimelineStart)) ? { lastTimelineStart: Number(item.lastTimelineStart) } : {}),
    };
  }

  function projectGroups(payload) {
    const map = new Map();
    const ensure = (item) => {
      const gid = String(item.groupId || item.taskGroupId || item.taskId || item.parentId || `group:${item.title || item.id}`);
      if (!map.has(gid)) {
        map.set(gid, {
          id: gid,
          title: item.title || "未命名任务",
          cat: catId(item.cat || item.categoryId || item.category || item.categoryLabel),
          priority: Number(item.priority || 2),
          splittable: item.splittable !== false,
          preferred: item.preferred || "afternoon",
          segments: [],
        });
      }
      return map.get(gid);
    };
    (payload.timelineBlocks || []).filter((b) => b.kind === "task").forEach((item) => {
      ensure(item).segments.push(toSegment(item, "timeline"));
    });
    (payload.poolSegments || []).forEach((item) => {
      ensure(item).segments.push(toSegment(item, "pool"));
    });
    return [...map.values()].filter((g) => g.segments.length);
  }

  function escText(value) {
    return String(value ?? "").replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
  }

  function applyGoals(items = [], total = {}) {
    const goalsBox = document.querySelector(".landscape-goals");
    const totalBox = document.querySelector(".landscape-goal-total");
    if (totalBox) totalBox.innerHTML = `<strong>${escText(total.targetLabel || "—")}</strong><span>${escText(total.subLabel || "目标统计下一阶段接入")}</span>`;
    if (!goalsBox) return;
    goalsBox.innerHTML = items.length
      ? items.slice(0, 5).map((item) => `<div class="goal-row"><span class="goal-row-top"><b>${escText(item.label || "目标")}</b><small>${escText(item.valueLabel || "")}</small></span></div>`).join("")
      : '<div class="detail-box">目标统计下一阶段接入；当前时间线已经读取真实 Planner。</div>';
  }

  function applyFollowup(item) {
    const box = document.querySelector(".landscape-followup");
    if (!box) return;
    if (!item) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.hidden = false;
    box.innerHTML = `<span>雪尘等会儿会问 · ${escText(item.modeLabel || "跟随日程")}</span><strong>${escText(item.title || "")}</strong><small>${escText(item.whenLabel || "跟随日程")} · 可修改 / 取消</small>`;
  }

  function applyState(payload) {
    if (!payload || typeof payload !== "object") return;
    lastPayload = payload;
    if (Number.isFinite(Number(payload.timelineStart))) DAY_START = Number(payload.timelineStart);
    if (Number.isFinite(Number(payload.timelineEnd))) DAY_END = Number(payload.timelineEnd);
    if (Number.isFinite(Number(payload.nowMinute))) NOW = Number(payload.nowMinute);

    groups = projectGroups(payload);
    fixed = (payload.timelineBlocks || []).filter((b) => b.kind !== "task").map((b) => ({
      id: String(b.id),
      title: b.title || "固定事项",
      cat: catId(b.cat || b.categoryId || b.category),
      type: b.type || "",
      start: Number(b.start),
      work: Math.max(1, Number(b.end) - Number(b.start)),
      rest: 0,
      protected: b.protected !== false,
      locked: b.locked !== false,
      status: b.status || "pending",
    }));
    locks = new Set((payload.timelineBlocks || []).filter((b) => b.locked).map((b) => String(b.id)));
    baseline = (payload.baseline || []).map((b) => ({
      start: Number(b.start),
      dur: Math.max(1, Number(b.end) - Number(b.start)),
      cat: catId(b.cat || b.categoryId || b.category),
    })).filter((b) => Number.isFinite(b.start) && Number.isFinite(b.dur));
    focusSessions = (payload.focusSessions || []).map((s) => ({
      start: Number(s.start), end: Number(s.end), title: s.title || "专注", note: s.note || "",
    }));
    inbox = (payload.inboxItems || []).map((item) => ({
      id: String(item.id),
      title: item.title || "待安排事项",
      kind: item.kind || (item.estimatedMinutes ? "task" : "note"),
      minutes: Number(item.minutes ?? item.estimatedMinutes) || null,
      priority: Number(item.priority || 2),
      cat: catId(item.cat || item.categoryId),
      done: Boolean(item.done || item.status === "archived"),
      source: item.source || "user",
      scheduled: item.status === "scheduled",
    }));

    const targetDate = payload.targetDate ? new Date(`${payload.targetDate}T12:00:00`) : null;
    const dateSpan = document.querySelector("#dateBtn span");
    if (dateSpan && targetDate && !Number.isNaN(targetDate.valueOf())) {
      dateSpan.textContent = `${targetDate.getMonth() + 1}月${targetDate.getDate()}日 · 周${"日一二三四五六"[targetDate.getDay()]}⌄`;
    }
    if (saveState) saveState.textContent = payload.saveLabel || "已同步";

    const cur = payload.currentBlock;
    const next = payload.nextBlock;
    const currentTitle = document.getElementById("currentTitle");
    const currentMeta = document.getElementById("currentMeta");
    if (currentTitle) currentTitle.textContent = cur?.title || "当前没有进行中的任务";
    if (currentMeta) {
      currentMeta.innerHTML = cur
        ? `<span>${fmt(cur.start)}–${fmt(cur.end)}</span><span>·</span><span class="rhythm">${escText(cur.rhythm || "")}</span>${cur.priority ? `<span>· P${Number(cur.priority)}</span>` : ""}`
        : "<span>查看时间线安排下一项</span>";
    }
    const nextTitle = document.getElementById("nextTitle");
    const nextTime = document.getElementById("nextTime");
    if (nextTitle) nextTitle.textContent = next?.title || "今天没有下一项";
    if (nextTime) nextTime.textContent = next ? fmt(next.start) : "";

    const overview = document.getElementById("overviewBtn");
    if (overview) overview.innerHTML = `<strong>已完成 ${escText(payload.completedLabel || "0min")}</strong> · 还剩 ${Number(payload.remainingCount || 0)} 项`;
    const inboxBtn = document.getElementById("inboxBtn");
    if (inboxBtn) inboxBtn.textContent = `🐾 一起记 · ${inbox.length}`;

    applyGoals(payload.goals || [], payload.goalTotal || {});
    applyFollowup(payload.followup || null);
    renderTicks();
    renderAll();
    requestAnimationFrame(() => initialScroll());
    document.getElementById("snowdust-live-boot-hide")?.remove();
    const rootNode = document.getElementById("root");
    if (rootNode) rootNode.style.visibility = "visible";
  }

  window.__SNOWDUST_TODAY_APPLY_STATE__ = applyState;
  window.addEventListener("snowdust:today-state", (event) => applyState(event.detail));

  function readOnlyToast() {
    toastMsg("同步联调中：这一版先只读");
  }

  // Phase 1 safety: presentation is real, writes stay disabled until the
  // standalone client has proven it reads the same canonical state as desktop.
  const originalFinishDrag = finishDrag;
  finishDrag = function readOnlyFinishDrag() {
    if (drag) {
      drag.sourceEl?.classList.remove("dragging");
      dragGhost.classList.remove("show");
      dropPreview.className = "drop-preview";
      clearTargets();
      drag = null;
      renderAll();
    }
    readOnlyToast();
  };
  returnToPool = function readOnlyReturn() { readOnlyToast(); };
  quickRestoreToTimeline = function readOnlyRestore() { readOnlyToast(); };
  saveNewTask = function readOnlyNewTask() { readOnlyToast(); };
  applyTemplate = function readOnlyTemplate() { readOnlyToast(); };
  saveTemplate = function readOnlyTemplateSave() { readOnlyToast(); };

  document.addEventListener("pointerdown", (event) => {
    if (event.target.closest("[data-resize-handle]")) {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); readOnlyToast();
    }
  }, true);

  document.addEventListener("click", (event) => {
    const writeTarget = event.target.closest("[data-meal-toggle],[data-pool-restore],[data-quick-return],[data-toggle-complete],[data-toggle-lock],[data-return],[data-apply-sticker-time],[data-sticker-toggle],[data-sticker-delete],[data-confirm-save-template],[data-apply-template]");
    if (writeTarget) {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); readOnlyToast(); return;
    }
    if (event.target.closest("#trackerBtn,#quickTemplateBtn,#overviewBtn,#moreBtn")) {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      toastMsg("这块下一阶段接真实数据；时间线与任务池已经是同一份 Planner");
    }
  }, true);
})();
