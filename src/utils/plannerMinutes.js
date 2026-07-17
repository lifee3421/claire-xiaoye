function finiteNonNegative(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(0, numeric)
    : Math.max(0, Number(fallback) || 0);
}

function firstExplicitNumber(values = []) {
  for (const value of values) {
    if (
      value !== null &&
      value !== undefined &&
      value !== "" &&
      Number.isFinite(Number(value))
    ) {
      return Math.max(0, Number(value));
    }
  }

  return null;
}

/**
 * 时间块在时间线中实际占用的分钟数。
 * 对 task block 而言通常等于工作分钟 + 休息分钟。
 */
export function getBlockFootprintMinutes(block = {}) {
  const start = Number(block.start);
  const end = Number(block.end);

  if (Number.isFinite(start) && Number.isFinite(end)) {
    return Math.max(0, end - start);
  }

  const explicit = firstExplicitNumber([
    block.occupiedDuration,
    block.totalMinutes,
  ]);

  return explicit ?? 0;
}

/**
 * 获取任务块明确保存的休息分钟。
 */
export function getBlockBreakMinutes(block = {}) {
  const explicit = firstExplicitNumber([
    block.breakMinutes,
    block.restMinutes,
    block.breakAfter,
  ]);

  if (explicit !== null) {
    return explicit;
  }

  const footprint = getBlockFootprintMinutes(block);
  const active = firstExplicitNumber([
    block.workMinutes,
    block.studyMinutes,
    block.duration,
  ]);

  return active === null
    ? 0
    : Math.max(0, footprint - active);
}

/**
 * 获取任务本身的有效执行分钟，不含块后休息。
 *
 * 注意：
 * studyMinutes 是现有时间线模型中的历史字段名；
 * 它在 task block 上实际表示该任务段的执行分钟，
 * 即便任务类别不是学习，也可以作为 active minutes 使用。
 */
export function getBlockActiveMinutes(block = {}) {
  const explicit = firstExplicitNumber([
    block.workMinutes,
    block.studyMinutes,
    block.duration,
  ]);

  if (explicit !== null) {
    return explicit;
  }

  return Math.max(
    0,
    getBlockFootprintMinutes(block) - getBlockBreakMinutes(block),
  );
}

/**
 * 仅对被判定为学习类的 task block 返回纯学习分钟。
 */
export function getPureStudyMinutesFromBlock(
  block = {},
  { isStudyBlock = () => false } = {},
) {
  if (block?.kind !== "task") {
    return 0;
  }

  if (!isStudyBlock(block)) {
    return 0;
  }

  return getBlockActiveMinutes(block);
}

/**
 * 汇总排程时间线。
 */
export function summarizePlannerMinutes(
  blocks = [],
  { isStudyBlock = () => false } = {},
) {
  return (Array.isArray(blocks) ? blocks : []).reduce(
    (summary, block) => {
      if (block?.kind !== "task") {
        return summary;
      }

      const footprintMinutes = getBlockFootprintMinutes(block);
      const activeMinutes = getBlockActiveMinutes(block);
      const breakMinutes = getBlockBreakMinutes(block);
      const pureStudyMinutes = getPureStudyMinutesFromBlock(block, {
        isStudyBlock,
      });

      summary.taskFootprintMinutes += footprintMinutes;
      summary.activeTaskMinutes += activeMinutes;
      summary.breakMinutes += breakMinutes;
      summary.pureStudyMinutes += pureStudyMinutes;
      summary.nonStudyActiveMinutes += Math.max(
        0,
        activeMinutes - pureStudyMinutes,
      );

      return summary;
    },
    {
      taskFootprintMinutes: 0,
      activeTaskMinutes: 0,
      pureStudyMinutes: 0,
      nonStudyActiveMinutes: 0,
      breakMinutes: 0,
    },
  );
}

export function sumPureStudyMinutes(
  blocks = [],
  { isStudyBlock = () => false } = {},
) {
  return summarizePlannerMinutes(blocks, { isStudyBlock })
    .pureStudyMinutes;
}

export function sumActiveTaskMinutes(blocks = []) {
  return (Array.isArray(blocks) ? blocks : []).reduce(
    (sum, block) =>
      block?.kind === "task"
        ? sum + getBlockActiveMinutes(block)
        : sum,
    0,
  );
}

export function normalizeStudyMinutes(value) {
  return finiteNonNegative(value);
}
