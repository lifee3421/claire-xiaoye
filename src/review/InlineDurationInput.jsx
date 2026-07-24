import { useEffect, useState } from "react";
import { parseDurationText, formatDurationInput } from "./durationText.js";

export { parseDurationText, formatDurationInput };

export default function InlineDurationInput({
  value,
  onCommit,
  disabled = false,
  label,
  compact = false,
}) {
  const [text, setText] = useState(
    formatDurationInput(value)
  );
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(formatDurationInput(value));
    setInvalid(false);
  }, [value]);

  const commit = () => {
    const parsed = parseDurationText(text);

    if (parsed === null) {
      setInvalid(true);
      return;
    }

    setInvalid(false);
    onCommit(parsed);
    setText(formatDurationInput(parsed));
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
        placeholder="1h20min"
        onChange={(event) => {
          const nextText = event.target.value;
          setText(nextText);

          const parsed = parseDurationText(nextText);

          if (parsed !== null) {
            setInvalid(false);
            onCommit(parsed);
          }
        }}
        onBlur={commit}
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
