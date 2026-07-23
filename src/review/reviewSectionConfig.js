export const STUDY_SUMMARY_CONFIG = [
  {
    id: "math",
    title: "数学",
    icon: "📐",
    totalId: "study.math.totalMinutes",
    durationFields: [
      {
        id: "study.math.calculus.duration",
        label: "高等数学",
      },
      {
        id: "study.math.linearAlgebra.duration",
        label: "线性代数",
      },
    ],
    progressFields: [
      {
        id: "study.math.calculus.progress",
        label: "高等数学",
      },
      {
        id: "study.math.linearAlgebra.progress",
        label: "线性代数",
      },
    ],
    adjustmentId: "study.math.adjustment",
  },

  {
    id: "professional",
    title: "专业课",
    icon: "💰",
    totalId: "study.professional.totalMinutes",
    durationFields: [
      {
        id: "study.professional.corporateFinance.duration",
        label: "公司金融",
      },
      {
        id: "study.professional.investments.duration",
        label: "投资学",
      },
    ],
    progressFields: [
      {
        id: "study.professional.corporateFinance.progress",
        label: "公司金融",
      },
      {
        id: "study.professional.investments.progress",
        label: "投资学",
      },
    ],
    adjustmentId: "study.professional.adjustment",
  },

  {
    id: "english",
    title: "英语",
    icon: "Aa",
    totalId: "study.english.totalMinutes",
    durationFields: [
      {
        id: "study.english.vocabulary.duration",
        label: "单词",
      },
      {
        id: "study.english.ieltsWriting.duration",
        label: "雅思写作",
      },
      {
        id: "study.english.ieltsReading.duration",
        label: "雅思阅读",
      },
      {
        id: "study.english.ieltsListening.duration",
        label: "雅思听力",
      },
      {
        id: "study.english.ieltsSpeaking.duration",
        label: "雅思口语",
      },
    ],
    progressFields: [
      {
        id: "study.english.vocabulary.progress",
        label: "单词",
      },
      {
        id: "study.english.ieltsWriting.progress",
        label: "雅思写作",
      },
      {
        id: "study.english.ieltsReading.progress",
        label: "雅思阅读",
      },
      {
        id: "study.english.ieltsListening.progress",
        label: "雅思听力",
      },
      {
        id: "study.english.ieltsSpeaking.progress",
        label: "雅思口语",
      },
    ],
    adjustmentId: "study.english.adjustment",
  },

  {
    id: "japanese",
    title: "日语",
    icon: "あ",
    totalId: "study.japanese.totalMinutes",
    durationFields: [
      {
        id: "study.japanese.totalMinutes",
        label: "日语",
      },
    ],
    progressFields: [
      {
        id: "study.japanese.progress",
        label: "今日推进",
      },
    ],
    adjustmentId: "study.japanese.adjustment",
  },

  {
    id: "reading",
    title: "阅读",
    icon: "📖",
    totalId: "study.reading.totalMinutes",
    durationFields: [
      {
        id: "study.reading.totalMinutes",
        label: "阅读",
      },
    ],
    progressFields: [
      {
        id: "study.reading.bookTitle",
        label: "书籍",
      },
      {
        id: "study.reading.content",
        label: "阅读内容",
      },
      {
        id: "study.reading.feeling",
        label: "感受",
      },
    ],
    adjustmentId: "study.reading.adjustment",
  },
];

export const OTHER_EDITOR_CONFIG = {
  sleep: {
    title: "睡眠与作息",
    icon: "🌙",
    type: "other",
    sourceTitle: "睡眠",
  },

  state: {
    title: "状态与身体",
    icon: "💗",
    type: "other",
    sourceTitle: "状态",
  },

  exercise: {
    title: "运动",
    icon: "🏃",
    type: "other",
    sourceTitle: "运动",
  },

  selfcare: {
    title: "个护",
    icon: "🌿",
    type: "other",
    sourceTitle: "个护",
  },

  summary: {
    title: "评分与总结",
    icon: "📝",
    type: "other",
    sourceTitle: "评分与总结",
  },

  diary: {
    title: "日记",
    icon: "📖",
    type: "other",
    sourceTitle: "日记",
  },
};

export const CATEGORY_EDITOR_CONFIG = {
  project: {
    title: "项目",
    icon: "🛠",
    type: "category",
    sourceTitle: "项目",
  },

  work: {
    title: "工作",
    icon: "💼",
    type: "category",
    sourceTitle: "工作",
  },

  hobby: {
    title: "兴趣",
    icon: "🎨",
    type: "category",
    sourceTitle: "兴趣",
  },

  entertainment: {
    title: "娱乐",
    icon: "🎮",
    type: "category",
    sourceTitle: "娱乐",
  },

  family: {
    title: "家庭",
    icon: "🏠",
    type: "category",
    sourceTitle: "家庭",
  },

  misc: {
    title: "杂项",
    icon: "📋",
    type: "category",
    sourceTitle: "杂项",
  },
};

