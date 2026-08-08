# Planner follow-through behavior

This change intentionally simplifies the planner's right-hand status UI and makes its state date-scoped.

- Review/Tracker facts are resolved for the planner's active `draft.targetDate`, not the wall-clock day.
- Due Tracker reminders are materialized as stickers for the date being viewed/planned.
- The planner exposes one `学习目标` entry. Its `今日` tab edits the active date; its `默认值` tab edits future defaults.
- Saving either target form performs an immediate durable planner write rather than relying only on the one-second autosave timer.
- An explicit daily target edit clears a legacy `studyTargetSnapshot` so an older frozen target cannot mask the saved edit.
- The old `计划时长进度` / `设置计划目标` UI remains out of the rendered planner to avoid maintaining two target systems.
- A settled Focus value is shown simply as `已完成 X`; a technical waiting state is only surfaced when the row has no settled value yet.
- Manual timeline completion checkboxes are reserved for meal cards. Study/work execution remains derived from Focus/review facts instead of a second manual completion source.
