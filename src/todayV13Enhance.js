const TODAY_PATH = "/today";

function isTodayPath() {
  return (window.location.pathname.replace(/\/+$/, "") || "/") === TODAY_PATH;
}

function beijingDateLabel() {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(new Date());
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";
  const weekday = parts.find((part) => part.type === "weekday")?.value || "";
  return `${month}月${day}日 · ${weekday}⌄`;
}

function textOf(node) {
  return String(node?.textContent || "").replace(/\s+/g, "").trim();
}

function findTrackButton(label) {
  return [...document.querySelectorAll(".timeline-track-switcher button")]
    .find((button) => textOf(button) === label) || null;
}

function currentTrackLabel() {
  const active = document.querySelector(".timeline-track-switcher button.active");
  const label = textOf(active);
  if (label === "计划+专注") return "计划+专注⌄";
  if (label === "仅专注") return "仅专注⌄";
  return "计划⌄";
}

function ensureViewControl(toolbar) {
  if (!toolbar || toolbar.querySelector(".v13-view-control")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-button compact v13-view-control";
  button.textContent = currentTrackLabel();
  button.setAttribute("aria-label", "切换计划与专注显示");

  const popover = document.createElement("div");
  popover.className = "v13-view-popover";
  popover.hidden = true;

  ["计划", "计划 + 专注", "仅专注"].forEach((label) => {
    const option = document.createElement("button");
    option.type = "button";
    option.textContent = label;
    option.addEventListener("click", (event) => {
      event.stopPropagation();
      const target = findTrackButton(label.replace(/\s+/g, ""));
      target?.click();
      button.textContent = currentTrackLabel();
      popover.hidden = true;
    });
    popover.appendChild(option);
  });

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    popover.hidden = !popover.hidden;
  });
  document.addEventListener("click", () => { popover.hidden = true; });

  const host = document.createElement("span");
  host.className = "v13-view-control-host";
  host.append(button, popover);
  toolbar.appendChild(host);
}

function syncTodayChrome() {
  if (!isTodayPath()) return;

  const dayDetail = document.querySelector(".v13-day-button small");
  if (dayDetail && dayDetail.dataset.v13Label !== "1") {
    dayDetail.textContent = beijingDateLabel();
    dayDetail.dataset.v13Label = "1";
  }

  const poolButton = document.querySelector(".v13-toolbar-actions > button:first-child");
  if (poolButton) {
    const count = document.querySelectorAll(".schedule-task-pool .task-card").length;
    const open = document.querySelector(".schedule-task-pool.is-open");
    const label = open ? "收起" : "任务池";
    const nextText = count > 0 ? `${label} ${count}` : label;
    if (poolButton.textContent !== nextText) poolButton.textContent = nextText;
  }

  const summaryLast = document.querySelector(".v13-summary-row > span:last-child");
  if (summaryLast) {
    const inboxCount = document.querySelectorAll(".v13-inbox-aside .v13-inbox-line").length;
    const nextText = `🐾 一起记${inboxCount ? ` · ${inboxCount}` : ""}`;
    if (summaryLast.textContent !== nextText) summaryLast.textContent = nextText;
  }

  const toolbar = document.querySelector(".v13-toolbar-actions");
  ensureViewControl(toolbar);
  const viewControl = toolbar?.querySelector(".v13-view-control");
  if (viewControl && !toolbar.querySelector(".v13-view-popover:not([hidden])")) {
    viewControl.textContent = currentTrackLabel();
  }
}

let observer = null;
let frame = 0;
function scheduleSync() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    syncTodayChrome();
  });
}

export function installTodayV13Enhancements() {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  if (!observer) {
    observer = new MutationObserver(scheduleSync);
    observer.observe(document.getElementById("root") || document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
    window.addEventListener("popstate", scheduleSync);
    window.addEventListener("xiaoye-location-change", scheduleSync);
  }
  scheduleSync();
  return () => {};
}
