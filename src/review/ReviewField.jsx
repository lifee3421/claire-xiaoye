import { useEffect, useRef } from "react";

const SINGLE_LINE_TEXT_IDS = new Set([
  "study.reading.bookTitle",
  "sleep.yesterday.durationText",
  "exercise.today.activity",
  "diary.title",
  "diary.tags",
]);

function isSingleLineText(field) {
  if (field.kind !== "text") return false;

  return (
    SINGLE_LINE_TEXT_IDS.has(field.id) ||
    field.id.endsWith(".title") ||
    field.id.endsWith(".tags")
  );
}

function AutoGrowingTextarea({
  value,
  onChange,
  disabled,
  rows = 1,
  className,
  placeholder,
}) {
  const ref = useRef(null);

  const resize = () => {
    const element = ref.current;

    if (!element) return;

    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  };

  useEffect(() => {
    resize();
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={rows}
      value={value}
      disabled={disabled}
      className={className}
      placeholder={placeholder}
      onInput={resize}
      onChange={onChange}
    />
  );
}

export default function ReviewField({
  field,
  state,
  onChange,
  onRestore,
  disabled = false,
  dense = false,
}) {
  const value = state?.value ?? "";

  const handleChange = (event) => {
    onChange(field.id, event.target.value);
  };

  const manuallyEdited = Boolean(state?.manuallyEdited);
  const sourceLabel = manuallyEdited
    ? "手动覆盖"
    : state?.source && state.source !== "default"
      ? "自动值"
      : "";

  const compact =
    dense ||
    ["duration", "score", "time", "select"].includes(field.kind) ||
    isSingleLineText(field);

  const multiline = field.kind === "text" && !isSingleLineText(field);

  return (
    <label
      className={[
        "review-field",
        compact ? "review-field--compact" : "",
        multiline ? "review-field--multiline" : "",
        field.id === "diary.content" ? "review-field--diary-content" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="review-field__label">{field.label}</span>

      {field.kind === "select" ? (
        <select value={value} disabled={disabled} onChange={handleChange}>
          <option value="">未填写</option>

          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : field.kind === "time" ? (
        <input
          type="time"
          value={value}
          disabled={disabled}
          onChange={handleChange}
        />
      ) : field.kind === "duration" || field.kind === "score" ? (
        <input
          type="number"
          min={0}
          max={field.kind === "score" ? 10 : undefined}
          inputMode="numeric"
          value={value}
          disabled={disabled}
          onChange={handleChange}
        />
      ) : isSingleLineText(field) ? (
        <input
          type="text"
          value={value}
          disabled={disabled}
          onChange={handleChange}
        />
      ) : (
        <AutoGrowingTextarea
          value={value}
          disabled={disabled}
          rows={field.id === "diary.content" ? 5 : 1}
          onChange={handleChange}
        />
      )}

      {(sourceLabel || manuallyEdited) && (
        <div className="review-field__meta">
          {sourceLabel && <small>{sourceLabel}</small>}

          {manuallyEdited && (
            <button
              className="review-restore"
              disabled={disabled}
              type="button"
              onClick={() => onRestore(field.id)}
            >
              恢复自动值
            </button>
          )}
        </div>
      )}
    </label>
  );
}
