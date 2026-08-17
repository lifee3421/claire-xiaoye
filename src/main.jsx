import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./surfaceIsolation.css";

const App = lazy(() => import("./App.jsx"));

function isTodaySurface(pathname = window.location.pathname) {
  return (String(pathname || "/").replace(/\/+$/, "") || "/") === "/today";
}

function syncSurfaceClass() {
  const today = isTodaySurface();
  document.body.classList.toggle("snowdust-today-route", today);
  document.body.classList.toggle("xiaoye-desktop-route", !today);
  document.documentElement.classList.toggle("snowdust-today-route", today);
  document.title = today ? "今日排程" : "Claire · 小椰";
  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme) theme.setAttribute("content", today ? "#100f14" : "#f7fbff");
}

function TodayBootFallback() {
  return (
    <div className="today-boot-static" aria-label="正在打开今日排程">
      <div className="today-boot-static-top"><b>今天</b><span>•••</span></div>
      <div className="today-boot-static-body">
        <div className="today-boot-static-left">
          <i className="today-boot-static-line" />
          <i className="today-boot-static-line" />
          <i className="today-boot-static-line" />
          <i className="today-boot-static-line" />
        </div>
        <div className="today-boot-static-timeline" />
      </div>
    </div>
  );
}

function AppFallback() {
  return isTodaySurface() ? <TodayBootFallback /> : null;
}

// App navigation uses history.pushState(), which does not emit popstate.
// Mirror location changes into a tiny internal event so presentation classes
// follow the URL without coupling Planner state to viewport width or Android.
for (const method of ["pushState", "replaceState"]) {
  const original = window.history[method].bind(window.history);
  window.history[method] = (...args) => {
    const result = original(...args);
    window.dispatchEvent(new Event("xiaoye-location-change"));
    return result;
  };
}

syncSurfaceClass();
window.addEventListener("popstate", syncSurfaceClass);
window.addEventListener("xiaoye-location-change", syncSurfaceClass);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Suspense fallback={<AppFallback />}>
      <App />
    </Suspense>
  </React.StrictMode>
);
