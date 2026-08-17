(() => {
  document.documentElement.dataset.todayStandalone = "1";
  let lastPayload = null;
  let optimisticScheduleBase = null;
  let optimisticSidecar = null;

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

  function canonicalCategoryId(cat) {
    return { math: "math", english: "english", pro: "economics", paper: "paper", exercise: "exercise", reading: "reading", rest: "entertainment", life: "personal" }[catId(cat)] || "personal";
  }

  function clockFromMinutes(value) {
    const minutes = Math.max(0, Math.min(1439, Math.round(Number(value) || 0)));
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
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
          preferred: Array.isArray(item.preferredPeriods) ? (item.preferredPeriods[0] || "afternoon") : (item.preferred || "afternoon"),
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

  function applyTemplates(items = []) {
    if (!Array.isArray(items) || !items.length) return;
    dayTemplates = items.map((item) => ({
      id: String(item.id || ""),
      name: item.name || "未命名模板",
      description: item.description || "",
      scene: item.scene || "",
      wake: item.wakeUpTime || "",
      bed: item.targetBedTime || "",
      default: Boolean(item.isDefault),
      builtin: Boolean(item.builtin),
      content: {
        fixed: [],
        pool: Array.from({ length: Number(item.defaultTaskCount || 0) }, (_, index) => `任务 ${index + 1}`),
        timeline: Array.from({ length: Number(item.timelineTaskCount || 0) }, (_, index) => `时间线 ${index + 1}`),
      },
    })).filter((item) => item.id);
    currentTemplateId = dayTemplates.find((item) => item.default)?.id || (dayTemplates.some((item) => item.id === currentTemplateId) ? currentTemplateId : dayTemplates[0]?.id || currentTemplateId);
  }

  function currentScheduleSnapshot() {
    const tasks = new Map();
    groups.forEach((group) => group.segments.forEach((segment) => {
      if (segment.placement === "history") return;
      const base = optimisticScheduleBase?.tasks?.get(String(segment.id)) || null;
      tasks.set(String(segment.id), {
        id: String(segment.id),
        groupId: String(group.id),
        title: group.title || "未命名任务",
        cat: group.cat || "life",
        categoryId: base?.categoryId || canonicalCategoryId(group.cat),
        categoryColor: base?.categoryColor || "",
        priority: Number(group.priority || 2),
        preferred: group.preferred || "afternoon",
        work: Math.max(1, Number(segment.work || 1)),
        rest: Math.max(0, Number(segment.rest || 0)),
        placement: segment.placement === "timeline" ? "timeline" : "pool",
        start: segment.placement === "timeline" && Number.isFinite(Number(segment.start)) ? Number(segment.start) : null,
        status: segment.status || "pending",
        locked: locks.has(String(segment.id)),
        source: group.source || "",
        originInboxItemId: group.originInboxItemId || "",
      });
    }));
    const fixedMap = new Map(fixed.map((item) => [String(item.id), { id: String(item.id), status: item.status || "pending" }]));
    return { tasks, fixed: fixedMap };
  }

  function scheduleSnapshotFromPayload(payload) {
    const tasks = new Map();
    (payload?.timelineBlocks || []).filter((item) => item.kind === "task").forEach((item) => tasks.set(String(item.id), {
      id: String(item.id), groupId: String(item.groupId || item.taskId || item.id), title: item.title || "未命名任务",
      cat: catId(item.cat || item.categoryId || item.category), categoryId: item.categoryId || canonicalCategoryId(item.cat), categoryColor: item.categoryColor || "",
      priority: Number(item.priority || 2), preferred: Array.isArray(item.preferredPeriods) ? item.preferredPeriods[0] : (item.preferred || "afternoon"),
      work: Number(item.work || 1), rest: Number(item.rest || 0), placement: "timeline", start: Number(item.start), status: item.status || "pending", locked: Boolean(item.locked),
      source: item.source || "", originInboxItemId: item.originInboxItemId || "",
    }));
    (payload?.poolSegments || []).forEach((item) => tasks.set(String(item.id), {
      id: String(item.id), groupId: String(item.groupId || item.taskId || item.id), title: item.title || "未命名任务",
      cat: catId(item.cat || item.categoryId || item.category), categoryId: item.categoryId || canonicalCategoryId(item.cat), categoryColor: item.categoryColor || "",
      priority: Number(item.priority || 2), preferred: Array.isArray(item.preferredPeriods) ? item.preferredPeriods[0] : (item.preferred || "afternoon"),
      work: Number(item.work || 1), rest: Number(item.rest || 0), placement: "pool", start: null, status: item.status || "pending", locked: Boolean(item.locked),
      source: item.source || "", originInboxItemId: item.originInboxItemId || "",
    }));
    const fixedMap = new Map((payload?.timelineBlocks || []).filter((item) => item.kind !== "task").map((item) => [String(item.id), { id: String(item.id), status: item.status || "pending" }]));
    return { tasks, fixed: fixedMap };
  }

  function sameValue(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  function createChangeForGroup(group, segments) {
    const rests = [...new Set(segments.map((segment) => Number(segment.rest || 0)))];
    const firstTimeline = segments.find((segment) => segment.placement === "timeline" && Number.isFinite(segment.start));
    return {
      type: "create_task",
      taskId: String(group.id),
      title: group.title || "未命名任务",
      segments: segments.map((segment) => Math.max(1, Number(segment.work || 1))),
      estimatedMinutes: Math.max(1, Number(segments[0]?.work || 1)),
      breakMinutes: rests.length === 1 ? rests[0] : Number(segments[0]?.rest || 0),
      categoryId: canonicalCategoryId(group.cat),
      priority: Number(group.priority || 2),
      preferredPeriods: [group.preferred || "afternoon"],
      source: group.source || "xiaoye-ui",
      ...(group.originInboxItemId ? { source: "inbox", sourceId: group.originInboxItemId, originInboxItemId: group.originInboxItemId } : {}),
      ...(firstTimeline && segments.length === 1 ? { start: clockFromMinutes(firstTimeline.start) } : {}),
    };
  }

  function diffSchedule(base, current) {
    const changes = [];
    const newByGroup = new Map();
    current.tasks.forEach((item, id) => {
      if (base.tasks.has(id)) return;
      if (!newByGroup.has(item.groupId)) newByGroup.set(item.groupId, []);
      newByGroup.get(item.groupId).push(item);
    });
    newByGroup.forEach((segments, groupId) => {
      const group = groups.find((item) => String(item.id) === String(groupId));
      if (group) changes.push(createChangeForGroup(group, segments));
    });

    base.tasks.forEach((before, id) => {
      const after = current.tasks.get(id);
      if (!after) { changes.push({ type: "delete_task", blockId: id }); return; }

      const edit = { type: "edit_task", blockId: id };
      let hasEdit = false;
      if (before.title !== after.title) { edit.title = after.title; hasEdit = true; }
      if (Number(before.work) !== Number(after.work)) { edit.estimatedMinutes = Number(after.work); hasEdit = true; }
      if (Number(before.rest) !== Number(after.rest)) { edit.breakMinutes = Number(after.rest); hasEdit = true; }
      if (Number(before.priority) !== Number(after.priority)) { edit.priority = Number(after.priority); hasEdit = true; }
      if ((before.preferred || "") !== (after.preferred || "")) { edit.preferredPeriods = [after.preferred || "afternoon"]; hasEdit = true; }
      if ((before.status || "pending") !== (after.status || "pending")) { edit.status = after.status || "pending"; hasEdit = true; }
      if (Boolean(before.locked) !== Boolean(after.locked)) { edit.locked = Boolean(after.locked); hasEdit = true; }

      if (before.placement === "timeline" && after.placement === "pool") {
        if (hasEdit) changes.push(edit);
        changes.push({ type: "return_to_pool", blockId: id });
        return;
      }
      if (before.placement === "pool" && after.placement === "timeline") {
        if (hasEdit) changes.push(edit);
        changes.push({ type: "schedule_from_pool", blockId: id, start: clockFromMinutes(after.start) });
        return;
      }
      if (before.placement === "timeline" && after.placement === "timeline" && Number(before.start) !== Number(after.start)) {
        if (hasEdit) {
          edit.start = clockFromMinutes(after.start);
          changes.push(edit);
        } else {
          changes.push({ type: "move", blockId: id, start: clockFromMinutes(after.start) });
        }
        return;
      }
      if (hasEdit) changes.push(edit);
    });

    const systemCards = [];
    base.fixed.forEach((before, id) => {
      const after = current.fixed.get(id);
      if (after && before.status !== after.status) systemCards.push({ blockId: id, status: after.status || "pending" });
    });
    return { changes: changes.filter(Boolean), systemCards };
  }

  function persistSchedule(label = "保存排程", options = {}) {
    if (!optimisticScheduleBase || typeof window.__SNOWDUST_TODAY_MUTATE__ !== "function") return;
    const current = currentScheduleSnapshot();
    const { changes, systemCards } = diffSchedule(optimisticScheduleBase, current);
    if (!changes.length && !systemCards.length) return;
    optimisticScheduleBase = current;
    if (changes.length) {
      window.__SNOWDUST_TODAY_MUTATE__({ changes, label, ...(options.inboxTransition ? { inboxTransition: options.inboxTransition } : {}) }).catch(() => {});
    }
    systemCards.forEach((item) => window.__SNOWDUST_TODAY_META__?.({ action: "system_card_status", blockId: item.blockId, status: item.status, label: `${item.status === "completed" ? "完成" : "恢复"}生活节点` }).catch(() => {}));
  }

  function persistSidecar() {
    if (!optimisticSidecar || typeof window.__SNOWDUST_TODAY_SIDECAR__ !== "function") return;
    const current = { stickers: structuredClone(stickers || []), suppressedStickerGenerationKeys: [...(suppressedStickerGenerationKeys || [])] };
    if (sameValue(current, optimisticSidecar)) return;
    optimisticSidecar = structuredClone(current);
    window.__SNOWDUST_TODAY_SIDECAR__(current).catch(() => {});
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
      scheduled: Boolean(item.scheduled || item.status === "scheduled"),
    }));
    if (Array.isArray(payload.stickers)) stickers = structuredClone(payload.stickers);
    if (Array.isArray(payload.suppressedStickerGenerationKeys)) suppressedStickerGenerationKeys = [...payload.suppressedStickerGenerationKeys];
    applyTemplates(payload.templates || []);

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
    if (currentMeta) currentMeta.innerHTML = cur
      ? `<span>${fmt(cur.start)}–${fmt(cur.end)}</span><span>·</span><span class="rhythm">${escText(cur.rhythm || "")}</span>${cur.priority ? `<span>· P${Number(cur.priority)}</span>` : ""}`
      : "<span>查看时间线安排下一项</span>";
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
    optimisticScheduleBase = scheduleSnapshotFromPayload(payload);
    optimisticSidecar = { stickers: structuredClone(stickers || []), suppressedStickerGenerationKeys: [...(suppressedStickerGenerationKeys || [])] };
    requestAnimationFrame(() => initialScroll());
    document.getElementById("snowdust-live-boot-hide")?.remove();
    const rootNode = document.getElementById("root");
    if (rootNode) rootNode.style.visibility = "visible";
  }

  window.__SNOWDUST_TODAY_APPLY_STATE__ = applyState;
  window.addEventListener("snowdust:today-state", (event) => applyState(event.detail));
  window.addEventListener("snowdust:today-write-state", (event) => {
    const detail = event.detail || {};
    if (saveState) saveState.textContent = detail.state === "saving" ? "保存中…" : detail.state === "error" ? "保存失败" : "已同步";
    if (detail.message && detail.state === "error") toastMsg(detail.message);
  });

  const originalSetSaved = setSaved;
  setSaved = function liveSetSaved(text = "已保存") {
    originalSetSaved(text);
    queueMicrotask(() => { persistSchedule(text); persistSidecar(); });
  };

  const originalDeleteSeg = deleteSeg;
  deleteSeg = function liveDeleteSeg(id) {
    originalDeleteSeg(id);
    persistSchedule("已删除");
  };

  const originalCopyGroup = copyGroup;
  copyGroup = function liveCopyGroup(id) {
    originalCopyGroup(id);
    persistSchedule("已复制到任务池");
  };

  const originalAddPoolGroupFromInbox = addPoolGroupFromInbox;
  addPoolGroupFromInbox = function liveAddPoolGroupFromInbox(item) {
    const beforeIds = new Set(groups.map((group) => String(group.id)));
    originalAddPoolGroupFromInbox(item);
    const created = groups.find((group) => !beforeIds.has(String(group.id)));
    if (!created) return;
    created.source = "inbox";
    created.originInboxItemId = String(item.id);
    persistSchedule("已放进今日任务池", { inboxTransition: { itemId: String(item.id), taskId: String(created.id) } });
  };

  const originalApplyTemplate = applyTemplate;
  applyTemplate = function liveApplyTemplate(id) {
    originalApplyTemplate(id);
    window.__SNOWDUST_TODAY_APPLY_TEMPLATE__?.({ templateId: id, label: "应用模板" }).catch(() => {});
  };

  const originalSaveTemplate = saveTemplate;
  saveTemplate = function liveSaveTemplate(updateId) {
    const name = (document.getElementById("templateName")?.value || "").trim();
    if (!name) { originalSaveTemplate(updateId); return; }
    originalSaveTemplate(updateId);
    window.__SNOWDUST_TODAY_META__?.({
      action: "template_save",
      templateId: updateId && updateId !== "new" ? updateId : "",
      name,
      label: updateId && updateId !== "new" ? "更新模板" : "保存模板",
    }).catch(() => {});
  };

  const originalOpenInbox = openInbox;
  openInbox = function liveOpenInbox() {
    originalOpenInbox();
    const follow = sheetContent.querySelector(".followup");
    const real = lastPayload?.followup;
    if (follow) {
      if (real) follow.innerHTML = `<b>${escText(real.title || "")}</b><span>${escText(real.modeLabel || "跟随日程")} · ${escText(real.whenLabel || "")} · 可修改 / 取消</span>`;
      else follow.innerHTML = '<b>今天没有约好的追问</b><span>雪尘和你约好追问后才会出现在这里</span>';
    }
  };

  document.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-inbox-toggle]");
    if (toggle) {
      const item = inbox.find((row) => String(row.id) === String(toggle.dataset.inboxToggle));
      if (item) window.__SNOWDUST_TODAY_META__?.({ action: "inbox_set_done", itemId: String(item.id), done: Boolean(item.done), label: item.done ? "完成一起记" : "恢复一起记" }).catch(() => {});
    }
    const setDefault = event.target.closest("[data-set-default-template]");
    if (setDefault) window.__SNOWDUST_TODAY_META__?.({ action: "template_set_default", templateId: setDefault.dataset.setDefaultTemplate, label: "设置默认模板" }).catch(() => {});
    const copyTemplate = event.target.closest("[data-copy-template]");
    if (copyTemplate) window.__SNOWDUST_TODAY_META__?.({ action: "template_copy", templateId: copyTemplate.dataset.copyTemplate, label: "复制模板" }).catch(() => {});
    if (event.target.closest("[data-quick-sticker]")) queueMicrotask(persistSidecar);
  });

  document.addEventListener("click", (event) => {
    const addButton = event.target.closest('[data-toast="Preview：新增记事 / 待办"]');
    if (!addButton) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openSheet(sheetHead("新增一起记", "记事不占时间；待办需要时再放进任务池") + `
      <div class="field-wrap" style="margin-top:7px"><label>内容</label><input id="liveInboxTitle" class="field" placeholder="写点什么"></div>
      <div class="field-grid" style="margin-top:7px">
        <div class="field-wrap"><label>类型</label><select id="liveInboxKind" class="field"><option value="note">记事</option><option value="task">待办</option></select></div>
        <div class="field-wrap"><label>预计分钟（待办）</label><input id="liveInboxMinutes" class="field" type="number" min="5" step="5" value="30"></div>
      </div>
      <button class="sheet-btn primary" style="width:100%;margin-top:9px" data-live-inbox-create>保存到今天一起记</button>`);
  }, true);

  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-live-inbox-create]")) return;
    const title = (document.getElementById("liveInboxTitle")?.value || "").trim();
    const kind = document.getElementById("liveInboxKind")?.value || "note";
    const minutes = Number(document.getElementById("liveInboxMinutes")?.value || 0);
    if (!title) { toastMsg("先写内容"); return; }
    closeSheet();
    window.__SNOWDUST_TODAY_META__?.({ action: "inbox_create", title, kind, estimatedMinutes: kind === "task" ? Math.max(5, minutes || 30) : null, label: "新增一起记" }).catch(() => {});
  });
})();