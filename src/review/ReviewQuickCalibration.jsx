import {
  STUDY_SUMMARY_CONFIG,
  effectiveValue,
  getStudyCompletion,
  numericValue,
} from "./reviewSectionConfig.js";

// No drawer, no onEdit callback — clicking a chip just scrolls the matching
// card into view. The ids referenced here are set on the card containers in
// ReviewSummaryDashboard.jsx (review-card-sleep / review-card-diary /
// review-card-study-english / review-card-entertainment).
function focusCard(anchorId) {
  const element = document.getElementById(anchorId);
  if (!element) return;
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  element.classList.add("is-focused-flash");
  window.setTimeout(() => element.classList.remove("is-focused-flash"), 900);

  // For the diary anchor specifically, jump straight into the body textarea.
  const focusTarget =
    anchorId === "daily-review-diary"
      ? element.querySelector("textarea")
      : element.querySelector("input, textarea, select");
  window.setTimeout(() => focusTarget?.focus(), 350);
}

export default function ReviewQuickCalibration({ draft }) {
  const sleepMissing =
    !effectiveValue(draft, "sleep.yesterday.bedtime") ||
    !effectiveValue(draft, "sleep.yesterday.durationText");

  const diaryMissing =
    !String(
      effectiveValue(draft, "diary.content") || ""
    ).trim();

  const englishConfig = STUDY_SUMMARY_CONFIG.find(
    (item) => item.id === "english"
  );

  const englishCompletion = getStudyCompletion(
    englishConfig,
    draft
  );

  const entertainmentMinutes = numericValue(
    draft,
    "entertainment.today.totalMinutes"
  );

  const items = [
    {
      id: "sleep",
      label: sleepMissing ? "睡眠未填写" : "睡眠已记录",
      tone: sleepMissing ? "warning" : "success",
      anchorId: "review-card-sleep",
    },

    {
      id: "diary",
      label: diaryMissing ? "日记未写" : "日记已记录",
      tone: diaryMissing ? "warning" : "success",
      anchorId: "daily-review-diary",
    },

    {
      id: "english",
      label:
        englishCompletion.level === "complete"
          ? "英语记录完整"
          : "英语仍有待补内容",
      tone:
        englishCompletion.level === "complete"
          ? "success"
          : "notice",
      anchorId: "review-card-study-english",
    },

    {
      id: "entertainment",
      label:
        entertainmentMinutes > 0
          ? `娱乐已记录 ${entertainmentMinutes}min`
          : "娱乐尚未记录",
      tone:
        entertainmentMinutes > 90
          ? "danger"
          : entertainmentMinutes > 0
            ? "success"
            : "neutral",
      anchorId: "review-card-entertainment",
    },
  ];

  return (
    <section className="review-quick-calibration">
      <strong>今日概览 · 快速校准</strong>

      <div>
        {items.map((item) => (
          <button
            key={item.id}
            className={`review-calibration-chip review-calibration-chip--${item.tone}`}
            type="button"
            onClick={() => focusCard(item.anchorId)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </section>
  );
}
