import React, { useRef, useState } from "react";
import { DndContext, pointerWithin } from "@dnd-kit/core";
import TodayV13Surface from "./TodayV13Surface.jsx";

const blocks = [
  { id: "math-a", kind: "task", title: "数学｜网课 3×50", start: 855, end: 925, studyMinutes: 50, breakMinutes: 20, segmentIndex: 2, segmentTotal: 3, priority: 1, color: "#75a9e8", status: "pending", canComplete: false },
  { id: "math-b", kind: "task", title: "数学｜习题 2×50", start: 975, end: 1045, studyMinutes: 50, breakMinutes: 20, segmentIndex: 1, segmentTotal: 2, priority: 1, color: "#a78bda", status: "pending", canComplete: false },
  { id: "review", kind: "task", title: "数学｜复习", start: 1110, end: 1150, studyMinutes: 40, breakMinutes: 0, segmentIndex: 1, segmentTotal: 1, priority: 2, color: "#75a9e8", status: "pending", canComplete: false },
  { id: "dinner", kind: "fixed", title: "晚餐", start: 1150, end: 1190, studyMinutes: 40, breakMinutes: 0, color: "#c6ad71", status: "pending", canComplete: true, locked: false },
  { id: "finance", kind: "task", title: "专业课｜经济金融", start: 1260, end: 1320, studyMinutes: 50, breakMinutes: 10, segmentIndex: 1, segmentTotal: 1, priority: 1, color: "#68c59c", status: "pending", canComplete: false },
];

const poolTasks = [
  { id: "pool-math-1", title: "数学｜网课 3×50", categoryId: "math", categoryLabel: "数学", color: "#75a9e8", priority: 1, primaryDuration: 50, poolSegments: [{ blockId: "pool-math-1:1", duration: 50, occupiedDuration: 60, breakAfter: 10 }] },
  { id: "pool-math-2", title: "数学｜习题 2×50", categoryId: "math", categoryLabel: "数学", color: "#75a9e8", priority: 1, primaryDuration: 50, poolSegments: [{ blockId: "pool-math-2:1", duration: 50, occupiedDuration: 60, breakAfter: 10 }] },
  { id: "pool-finance", title: "专业课｜经济金融", categoryId: "professional", categoryLabel: "经济 / 专业课", color: "#68c59c", priority: 1, primaryDuration: 50, poolSegments: [{ blockId: "pool-finance:1", duration: 50, occupiedDuration: 60, breakAfter: 10 }] },
  { id: "pool-english", title: "英语 / 雅思｜单词 + 口语", categoryId: "english", categoryLabel: "英语 / 雅思", color: "#a78bda", priority: 2, primaryDuration: 40, poolSegments: [{ blockId: "pool-english:1", duration: 40, occupiedDuration: 40, breakAfter: 0 }] },
  { id: "pool-paper", title: "论文｜可见产出", categoryId: "paper", categoryLabel: "论文", color: "#df8a55", priority: 1, primaryDuration: 90, poolSegments: [{ blockId: "pool-paper:1", duration: 90, occupiedDuration: 100, breakAfter: 10 }] },
  { id: "pool-reading", title: "阅读｜思考、快写量", categoryId: "reading", categoryLabel: "阅读", color: "#69bf9b", priority: 3, primaryDuration: 30, poolSegments: [{ blockId: "pool-reading:1", duration: 30, occupiedDuration: 30, breakAfter: 0 }] },
];

const goals = [
  { categoryId: "math", categoryLabel: "数学", targetMinutes: 320, scheduledMinutes: 190, color: "#75a9e8" },
  { categoryId: "professional", categoryLabel: "专业课", targetMinutes: 140, scheduledMinutes: 60, color: "#68c59c" },
  { categoryId: "english", categoryLabel: "英语", targetMinutes: 140, scheduledMinutes: 40, color: "#a78bda" },
  { categoryId: "reading", categoryLabel: "阅读", targetMinutes: 30, scheduledMinutes: 0, color: "#69bf9b" },
];

const inboxItems = [
  { id: "inbox-1", title: "晚点问雪尘复盘数学错题", kind: "note", source: "user", status: "active" },
  { id: "inbox-2", title: "整理明天要带的资料", kind: "task", source: "snowdust", estimatedMinutes: 15, status: "active" },
];

export default function TodayV13ReviewHarness() {
  const [poolOpen, setPoolOpen] = useState(false);
  const timelineRef = useRef(null);
  return (
    <DndContext collisionDetection={pointerWithin}>
      <TodayV13Surface
        targetDate="2026-08-17"
        saveLabel="已保存"
        nowMinute={980}
        currentBlock={blocks[1]}
        nextBlock={blocks[2]}
        completedCount={5}
        remainingCount={5}
        scheduledMinutes={330}
        totalBlocks={10}
        plan={{ timelineStart: 480, timelineEnd: 1380 }}
        blocks={blocks}
        focusSessions={[]}
        focusEnabled
        focusStatusNote="Focus 记录会叠加在同一条时间线上。"
        timelineRef={timelineRef}
        poolOpen={poolOpen}
        poolTasks={poolTasks}
        poolOrder={poolTasks.map((task) => task.id)}
        poolCount={poolTasks.length}
        onTogglePool={() => setPoolOpen((value) => !value)}
        onMore={() => {}}
        onOverview={() => {}}
        onInbox={() => {}}
        onTrackers={() => {}}
        onTemplates={() => {}}
        onCurrent={() => {}}
        onFocusCurrent={() => {}}
        onToday={() => {}}
        onFocusNav={() => {}}
        onChatNav={() => {}}
        onCreateTask={() => {}}
        onClearPool={() => {}}
        onEditTask={() => {}}
        onDeleteTask={() => {}}
        onArrangePoolTask={() => {}}
        onEditBlock={() => {}}
        onToggleComplete={() => {}}
        onToggleLock={() => {}}
        onResizeTask={() => {}}
        goals={goals}
        inboxItems={inboxItems}
        onInboxItem={() => {}}
      />
    </DndContext>
  );
}
