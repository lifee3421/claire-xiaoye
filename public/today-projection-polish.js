(() => {
  const CONTEXT_PATH = "/api/planner-ui-context";
  let rawContext = null;

  function safeColor(value) {
    const color = String(value || "").trim();
    return /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/i.test(color) ? color : "";
  }

  function rawBlockId(item = {}) {
    return String(item.id || item.blockId || item.segmentId || "");
  }

  function rawPoolId(item = {}) {
    return String(item.blockId || item.segmentId || item.id || "");
  }

  function taskTitle(item = {}) {
    return item.taskGroup?.title || item.groupTitle || item.title || item.segmentTitle || "";
  }

  function groupId(item = {}) {
    return String(item.taskGroup?.id || item.taskId || item.groupId || item.id || "");
  }

  function segmentIndex(item = {}) {
    const value = Number(item.segmentIndex ?? item.index);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function segmentTotal(item = {}) {
    const value = Number(item.segmentTotal ?? item.total ?? item.taskGroup?.segments?.length);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function colorFor(item = {}) {
    return safeColor(item.categoryColor || item.taskGroup?.categoryColor);
  }

  function projectTodayInbox(items = []) {
    return items.map((item) => ({
      ...item,
      minutes: item.estimatedMinutes || null,
      done: item.status === "archived",
      scheduled: item.status === "scheduled",
    }));
  }

  function enrichBlock(item, raw = {}) {
    return {
      ...item,
      groupId: groupId(raw) || item?.groupId,
      title: taskTitle(raw) || item?.title,
      categoryColor: colorFor(raw) || item?.categoryColor || "",
      index: segmentIndex(raw) || item?.index,
      total: segmentTotal(raw) || item?.total,
    };
  }

  function enrichPayload(payload = {}) {
    if (!rawContext) return payload;
    const rawTimeline = new Map((rawContext.timelineBlocks || []).map((item) => [rawBlockId(item), item]));
    const rawPool = new Map((rawContext.taskPool || []).map((item) => [rawPoolId(item), item]));
    const timelineBlocks = (payload.timelineBlocks || []).map((item) => enrichBlock(item, rawTimeline.get(String(item.id)) || {}));
    const enrichedTimeline = new Map(timelineBlocks.map((item) => [String(item.id), item]));

    return {
      ...payload,
      timelineBlocks,
      currentBlock: payload.currentBlock ? (enrichedTimeline.get(String(payload.currentBlock.id)) || payload.currentBlock) : null,
      nextBlock: payload.nextBlock ? (enrichedTimeline.get(String(payload.nextBlock.id)) || payload.nextBlock) : null,
      poolSegments: (payload.poolSegments || []).map((item) => {
        const raw = rawPool.get(String(item.id)) || {};
        return {
          ...enrichBlock(item, raw),
          lastTimelineStart: Number.isFinite(Number(raw.lastTimelineStart)) ? Number(raw.lastTimelineStart) : item.lastTimelineStart,
        };
      }),
      baseline: (payload.baseline || []).map((item, index) => ({
        ...item,
        categoryColor: safeColor(rawContext.baseline?.[index]?.categoryColor) || item.categoryColor || "",
      })),
      inboxItems: Array.isArray(rawContext.todayInbox)
        ? projectTodayInbox(rawContext.todayInbox)
        : payload.inboxItems,
    };
  }

  function applyCanonicalColors(payload = {}) {
    const timeline = new Map((payload.timelineBlocks || []).map((item) => [String(item.id), item]));
    document.querySelectorAll(".block[data-block-id]").forEach((node) => {
      const item = timeline.get(String(node.dataset.blockId));
      const color = safeColor(item?.categoryColor);
      if (!color) return;
      node.style.setProperty("--block-accent", color);
      node.style.borderLeftColor = color;
    });

    const pool = new Map((payload.poolSegments || []).map((item) => [String(item.id), item]));
    document.querySelectorAll(".pool-card[data-seg-id]").forEach((node) => {
      const item = pool.get(String(node.dataset.segId));
      const color = safeColor(item?.categoryColor);
      if (color) node.style.borderLeftColor = color;
    });

    const marks = [...document.querySelectorAll("#baselineStrip .baseline-mark")];
    (payload.baseline || []).forEach((item, index) => {
      const color = safeColor(item.categoryColor);
      if (color && marks[index]) marks[index].style.setProperty("--baseline-accent", color);
    });
  }

  function repairHeader(payload = {}) {
    const currentTitle = document.getElementById("currentTitle");
    if (currentTitle && payload.currentBlock?.title) currentTitle.textContent = payload.currentBlock.title;
    const nextTitle = document.getElementById("nextTitle");
    if (nextTitle) nextTitle.textContent = payload.nextBlock?.title || "今天没有下一项";
  }

  function repairSegmentLabels(payload = {}) {
    const timeline = new Map((payload.timelineBlocks || []).map((item) => [String(item.id), item]));
    document.querySelectorAll(".block[data-block-id]").forEach((node) => {
      const item = timeline.get(String(node.dataset.blockId));
      if (!item || item.kind !== "task") return;
      const title = node.querySelector(".block-copy strong");
      if (title && item.title) title.textContent = item.title;
      const rhythm = node.querySelector(".block-meta .rhythm");
      if (!rhythm) return;
      const work = Number(item.work || 0);
      const rest = Number(item.rest || 0);
      const total = Number(item.total || 1);
      const index = Number(item.index || 1);
      const priority = Number(item.priority || 2);
      const base = `${work}${rest ? `+${rest}` : ""}`;
      rhythm.textContent = total > 1 ? `${base} · ${index}/${total} · P${priority}` : `${base} · P${priority}`;
    });

    const poolByGroup = new Map();
    (payload.poolSegments || []).forEach((item) => {
      const gid = String(item.groupId || item.id);
      if (!poolByGroup.has(gid)) poolByGroup.set(gid, []);
      poolByGroup.get(gid).push(item);
    });
    document.querySelectorAll(".pool-card[data-seg-id]").forEach((node) => {
      const segId = String(node.dataset.segId || "");
      const item = (payload.poolSegments || []).find((row) => String(row.id) === segId);
      if (!item) return;
      const title = node.querySelector("strong");
      if (title && item.title) title.textContent = item.title;
      const meta = node.querySelector(".pool-meta .rhythm");
      if (!meta) return;
      const groupItems = poolByGroup.get(String(item.groupId || item.id)) || [item];
      const total = Number(item.total || groupItems.length || 1);
      const work = Number(item.work || 0);
      const rest = Number(item.rest || 0);
      const priority = Number(item.priority || 2);
      if (total > 1 && groupItems.length > 1) {
        const rhythms = [...new Set(groupItems.map((row) => `${Number(row.work || 0)}${Number(row.rest || 0) ? `+${Number(row.rest || 0)}` : ""}`))];
        const remaining = rhythms.length === 1 ? rhythms[0] : `${groupItems.reduce((sum, row) => sum + Number(row.work || 0) + Number(row.rest || 0), 0)}min / ${groupItems.length}段`;
        meta.textContent = `剩 ${groupItems.length}/${total} 块 · ${remaining} · P${priority}`;
      } else {
        meta.textContent = `${work}${rest ? `+${rest}` : ""} · P${priority}`;
      }
    });
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
    if (String(url).includes(CONTEXT_PATH) && response.ok) {
      try {
        const data = await response.clone().json();
        if (data?.context) rawContext = data.context;
      } catch (error) {
        console.warn("Today projection context capture failed", error);
      }
    }
    return response;
  };

  const originalApply = window.__SNOWDUST_TODAY_APPLY_STATE__;
  if (typeof originalApply === "function") {
    window.__SNOWDUST_TODAY_APPLY_STATE__ = (payload) => {
      const enriched = enrichPayload(payload);
      originalApply(enriched);
      applyCanonicalColors(enriched);
      repairHeader(enriched);
      repairSegmentLabels(enriched);
    };
  }
})();
