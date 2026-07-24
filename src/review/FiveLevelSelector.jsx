import { LEVEL_TO_SCORE, scoreToLevel } from "./scoreLevel.js";

export { LEVEL_TO_SCORE, scoreToLevel };

export default function FiveLevelSelector({
  label,
  value,
  onChange,
  icon = "★",
  disabled = false,
  descriptions = [],
}) {
  const selectedLevel = scoreToLevel(value);

  return (
    <div className="review-five-level">
      {label && <span>{label}</span>}

      <div
        className="review-five-level__options"
        role="radiogroup"
        aria-label={label}
      >
        {[1, 2, 3, 4, 5].map((level) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={selectedLevel === level}
            disabled={disabled}
            title={descriptions[level - 1] || `${level}级`}
            className={
              level <= selectedLevel ? "is-active" : ""
            }
            onClick={() =>
              onChange(
                selectedLevel === level
                  ? ""
                  : LEVEL_TO_SCORE[level]
              )
            }
          >
            {icon}
          </button>
        ))}
      </div>
    </div>
  );
}
