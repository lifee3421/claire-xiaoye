import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const AppRuntime = lazy(() => import("./AppRuntime.jsx"));
const TodayV13ReviewHarness = lazy(() => import("./TodayV13ReviewHarness.jsx"));
const RewardShopGamePanelsHost = lazy(() => import("./components/RewardShopGamePanelsHost.jsx"));

function isTodayRoute(pathname = window.location.pathname) {
  return (String(pathname || "/").replace(/\/+$/, "") || "/") === "/today";
}

const todayRoute = isTodayRoute();
const uiReview = todayRoute
  && new URLSearchParams(window.location.search).get("ui-review") === "1"
  && window.location.hostname !== "claire-xiaoye.vercel.app";
document.body.classList.toggle("snowdust-today-route", todayRoute);
document.documentElement.classList.toggle("snowdust-today-route", todayRoute);
if (todayRoute) {
  document.title = "今日排程";
  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme) theme.setAttribute("content", "#100f14");
}

function TodayBootFallback() {
  return (
    <div style={{ minHeight: "100dvh", color: "#f0ece8", background: "linear-gradient(180deg,#13121a,#100f14)", fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif', padding: "14px" }} aria-label="正在打开今日排程">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 44, borderBottom: "1px solid rgba(255,255,255,.05)" }}><strong style={{ fontSize: 22 }}>今天</strong><span style={{ color: "#756f75", fontSize: 12 }}>•••</span></div>
      <div style={{ padding: "14px 0 12px", borderBottom: "1px solid rgba(255,255,255,.05)" }}><i style={{ display: "block", width: 54, height: 7, borderRadius: 99, background: "rgba(200,184,207,.12)", marginBottom: 10 }} /><i style={{ display: "block", width: "52%", height: 18, borderRadius: 7, background: "rgba(255,255,255,.07)" }} /></div>
      <div style={{ marginTop: 18, height: "62dvh", border: "1px solid rgba(255,255,255,.055)", borderRadius: 15, background: "rgba(15,14,19,.55)", position: "relative", overflow: "hidden" }}>
        {Array.from({ length: 11 }, (_, index) => <i key={index} style={{ position: "absolute", left: 44, right: 8, top: `${8 + index * 8}%`, height: 1, background: "rgba(255,255,255,.045)" }} />)}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Suspense fallback={todayRoute ? <TodayBootFallback /> : null}>
      {uiReview ? <TodayV13ReviewHarness /> : <AppRuntime />}
    </Suspense>
    {!todayRoute && (
      <Suspense fallback={null}>
        <RewardShopGamePanelsHost />
      </Suspense>
    )}
  </React.StrictMode>
);
