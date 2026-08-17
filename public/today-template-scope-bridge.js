(() => {
  function checkedScopes(attribute) {
    const result = {};
    document.querySelectorAll(`[${attribute}]`).forEach((input) => {
      result[input.getAttribute(attribute)] = Boolean(input.checked);
    });
    return result;
  }

  document.addEventListener("click", (event) => {
    const apply = event.target.closest("[data-apply-template]");
    if (apply) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const templateId = String(apply.dataset.applyTemplate || "");
      const scopes = checkedScopes("data-apply-scope");
      if (!templateId) return;
      currentTemplateId = templateId;
      closeSheet();
      toastMsg("正在应用模板…");
      window.__SNOWDUST_TODAY_APPLY_TEMPLATE__?.({ templateId, scopes, label: "应用模板" }).catch(() => {});
      return;
    }

    const save = event.target.closest("[data-confirm-save-template]");
    if (!save) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const name = (document.getElementById("templateName")?.value || "").trim();
    if (!name) { toastMsg("先写模板名称"); return; }
    const updateId = String(save.dataset.confirmSaveTemplate || "");
    const scopes = checkedScopes("data-save-scope");
    closeSheet();
    toastMsg(updateId && updateId !== "new" ? "正在更新模板…" : "正在保存模板…");
    window.__SNOWDUST_TODAY_META__?.({
      action: "template_save",
      templateId: updateId && updateId !== "new" ? updateId : "",
      name,
      scopes,
      label: updateId && updateId !== "new" ? "更新模板" : "保存模板",
    }).catch(() => {});
  }, true);
})();