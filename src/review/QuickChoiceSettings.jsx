import { useState } from "react";
import { validateQuickChoiceOptions } from "./reviewQuickChoices.js";

// Inline (not floating) option-list editor for the mood/body quick-choice
// tags — add, remove, reorder, restore defaults. Renders as normal document
// flow inside the card, pushing the rest of the card down, same pattern as
// QuickFieldSettings.
export default function QuickChoiceSettings({
  title,
  options,
  defaults,
  onChange,
  onClose,
  disabled = false,
}) {
  const [draftOptions, setDraftOptions] = useState(() => validateQuickChoiceOptions(options));
  const [newOption, setNewOption] = useState("");

  const move = (index, direction) => {
    setDraftOptions((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const remove = (index) => {
    setDraftOptions((current) => current.filter((_, i) => i !== index));
  };

  const add = () => {
    const trimmed = newOption.trim();
    if (!trimmed || draftOptions.includes(trimmed)) return;
    setDraftOptions((current) => [...current, trimmed]);
    setNewOption("");
  };

  const restoreDefaults = () => {
    setDraftOptions(validateQuickChoiceOptions(defaults));
  };

  const save = () => {
    onChange(validateQuickChoiceOptions(draftOptions));
    onClose();
  };

  return (
    <div className="review-inline-settings" role="group" aria-label={`${title} 标签管理`}>
      <header>
        <strong>管理标签</strong>
      </header>

      <ul className="review-quick-choice-settings__list">
        {draftOptions.map((option, index) => (
          <li key={`${option}-${index}`}>
            <span>{option}</span>

            <div className="review-quick-field-settings__move">
              <button
                type="button"
                disabled={disabled || index === 0}
                aria-label={`上移${option}`}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={disabled || index === draftOptions.length - 1}
                aria-label={`下移${option}`}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                disabled={disabled}
                aria-label={`删除${option}`}
                onClick={() => remove(index)}
              >
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="review-quick-choice-settings__add">
        <input
          type="text"
          placeholder="新增标签"
          value={newOption}
          disabled={disabled}
          onChange={(event) => setNewOption(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <button type="button" disabled={disabled} onClick={add}>
          添加
        </button>
      </div>

      <footer>
        <button type="button" disabled={disabled} onClick={restoreDefaults}>
          恢复默认
        </button>
        <button className="primary-button" type="button" disabled={disabled} onClick={save}>
          完成
        </button>
      </footer>
    </div>
  );
}
