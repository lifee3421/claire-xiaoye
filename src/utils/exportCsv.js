import { formatDateOnly } from "./calculations.js";

function escapeCsv(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function exportSettlementsCsv(settlements) {
  const rows = [
    ["日期", "学习分钟", "阅读分钟", "阅读书籍", "学习入账", "运动分钟", "运动入账", "睡眠积分", "运动额外积分", "网页记录娱乐分钟", "复盘识别娱乐分钟", "实际围栏分钟", "围栏来源", "围栏修正原因", "生成时间价值", "日型", "次日基础娱乐上限", "新增积分", "备注"],
    ...settlements.map((item) => [
      item.reviewDate || formatDateOnly(item.createdAt),
      item.studyMinutes,
      item.readingMinutes || item.subjects?.reading?.minutes || "",
      item.readingBookTitle || item.subjects?.reading?.bookTitle || "",
      item.studyCredit,
      item.exerciseMinutes,
      item.exerciseCredit,
      item.sleepAdjustment,
      item.exerciseBonusPoints || "",
      item.webEntertainmentMinutes ?? "",
      item.recognizedEntertainmentMinutes ?? "",
      item.totalEntertainmentMinutes ?? (Number(item.beneficialMinutes || 0) + Number(item.actualGameMinutesToday || 0)),
      item.entertainmentFenceMatchesReview === false ? "复盘修正" : "网页记录",
      item.entertainmentFenceNote || "",
      item.generatedMinutes,
      item.dayTypeDisplayName || "",
      item.nextDayBaseEntertainmentLimit || 60,
      item.pointsAdded,
      item.note || "",
    ]),
  ];
  downloadCsv("小椰奖励银行-结算记录.csv", rows);
}

export function exportRedemptionsCsv(redemptions) {
  const rows = [
    ["日期", "类型", "名称", "消耗积分", "兑换后剩余", "备注"],
    ...redemptions.map((item) => [
      formatDateOnly(item.createdAt),
      item.type === "entertainment_extension" ? "当日娱乐加时" : "商城兑换",
      item.productName,
      item.price,
      item.remainingPoints ?? "",
      item.note || "",
    ]),
  ];
  downloadCsv("小椰奖励银行-兑换记录.csv", rows);
}

export function exportWeeklySummaryCsv(summary, visibleActivityKeys = []) {
  const selectedKeys = visibleActivityKeys.length ? visibleActivityKeys : summary.activityTotals.map((activity) => activity.key);
  const selectedActivities = summary.activityTotals.filter((activity) => selectedKeys.includes(activity.key));
  const headers = ["日期", ...selectedActivities.map((activity) => activity.label), "新增积分", "一句话总结"];
  const tableRows = summary.dailyRows.map((row) => [
    row.date,
    ...row.activities.filter((activity) => selectedKeys.includes(activity.key)).map((activity) => activity.minutes || ""),
    row.raw.pointsAdded || "",
    row.raw.state?.oneLineSummary || "",
  ]);
  const detailRows = summary.dailyRows.flatMap((row) =>
    row.activities
      .filter((activity) => activity.progress.length > 0 || activity.blockers.length > 0)
      .map((activity) => [
        row.date,
        activity.label,
        activity.minutes || "",
        activity.progress.join("；"),
        activity.blockers.join("；"),
      ])
  );

  const rows = [
    ["小椰奖励银行周时间大表", "", "", ""],
    ["记录天数", summary.days, summary.range, ""],
    ["学习总分钟", summary.totals.studyMinutes, `平均 ${summary.totals.avgStudyMinutes}min/天`, ""],
    ["新增积分", summary.totals.pointsAdded, "", ""],
    [],
    headers,
    ...tableRows,
    [],
    ["项目洞察明细", "", "", "", ""],
    ["日期", "项目", "分钟", "推进", "卡点"],
    ...detailRows,
  ];

  downloadCsv("小椰奖励银行-周总结.csv", rows);
}
