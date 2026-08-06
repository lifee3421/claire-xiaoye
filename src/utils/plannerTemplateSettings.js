// Pure helpers backing the "persisted settings vs. display fallback" split
// for day-plan templates (see App.jsx's mergeScheduleSettings/
// normalizePlannerTemplates). Kept here, dependency-free of App.jsx's
// factory-template machinery, so the core rule is directly unit-testable:
// loading/normalizing a saved profile must never itself inject content or
// repair references that the user didn't actually save.

/**
 * Shape-migrates a saved template list (legacy shape -> {content} shape,
 * deleted-key filter) WITHOUT injecting any factory/built-in templates that
 * aren't actually present. Safe to feed straight into persisted settings —
 * unlike a factory-injecting normalizer, this never manufactures content a
 * user hasn't saved.
 *
 * `deps.normalizeTemplateContent` and `deps.createTemplateFromLegacy` are
 * injected so this module stays free of App.jsx's broader template/taxonomy
 * dependencies.
 */
export function coercePlannerTemplateShape(templates = [], deletedSystemKeys = [], deps = {}) {
  const { normalizeTemplateContent = (content) => content, createTemplateFromLegacy = (template) => template } = deps;
  const deleted = new Set(deletedSystemKeys);
  return (Array.isArray(templates) ? templates : [])
    .map((template) => {
      if (!template || typeof template !== "object") return null;
      // Treat any non-null object as the new {content: {...}} shape. `null` and
      // missing are both legacy indicators — but a new-shape template with
      // content:null must NOT fall through to createTemplateFromLegacy, which
      // would nest the original content field inside a reconstructed content
      // object and permanently corrupt user data. Treat null as an empty
      // content object so the template is preserved with an empty (recoverable)
      // content rather than destroyed.
      if (typeof template.content === "object") {
        return { ...template, content: normalizeTemplateContent(template.content || {}), revision: Number(template.revision || 1) };
      }
      return createTemplateFromLegacy(template);
    })
    .filter((template) => template && (!template.systemKey || !deleted.has(template.systemKey)));
}

/**
 * The persisted defaultDayTemplateId is whatever was actually saved — never
 * silently repointed to the first available template just because the saved
 * id doesn't currently resolve to anything. Any "this id is invalid, fall
 * back to X" behavior belongs at display time only.
 */
export function resolvePersistedDefaultDayTemplateId(savedDefaultId) {
  return savedDefaultId || "";
}

/**
 * Structural equality for planner settings/draft objects. Used to decide
 * whether a freshly-recomputed value actually differs from what's already in
 * state, vs. being merely a new object reference for identical content —
 * the gate that stops a plain page load from spuriously re-triggering the
 * settings/draft-keyed autosave effect.
 */
export function plannerValuesDeepEqual(a, b) {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
