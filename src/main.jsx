import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";
import "./surfaceIsolation.css";
import "./todayV13Skin.css";
import "./todayV13LayoutFix.css";
import "./todayV13Exact.css";
import "./todayV13Final.css";
import { installTodayV13Enhancements } from "./todayV13Enhance.js";

function isTodaySurface(pathname = window.location.pathname) {
  return (String(pathname || "/").replace(/\/+$/, "") || "/") === "/today";
}

function syncSurfaceClass() {
  const today = isTodaySurface();
  document.body.classList.toggle("snowdust-today-route", today);
  document.body.classList.toggle("xiaoye-desktop-route", !today);
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
installTodayV13Enhancements();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
