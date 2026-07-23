import {
  STUDY_SUMMARY_CONFIG,
  effectiveValue,
  getStudyCompletion,
  numericValue,
} from "./reviewSectionConfig.js";

export default function ReviewQuickCalibration({
  draft,
  onEdit,
}) {
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
      label: sleepMissing
        ? "睡眠未填写"
        : "睡眠已记录",
      tone: sleepMissing ? "warning" : "success",
      editor: {
        kind: "other",
        id: "sleep",
        title: "睡眠与作息",
        sourceTitle: "睡眠",
      },
    },

    {
      id: "diary",
      label: diaryMissing ? "日记未写" : "日记已记录",
      tone: diaryMissing ? "warning" : "success",
      editor: {
        kind: "other",
        id: "diary",
        title: "日记",
        sourceTitle: "日记",
      },
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
      editor: {
        kind: "study",
        id: "english",
        title: "英语",
      },
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
      editor: {
        kind: "category",
        id: "entertainment",
        title: "娱乐",
        sourceTitle: "娱乐",
      },
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
            onClick={() => onEdit(item.editor)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </section>
  );
}
