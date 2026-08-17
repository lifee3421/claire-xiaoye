(() => {
  const params = new URLSearchParams(window.location.search);
  const live = params.get('live') === '1' && window.parent !== window;
  if (!live) return;

  document.documentElement.dataset.live = '1';
  const sameOrigin = window.location.origin;
  let ready = false;
  let liveFollowup = null;

  function send(action, payload = {}) {
    window.parent.postMessage({ type: 'snowdust:today-v14-action', action, payload }, sameOrigin);
  }

  function categoryId(value) {
    const raw = String(value || '').toLowerCase();
    if (raw.includes('math') || raw.includes('数学')) return 'math';
    if (raw.includes('english') || raw.includes('ielts') || raw.includes('英语') || raw.includes('雅思')) return 'english';
    if (raw.includes('pro') || raw.includes('finance') || raw.includes('经济') || raw.includes('专业')) return 'pro';
    if (raw.includes('paper') || raw.includes('thesis') || raw.includes('论文')) return 'paper';
    if (raw.includes('exercise') || raw.includes('sport') || raw.includes('运动')) return 'exercise';
    if (raw.includes('reading') || raw.includes('阅读')) return 'reading';
    return 'life';
  }

  function toSegment(item, placement) {
    const work = Number(item.work ?? item.workMinutes ?? item.activeMinutes ?? item.duration ?? 50);
    const rest = Number(item.rest ?? item.breakMinutes ?? item.breakAfter ?? 0);
    return {
      id: String(item.id || item.blockId),
      work: Number.isFinite(work) ? work : 50,
      rest: Number.isFinite(rest) ? rest : 0,
      placement,
      ...(placement === 'timeline' ? { start: Number(item.start) } : {}),
      status: item.status || 'pending',
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
          title: item.title || '未命名任务',
          cat: categoryId(item.cat || item.categoryId || item.category || item.categoryLabel),
          priority: Number(item.priority || 2),
          splittable: item.splittable !== false,
          preferred: item.preferred || 'afternoon',
          segments: [],
        });
      }
      return map.get(gid);
    };
    (payload.timelineBlocks || []).filter((b) => b.kind === 'task').forEach((item) => {
      ensure(item).segments.push(toSegment(item, 'timeline'));
    });
    (payload.poolSegments || []).forEach((item) => {
      ensure(item).segments.push(toSegment(item, 'pool'));
    });
    return [...map.values()].filter((g) => g.segments.length);
  }

  function applyGoals(items = [], total = {}) {
    const goalsBox = document.querySelector('.landscape-goals');
    const totalBox = document.querySelector('.landscape-goal-total');
    if (totalBox) {
      totalBox.innerHTML = `<strong>${esc(total.targetLabel || '0min')}</strong><span>${esc(total.subLabel || '')}</span>`;
    }
    if (!goalsBox) return;
    goalsBox.innerHTML = items.slice(0, 5).map((item) => {
      const pct = Math.max(0, Math.min(100, Number(item.percent || 0)));
      const cat = categoryId(item.categoryId || item.categoryLabel);
      return `<button class="goal-row" data-live-goal="${esc(item.categoryId || '')}">
        <span class="goal-row-top"><b>${esc(item.label || item.categoryLabel || '目标')}</b><small>${esc(item.valueLabel || '')}</small></span>
        <span class="goal-bar"><i style="width:${pct}%;background:var(--${classFor(cat)})"></i></span>
      </button>`;
    }).join('');
  }

  function applyFollowup(item) {
    const box = document.querySelector('.landscape-followup');
    if (!box) return;
    if (!item) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const when = item.whenLabel || '跟随日程';
    box.innerHTML = `<span>雪尘等会儿会问 · ${esc(item.modeLabel || '跟随日程')}</span><strong>${esc(item.title || '')}</strong><small>${esc(when)} · 可修改 / 取消</small>`;
  }

  function applyState(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (Number.isFinite(Number(payload.timelineStart))) DAY_START = Number(payload.timelineStart);
    if (Number.isFinite(Number(payload.timelineEnd))) DAY_END = Number(payload.timelineEnd);
    if (Number.isFinite(Number(payload.nowMinute))) NOW = Number(payload.nowMinute);

    groups = projectGroups(payload);
    fixed = (payload.timelineBlocks || []).filter((b) => b.kind !== 'task').map((b) => ({
      id: String(b.id), title: b.title || '固定事项', cat: categoryId(b.cat || b.categoryId || b.category),
      type: b.type || '', start: Number(b.start), work: Math.max(1, Number(b.end) - Number(b.start)), rest: 0,
      protected: Boolean(b.protected), locked: Boolean(b.locked), status: b.status || 'pending',
    }));
    locks = new Set((payload.timelineBlocks || []).filter((b) => b.locked).map((b) => String(b.id)));
    baseline = (payload.baseline || []).map((b) => ({ start: Number(b.start), dur: Math.max(1, Number(b.end) - Number(b.start)), cat: categoryId(b.cat || b.categoryId || b.category) }));
    focusSessions = (payload.focusSessions || []).map((s) => ({ start: Number(s.start), end: Number(s.end), title: s.title || '专注', note: s.note || '' }));
    inbox = (payload.inboxItems || []).map((it) => ({
      id: String(it.id), title: it.title || '待安排事项', kind: it.kind || (it.estimatedMinutes ? 'task' : 'note'),
      minutes: Number(it.minutes ?? it.estimatedMinutes) || null, priority: Number(it.priority || 2),
      cat: categoryId(it.cat || it.categoryId), done: Boolean(it.done || it.status === 'archived'), source: it.source || 'user',
      scheduled: it.status === 'scheduled',
    }));

    const targetDate = payload.targetDate ? new Date(`${payload.targetDate}T12:00:00`) : null;
    const dateSpan = document.querySelector('#dateBtn span');
    if (dateSpan && targetDate && !Number.isNaN(targetDate.valueOf())) {
      dateSpan.textContent = `${targetDate.getMonth()+1}月${targetDate.getDate()}日 · 周${'日一二三四五六'[targetDate.getDay()]}⌄`;
    }
    if (saveState) saveState.textContent = payload.saveLabel || (payload.hasUnsavedChanges ? '未保存' : '已保存');

    const cur = payload.currentBlock;
    const next = payload.nextBlock;
    const currentTitle = document.getElementById('currentTitle');
    const currentMeta = document.getElementById('currentMeta');
    if (currentTitle) currentTitle.textContent = cur?.title || '当前没有进行中的任务';
    if (currentMeta) {
      currentMeta.innerHTML = cur ? `<span>${fmt(cur.start)}–${fmt(cur.end)}</span><span>·</span><span class="rhythm">${esc(cur.rhythm || '')}</span>${cur.priority ? `<span>· P${Number(cur.priority)}</span>` : ''}` : '<span>查看时间线安排下一项</span>';
    }
    const nextTitle = document.getElementById('nextTitle');
    const nextTime = document.getElementById('nextTime');
    if (nextTitle) nextTitle.textContent = next?.title || '今天没有下一项';
    if (nextTime) nextTime.textContent = next ? fmt(next.start) : '';

    const overview = document.getElementById('overviewBtn');
    if (overview) overview.innerHTML = `<strong>已完成 ${esc(payload.completedLabel || '0min')}</strong> · 还剩 ${Number(payload.remainingCount || 0)} 项`;
    const inboxBtn = document.getElementById('inboxBtn');
    if (inboxBtn) inboxBtn.textContent = `🐾 一起记 · ${inbox.length}`;

    applyGoals(payload.goals || [], payload.goalTotal || {});
    liveFollowup = payload.followup || null;
    applyFollowup(liveFollowup);
    renderTicks();
    renderAll();
    requestAnimationFrame(() => initialScroll());
    ready = true;
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== sameOrigin || event.source !== window.parent) return;
    if (event.data?.type === 'snowdust:today-v14-state') applyState(event.data.payload);
  });

  document.addEventListener('click', (event) => {
    const target = event.target.closest('button,[role="button"]');
    if (!target) return;
    const stop = () => { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); };
    if (dragDidMove) { dragDidMove = false; stop(); return; }

    if (target.id === 'moreBtn') { stop(); send('more'); return; }
    if (target.id === 'focusBtn' || target.id === 'focusNav') { stop(); send('focus'); return; }
    if (target.id === 'chatNav') { stop(); send('chat'); return; }
    if (target.id === 'overviewBtn' || target.matches('[data-live-goal]')) { stop(); send('overview', { categoryId: target.dataset.liveGoal || '' }); return; }
    if (target.id === 'inboxBtn' || target.id === 'landscapeInboxBtn') { stop(); openInbox(); return; }
    const landscapeInbox = target.closest('[data-landscape-inbox]');
    if (landscapeInbox) { stop(); send('editInbox', { id: landscapeInbox.dataset.landscapeInbox || '' }); return; }
    if (target.id === 'trackerBtn') { stop(); send('trackers'); return; }
    if (target.id === 'quickTemplateBtn') { stop(); send('templates'); return; }
    if (target.id === 'dateBtn') { stop(); send('date'); return; }
    if (target.id === 'newTaskBtn') { stop(); send('createTask'); return; }
    if (target.id === 'categoryOrderBtn') { stop(); send('categoryOrder'); return; }

    const inboxCreate = target.closest('[data-live-inbox-create]');
    if (inboxCreate) { stop(); closeSheet(); send('createInbox'); return; }
    const inboxEdit = target.closest('[data-live-inbox-edit]');
    if (inboxEdit) { stop(); closeSheet(); send('editInbox', { id: inboxEdit.dataset.liveInboxEdit }); return; }
    const inboxToggle = target.closest('[data-live-inbox-toggle]');
    if (inboxToggle) { stop(); send('toggleInbox', { id: inboxToggle.dataset.liveInboxToggle }); return; }
    const inboxSchedule = target.closest('[data-live-inbox-schedule]');
    if (inboxSchedule) { stop(); closeSheet(); send('scheduleInbox', { id: inboxSchedule.dataset.liveInboxSchedule }); return; }

    const restore = target.closest('[data-pool-restore]');
    if (restore) {
      stop();
      const pair = segById(restore.dataset.poolRestore);
      send('restoreToTimeline', { blockId: restore.dataset.poolRestore, start: pair?.s?.lastTimelineStart ?? null });
      return;
    }
    const quickReturn = target.closest('[data-quick-return]');
    if (quickReturn) { stop(); send('returnToPool', { blockId: quickReturn.dataset.quickReturn }); return; }
    const meal = target.closest('[data-meal-toggle]');
    if (meal) { stop(); send('toggleComplete', { blockId: meal.dataset.mealToggle }); return; }

    const poolCard = target.closest('[data-pool-group]');
    if (poolCard && !target.closest('[data-pool-restore]')) { stop(); send('editPoolTask', { blockId: poolCard.dataset.segId, groupId: poolCard.dataset.poolGroup }); return; }
    const block = target.closest('.block[data-block-id]');
    if (block && !target.closest('[data-drag-handle],[data-resize-handle]')) { stop(); send('editBlock', { blockId: block.dataset.blockId }); return; }

    const complete = target.closest('[data-toggle-complete]');
    if (complete) { stop(); closeSheet(); send('toggleComplete', { blockId: complete.dataset.toggleComplete }); return; }
    const lock = target.closest('[data-toggle-lock]');
    if (lock) { stop(); closeSheet(); send('toggleLock', { blockId: lock.dataset.toggleLock }); return; }
    const ret = target.closest('[data-return]');
    if (ret) { stop(); closeSheet(); send('returnToPool', { blockId: ret.dataset.return }); return; }
  }, true);

  finishDrag = function liveFinishDrag() {
    if (!drag) return;
    const d = drag, p = d.preview;
    d.sourceEl?.classList.remove('dragging');
    dragGhost.classList.remove('show');
    dropPreview.className = 'drop-preview';
    clearTargets();
    if (p) {
      send('drop', {
        source: d.origin,
        blockId: d.seg.id,
        start: Number(p.start),
        intent: p.type || p.result?.type || 'move',
        targetBlockId: p.target?.id || null,
      });
    }
    drag = null;
  };

  returnToPool = function liveReturnToPool(id) { send('returnToPool', { blockId: String(id) }); };
  quickRestoreToTimeline = function liveQuickRestore(id) {
    const pair = segById(id);
    send('restoreToTimeline', { blockId: String(id), start: pair?.s?.lastTimelineStart ?? null });
  };

  document.addEventListener('pointerup', (event) => {
    if (!resize) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const r = resize;
    const pair = segById(r.id);
    const workMinutes = Number.isFinite(r.pendingWork) ? r.pendingWork : pair?.s?.work;
    r.el?.classList.remove('dragging','conflict-target');
    resize = null;
    if (Number.isFinite(workMinutes)) send('resize', { blockId: String(r.id), workMinutes: Number(workMinutes) });
  }, true);

  openInbox = () => {
    const todayItems = inbox.filter((it) => !it.scheduled);
    const rows = todayItems.map((it) => {
      const isNote = it.kind === 'note';
      const state = it.done ? '已完成' : isNote ? '记事' : '待办';
      const action = isNote ? `<span class="pill">记事</span>` : `<button class="pill" data-live-inbox-toggle="${esc(it.id)}">${it.done ? '恢复' : '完成'}</button>`;
      const schedule = !isNote && !it.done ? `<button class="sheet-btn" style="width:100%;margin:3px 0 5px" data-live-inbox-schedule="${esc(it.id)}">放进今日任务池</button>` : '';
      return `<div class="inbox-item ${it.done ? 'done' : ''}"><div class="sheet-row"><span><b>${esc(it.title)}</b><span>${state}${it.minutes ? ` · ${it.minutes}min` : ''}${it.source === 'snowdust' ? ' · 雪尘记的' : ''}</span></span><span style="display:flex;gap:5px;align-items:center">${action}<button class="pill" data-live-inbox-edit="${esc(it.id)}">编辑</button></span></div>${schedule}</div>`;
    }).join('');
    const follow = liveFollowup ? `<div class="sheet-label">雪尘等会儿会问</div><div class="followup"><b>${esc(liveFollowup.title || '')}</b><span>${esc(liveFollowup.modeLabel || '跟随日程')} · ${esc(liveFollowup.whenLabel || '')} · 可修改 / 取消</span></div>` : '';
    openSheet(sheetHead('🐾 今天一起记','你和雪尘共用的小本本；需要时间时再变成任务') +
      `<button class="sheet-btn primary" style="width:100%;margin-top:7px" data-live-inbox-create>＋ 新增记事 / 待办</button><div class="sheet-label">今天</div>${rows || '<div class="followup"><span>今天还没有一起记的内容</span></div>'}${follow}`);
  };

  send('ready');
})();
