export const STUDY_LEAF_GROUPS = [
  {
    id: "math",
    title: "数学",
    icon: "📐",
    items: [
      {
        id: "calculus",
        title: "高等数学",
        durationId: "study.math.calculus.duration",
        progressId: "study.math.calculus.progress",
        adjustmentId: "study.math.calculus.adjustment",
      },
      {
        id: "linearAlgebra",
        title: "线性代数",
        durationId: "study.math.linearAlgebra.duration",
        progressId: "study.math.linearAlgebra.progress",
        adjustmentId: "study.math.linearAlgebra.adjustment",
      },
    ],
  },

  {
    id: "professional",
    title: "专业课",
    icon: "💰",
    items: [
      {
        id: "corporateFinance",
        title: "公司金融",
        durationId: "study.professional.corporateFinance.duration",
        progressId: "study.professional.corporateFinance.progress",
        adjustmentId: "study.professional.corporateFinance.adjustment",
      },
      {
        id: "investments",
        title: "投资学",
        durationId: "study.professional.investments.duration",
        progressId: "study.professional.investments.progress",
        adjustmentId: "study.professional.investments.adjustment",
      },
    ],
  },

  {
    id: "english",
    title: "英语",
    icon: "Aa",
    items: [
      {
        id: "vocabulary",
        title: "单词",
        durationId: "study.english.vocabulary.duration",
        progressId: "study.english.vocabulary.progress",
        adjustmentId: "study.english.vocabulary.adjustment",
      },
      {
        id: "ieltsWriting",
        title: "雅思写作",
        durationId: "study.english.ieltsWriting.duration",
        progressId: "study.english.ieltsWriting.progress",
        adjustmentId: "study.english.ieltsWriting.adjustment",
      },
      {
        id: "ieltsReading",
        title: "雅思阅读",
        durationId: "study.english.ieltsReading.duration",
        progressId: "study.english.ieltsReading.progress",
        adjustmentId: "study.english.ieltsReading.adjustment",
      },
      {
        id: "ieltsListening",
        title: "雅思听力",
        durationId: "study.english.ieltsListening.duration",
        progressId: "study.english.ieltsListening.progress",
        adjustmentId: "study.english.ieltsListening.adjustment",
      },
      {
        id: "ieltsSpeaking",
        title: "雅思口语",
        durationId: "study.english.ieltsSpeaking.duration",
        progressId: "study.english.ieltsSpeaking.progress",
        adjustmentId: "study.english.ieltsSpeaking.adjustment",
      },
    ],
  },

  {
    id: "japanese",
    title: "日语",
    icon: "あ",
    items: [
      {
        id: "japanese",
        title: "日语",
        durationId: "study.japanese.totalMinutes",
        progressId: "study.japanese.progress",
        adjustmentId: "study.japanese.adjustment",
      },
    ],
  },

  {
    id: "reading",
    title: "阅读",
    icon: "📖",
    items: [
      {
        id: "reading",
        title: "阅读",
        durationId: "study.reading.totalMinutes",
        progressId: "study.reading.content",
        adjustmentId: "study.reading.adjustment",
      },
    ],
  },
];

export function getStudyLeafKey(groupId, itemId) {
  return `${groupId}.${itemId}`;
}

export function findStudyLeaf(leafKey) {
  for (const group of STUDY_LEAF_GROUPS) {
    for (const item of group.items) {
      if (getStudyLeafKey(group.id, item.id) === leafKey) {
        return { group, item };
      }
    }
  }
  return null;
}

function readFieldValue(draft, fieldId) {
  const state = draft?.fields?.[fieldId];
  if (!state) return "";
  const value = state.value !== "" && state.value !== null && state.value !== undefined ? state.value : state.autoValue;
  return value ?? "";
}

export function hasStudyLeafContent(item, draft) {
  return [item.durationId, item.progressId, item.adjustmentId].some((fieldId) => {
    const value = readFieldValue(draft, fieldId);
    if (typeof value === "number") return value > 0;
    return String(value || "").trim().length > 0;
  });
}

// A leaf shows when it has real content for THIS date, OR the user added it
// for today only (draftAdded), OR it's pinned cross-date (defaultLeafIds).
// `draftHidden` (today-only removal) wins over everything else — it's how
// "移除今日" actually hides a leaf that would otherwise show from content.
export function isStudyLeafVisible(item, leafKey, draft, defaultLeafIds, draftAdded, draftHidden) {
  if ((draftHidden || []).includes(leafKey)) return false;
  if ((defaultLeafIds || []).includes(leafKey)) return true;
  if ((draftAdded || []).includes(leafKey)) return true;
  return hasStudyLeafContent(item, draft);
}

export function getVisibleStudyLeafGroups(draft, defaultLeafIds, draftAdded, draftHidden) {
  return STUDY_LEAF_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      isStudyLeafVisible(item, getStudyLeafKey(group.id, item.id), draft, defaultLeafIds, draftAdded, draftHidden)
    ),
  })).filter((group) => group.items.length > 0);
}

export function getHiddenStudyLeaves(draft, defaultLeafIds, draftAdded, draftHidden) {
  const hidden = [];
  STUDY_LEAF_GROUPS.forEach((group) => {
    group.items.forEach((item) => {
      const leafKey = getStudyLeafKey(group.id, item.id);
      if (!isStudyLeafVisible(item, leafKey, draft, defaultLeafIds, draftAdded, draftHidden)) {
        hidden.push({ group, item, leafKey });
      }
    });
  });
  return hidden;
}
