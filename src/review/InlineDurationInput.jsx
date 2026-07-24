import { useEffect, useState } from "react";
import { parseDurationText, formatDurationInput } from "./durationText.js";

export { parseDurationText, formatDurationInput };

// Deliberately does NOT commit on every keystroke and does NOT reformat the
// text while the user is typing — an earlier version called onCommit from
// onChange, which fed the freshly-committed value back through the `value`
// prop and re-triggered the format-on-value-change effect mid-keystroke,
// silently rewriting "1" into "1min" while the user was still typing
// "1h20min". Now: local `text` state only follows the `value` prop while
// NOT focused; committing (parse + onCommit) only happens on blur or Enter.
export default function InlineDurationInput({
  value,
  onCommit,
  disabled = false,
  label,
  compact = false,
}) {
  const [text, setText] = useState(() =>
    value === "" || value === null || value === undefined ? "" : formatDurationInput(value)
  );
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (focused) return;
    setText(value === "" || value === null || value === undefined ? "" : formatDurationInput(value));
    setInvalid(false);
  }, [value, focused]);

  const commit = () => {
    const parsed = parseDurationText(text);

    if (parsed === null) {
      setInvalid(true);
      return;
    }

    setInvalid(false);
    onCommit(parsed);
    // Deliberately does not rewrite `text` here — the user's own "1h20min"
    // stays on screen instead of being replaced by a reformatted version.
  };

  return (
    <label
      className={[
        "review-inline-duration",
        compact ? "review-inline-duration--compact" : "",
        invalid ? "is-invalid" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {label && <span>{label}</span>}

      <input
        type="text"
        inputMode="text"
        value={text}
        disabled={disabled}
        placeholder="如 1h20min"
        onFocus={() => setFocused(true)}
        onChange={(event) => {
          setText(event.target.value);
          setInvalid(false);
        }}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          }
        }}
      />

      {invalid && (
        <small>请输入 1h20min、45min 或 80</small>
      )}
    </label>
  );
}
