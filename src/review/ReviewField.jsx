// Fields whose `kind` is "text" but whose content is short (a title, a tag
// list, a short duration label) render as a single-line input instead of a
// textarea. Everything else with kind "text" (progress notes, adjustments,
// feelings, diary content, etc.) is long-form and gets a textarea. This is a
// rendering-layer heuristic only — it does not change `field.kind` in
// dailyReviewSchema.js, so no schema/data-shape change is involved.
const SHORT_TEXT_FIELD_IDS = new Set([
  "study.reading.bookTitle",
  "sleep.yesterday.durationText",
  "exercise.today.activity",
  "diary.title",
  "diary.tags",
]);

// Long-form fields that benefit from extra height (diary body, Snow Dust's note).
const TALL_TEXT_FIELD_IDS = new Set(["diary.content", "snowDust.note"]);

const COMPACT_KINDS = new Set(["duration", "score", "time"]);

export default function ReviewField({ field, state, onChange, onRestore, disabled = false }) {
  const value = state?.value ?? "";
  const common = { value, disabled, onChange: (event) => onChange(field.id, event.target.value) };
  const isShortText = field.kind === "text" && SHORT_TEXT_FIELD_IDS.has(field.id);
  const isLongText = field.kind === "text" && !isShortText;
  const compact = COMPACT_KINDS.has(field.kind) || field.kind === "select" || isShortText;

  let control;
  if (field.kind === "select") {
    control = (
      <select {...common}>
        <option value="">未填写</option>
        {field.options.map((option) => <option key={option}>{option}</option>)}
      </select>
    );
  } else if (isLongText) {
    control = <textarea rows={TALL_TEXT_FIELD_IDS.has(field.id) ? 5 : 2} {...common} />;
  } else if (isShortText) {
    control = <input type="text" {...common} />;
  } else {
    control = (
      <input
        type={field.kind === "time" ? "time" : "number"}
        min={field.kind === "score" ? 0 : 0}
        max={field.kind === "score" ? 10 : undefined}
        {...common}
      />
    );
  }

  return (
    <label className={`review-field${compact ? " review-field--compact" : " review-field--long"}`}>
      <span>{field.label}</span>
      {control}
      {state?.source !== "default" && <small>{state.source === "manual" ? "手动修改" : "自动来源"}</small>}
      {state?.manuallyEdited && (
        <button className="review-restore" disabled={disabled} type="button" onClick={() => onRestore(field.id)}>
          恢复自动值
        </button>
      )}
    </label>
  );
}