export function effectiveValue(draft, fieldId) {
  const state = draft?.fields?.[fieldId];

  if (!state) return "";

  if (
    state.value !== undefined &&
    state.value !== null &&
    state.value !== ""
  ) {
    return state.value;
  }

  return state.autoValue ?? "";
}

export function numericValue(draft, fieldId) {
  const value = Number(effectiveValue(draft, fieldId));
  return Number.isFinite(value) ? value : 0;
}

export function formatMinutes(rawMinutes) {
  const minutes = Math.max(0, Math.round(Number(rawMinutes) || 0));

  if (minutes === 0) return "0min";
  if (minutes < 60) return `${minutes}min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return rest ? `${hours}h ${rest}min` : `${hours}h`;
}

export function compactText(rawValue, maxLength = 64) {
  const value = String(rawValue || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!value) return "";

  return value.length > maxLength
    ? `${value.slice(0, maxLength)}…`
    : value;
}

export function buildStudyDurationSummary(config, draft) {
  const parts = config.durationFields
    .map((field) => {
      const minutes = numericValue(draft, field.id);

      if (!minutes) return null;

      return `${field.label} ${formatMinutes(minutes)}`;
    })
    .filter(Boolean);

  return parts.length ? parts.join(" · ") : "尚未记录分项";
}

export function buildStudyProgressSummary(config, draft) {
  const parts = config.progressFields
    .map((field) => {
      const text = compactText(effectiveValue(draft, field.id), 42);

      if (!text) return null;

      return `${field.label}：${text}`;
    })
    .filter(Boolean);

  return parts.length ? parts.join("；") : "尚未填写推进";
}

export function getStudyCompletion(config, draft) {
  const durationCount = config.durationFields.filter(
    (field) => numericValue(draft, field.id) > 0
  ).length;

  const progressCount = config.progressFields.filter(
    (field) =>
      String(effectiveValue(draft, field.id) || "").trim().length > 0
  ).length;

  const adjustmentFilled = Boolean(
    String(effectiveValue(draft, config.adjustmentId) || "").trim()
  );

  if (!durationCount && !progressCount) {
    return {
      level: "empty",
      label: "待填写",
    };
  }

  if (durationCount > 0 && progressCount === 0) {
    return {
      level: "warning",
      label: "待补推进",
    };
  }

  if (!adjustmentFilled) {
    return {
      level: "partial",
      label: "待补调整",
    };
  }

  return {
    level: "complete",
    label: "已完成",
  };
}

export function findCategorySection(sections, title) {
  return sections.find((section) => section.title === title) || null;
}

export function findOtherSection(otherSections, title) {
  return otherSections.find((section) => section.title === title) || null;
}

export function groupTotalMinutes(group, draft) {
  const totalField = group?.fields?.find(
    (field) =>
      field.kind === "duration" &&
      field.id.endsWith(".totalMinutes")
  );

  if (totalField) {
    return numericValue(draft, totalField.id);
  }

  return (group?.fields || [])
    .filter((field) => field.kind === "duration")
    .reduce(
      (sum, field) => sum + numericValue(draft, field.id),
      0
    );
}

export function summarizeGroup(group, draft) {
  if (!group) {
    return {
      total: 0,
      durationText: "0min",
      chips: [],
      narrative: "尚未填写",
    };
  }

  const durationFields = (group.fields || []).filter(
    (field) =>
      field.kind === "duration" &&
      !field.id.endsWith(".totalMinutes")
  );

  const chips = durationFields
    .map((field) => {
      const value = numericValue(draft, field.id);

      if (!value) return null;

      return {
        id: field.id,
        label: field.label,
        value: formatMinutes(value),
      };
    })
    .filter(Boolean)
    .slice(0, 4);

  const narrativeFields = (group.fields || []).filter(
    (field) =>
      field.kind === "text" &&
      (
        field.id.endsWith(".progress") ||
        field.id.endsWith(".feeling") ||
        field.id.endsWith(".oneLine")
      )
  );

  const narrative =
    narrativeFields
      .map((field) =>
        compactText(effectiveValue(draft, field.id), 60)
      )
      .find(Boolean) || "尚未填写";

  const total = groupTotalMinutes(group, draft);

  return {
    total,
    durationText: formatMinutes(total),
    chips,
    narrative,
  };
}
