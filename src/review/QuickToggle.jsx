export default function QuickToggle({
  label,
  checked,
  onChange,
  disabled = false,
  onValue = "是",
  offValue = "否",
}) {
  return (
    <label className="review-quick-toggle">
      <span>{label}</span>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={checked ? "is-on" : ""}
        onClick={() =>
          onChange(checked ? offValue : onValue)
        }
      >
        <i />
      </button>
    </label>
  );
}
