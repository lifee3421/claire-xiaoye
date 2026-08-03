// Incremental timeline occupancy builder, extracted out of
// buildAutoSchedulePlan (App.jsx) so the LIVE-ONLY occupancy rule can be unit
// tested directly under Node's test runner.
//
// Rule (spec section 8 + the ghost-block fix): every placed block — including
// superseded rescheduled/cancelled history — is retained in `allBlocks` so the
// baseline strip can still look it up by id. BUT only LIVE blocks
// (isLivePlanBlock) contribute to `occupied`. If a historical block were
// merged into `occupied`, the auto-placement loop for subsequent movable
// segments would treat its time slot as taken (the "ghost block" bug), even
// though the final `blocks` output filters it out. Centralizing the guard here
// means the bug cannot silently reappear.
//
// `blockToInterval` / `mergeIntervals` are injected so this module has no
// dependency on App.jsx's local interval helpers and stays trivially testable.

import { isLivePlanBlock } from "./baselinePlanModel.js";

export function createOccupancyBuilder({ blockToInterval, mergeIntervals, initialOccupied = [] } = {}) {
  const allBlocks = [];
  let occupied = initialOccupied;
  const add = (block) => {
    allBlocks.push(block);
    if (isLivePlanBlock(block)) {
      occupied = mergeIntervals([...occupied, blockToInterval(block)]);
    }
    return occupied;
  };
  return {
    add,
    get allBlocks() {
      return allBlocks;
    },
    get liveBlocks() {
      return allBlocks.filter(isLivePlanBlock);
    },
    get occupied() {
      return occupied;
    },
  };
}
