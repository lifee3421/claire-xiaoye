(() => {
  const CONTEXT_PATH = "/api/planner-ui-context";
  let rawContext = null;

  function hasOwn(value, key) {
    return Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key));
  }

  function rawId(item = {}) {
    return String(item.id || item.blockId || item.segmentId || "");
  }

  function rawRows() {
    return [...(rawContext?.timelineBlocks || []), ...(rawContext?.taskPool || [])];
  }

  function rawFor(blockId) {
    const id = String(blockId || "");
    return rawRows().find((item) => rawId(item) === id) || null;
  }

  function explicitOverride(item, blockId) {
    const group = item?.taskGroup;
    const overrides = group?.segmentOverrides;
    return overrides && typeof overrides === "object" ? (overrides[String(blockId)] || {}) : {};
  }

  function reminderOverride(item, blockId) {
    const override = explicitOverride(item, blockId);
    return hasOwn(override, "snowdustReminder") ? override.snowdustReminder : null;
  }

  function verificationOverride(item, blockId) {
    const override = explicitOverride(item, blockId);
    if (hasOwn(override, "startVerification")) return override.startVerification;
    if (hasOwn(override, "deskVerification")) return override.deskVerification;
    return null;
  }

  function controls() {
    const details = sheetContent?.querySelector("details.detail-box");
    if (!details) return null;
    const selects = [...details.querySelectorAll("select.field")];
    const number = details.querySelector('input.field[type="number"]');
    if (selects.length < 3 || !number) return null;
    return {
      reminderMode: selects[0],
      advance: number,
      verificationMode: selects[1],
      verificationMethod: selects[2],
    };
  }

  function optionIndexForReminder(value) {
    if (value?.mode === "on") return 1;
    if (value?.mode === "off") return 2;
    return 0;
  }

  function optionIndexForVerification(value) {
    if (value?.mode === "off") return 1;
    if (value?.mode === "on") return 2;
    return 0;
  }

  function methodIndex(value) {
    if (value?.method === "photo") return 1;
    if (value?.method === "text") return 2;
    return 0;
  }

  function hydrate(blockId) {
    const ui = controls();
    if (!ui) return;
    const raw = rawFor(blockId);
    const reminder = reminderOverride(raw, blockId);
    const verification = verificationOverride(raw, blockId);
    ui.reminderMode.selectedIndex = optionIndexForReminder(reminder);
    ui.advance.value = String(Math.max(0, Number(reminder?.advanceMinutes ?? 5) || 0));
    ui.verificationMode.selectedIndex = optionIndexForVerification(verification);
    ui.verificationMethod.selectedIndex = methodIndex(verification);
  }

  function readSettings() {
    const ui = controls();
    if (!ui) return null;
    const reminderIndex = ui.reminderMode.selectedIndex;
    const verificationIndex = ui.verificationMode.selectedIndex;
    const method = ["smart", "photo", "text"][ui.verificationMethod.selectedIndex] || "smart";
    const advanceMinutes = Math.max(0, Number(ui.advance.value || 0) || 0);
    return {
      reminder: reminderIndex === 0 ? null : reminderIndex === 1 ? { mode: "on", advanceMinutes } : { mode: "off" },
      verification: verificationIndex === 0 ? null : verificationIndex === 1 ? { mode: "off" } : { mode: "on", method },
    };
  }

  function stable(value) {
    return JSON.stringify(value ?? null);
  }

  function editFor(blockId, desired) {
    const raw = rawFor(blockId);
    const currentReminder = reminderOverride(raw, blockId);
    const currentVerification = verificationOverride(raw, blockId);
    const change = { type: "edit_task", blockId: String(blockId) };
    const clear = [];
    let changed = false;

    if (desired.reminder === null) {
      if (currentReminder !== null) {
        clear.push("snowdustReminder");
        changed = true;
      }
    } else if (stable(currentReminder) !== stable(desired.reminder)) {
      change.snowdustReminder = desired.reminder;
      changed = true;
    }

    if (desired.verification === null) {
      if (currentVerification !== null) {
        clear.push("startVerification", "deskVerification");
        changed = true;
      }
    } else if (stable(currentVerification) !== stable(desired.verification)) {
      change.startVerification = desired.verification;
      clear.push("deskVerification");
      changed = true;
    }

    if (clear.length) change.clearOverrideFields = [...new Set(clear)];
    return changed ? change : null;
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
        console.warn("Today reminder context capture failed", error);
      }
    }
    return response;
  };

  const originalBlockSheet = blockSheet;
  blockSheet = function liveReminderBlockSheet(id) {
    originalBlockSheet(id);
    const pair = segById(id);
    if (!pair) return;
    hydrate(id);
  };

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-save-edit]");
    if (!button) return;
    const blockId = String(button.dataset.saveEdit || "");
    const pair = segById(blockId);
    const desired = readSettings();
    if (!pair || !desired) return;
    const scope = sheetContent.querySelector("[data-scope].active")?.dataset.scope || "segment";
    const ids = scope === "group"
      ? pair.g.segments.filter((segment) => segment.status !== "completed").map((segment) => String(segment.id))
      : [blockId];
    const changes = ids.map((id) => editFor(id, desired)).filter(Boolean);
    if (!changes.length) return;

    // Let v14's original save handler run first so title/rhythm/priority/time
    // changes are serialized ahead of this reminder-only patch. The shared
    // standalone write queue refreshes baseRevision between the two writes.
    setTimeout(() => {
      window.__SNOWDUST_TODAY_MUTATE__?.({
        changes,
        label: scope === "group" ? "保存任务组提醒设置" : "保存提醒设置",
      }).catch(() => {});
    }, 0);
  }, true);
})();