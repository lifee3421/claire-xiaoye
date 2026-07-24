import { useState } from "react";
import { DEFAULT_QUICK_DURATION_FIELDS, validateQuickDurationConfig } from "./reviewQuickFieldConfig.js";

// Inline (not floating) checkbox + up/down-reorder editor for which duration
// fields a card shows directly on the main page. Renders as normal document
// flow right below the card header, pushing the rest of the card down — no
// position:absolute/fixed, no backdrop, nothing that can drift off-anchor.
export default function QuickFieldSettings({
  sectionId,
  title,
  availableFields,
  value,
  onChange,
  onClose,
  disabled = false,
}) {
  const availableIds = availableFields.map((field) => field.id);
  const [order, setOrder] = useState(() =>
    validateQuickDurationConfig(value, availableIds)
  );
  const [checked, setChecked] = useState(
    () => new Set(validateQuickDurationConfig(value, availableIds))
  );

  const orderedFields = [
    ...order
      .map((id) => availableFields.find((field) => field.id === id))
      .filter(Boolean),
    ...availableFields.filter((field) => !order.includes(field.id)),
  ];

  const toggle = (id) => {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setOrder((current) =>
      current.includes(id) ? current : [...current, id]
    );
  };

  const move = (id, direction) => {
    setOrder((current) => {
      const list = orderedFields.map((field) => field.id).filter((fieldId) => current.includes(fieldId) || fieldId === id);
      const index = list.indexOf(id);
      const nextIndex = index + direction;
      if (index === -1 || nextIndex < 0 || nextIndex >= list.length) return current;
      const next = [...list];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const restoreDefaults = () => {
    const defaults = validateQuickDurationConfig(
      DEFAULT_QUICK_DURATION_FIELDS[sectionId] || availableIds,
      availableIds
    );
    setOrder(defaults);
    setChecked(new Set(defaults));
  };

  const save = () => {
    const finalOrder = orderedFields
      .map((field) => field.id)
      .filter((id) => checked.has(id));
    onChange(finalOrder);
    onClose();
  };

  return (
    <div className="review-inline-settings" role="group" aria-label={`${title} 快捷项设置`}>
      <header>
        <strong>快捷项设置</strong>
        <span>选择在主页面直接显示的项目</span>
      </header>

      <ul>
        {orderedFields.map((field, index) => (
          <li key={field.id}>
            <label>
              <input
                type="checkbox"
                checked={checked.has(field.id)}
                disabled={disabled}
                onChange={() => toggle(field.id)}
              />
              {field.label}
            </label>

            <div className="review-quick-field-settings__move">
              <button
                type="button"
                disabled={disabled || index === 0}
                aria-label={`上移${field.label}`}
                onClick={() => move(field.id, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={disabled || index === orderedFields.length - 1}
                aria-label={`下移${field.label}`}
                onClick={() => move(field.id, 1)}
              >
                ↓
              </button>
            </div>
          </li>
        ))}
      </ul>

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
