export default function ReviewField({ field, state, onChange, onRestore, disabled = false }) {
  const value = state?.value ?? "";
  const common = { value, disabled, onChange: (event) => onChange(field.id, event.target.value) };
  return <label className="review-field"><span>{field.label}</span>{field.kind === "select" ? <select {...common}><option value="">未填写</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select> : field.kind === "text" ? <textarea rows={2} {...common} /> : <input type={field.kind === "time" ? "time" : "number"} min={field.kind === "score" ? 0 : 0} max={field.kind === "score" ? 10 : undefined} {...common} />}{state?.source !== "default" && <small>{state.source === "manual" ? "手动修改" : "自动来源"}</small>}{state?.manuallyEdited && <button className="review-restore" disabled={disabled} type="button" onClick={() => onRestore(field.id)}>恢复自动值</button>}</label>;
}
