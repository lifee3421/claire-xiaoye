import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { auth } from "./services/firebase.js";
import { bindPointsApiIdToken } from "./services/pointsApi.js";
import "./styles.css";

const App = lazy(() => import("./App.jsx"));
const RewardShopGamePanelsHost = lazy(() => import("./components/RewardShopGamePanelsHost.jsx"));

function isTodayRoute(pathname = window.location.pathname) {
  return (String(pathname || "/").replace(/\/+$/, "") || "/") === "/today";
}

const todayRoute = isTodayRoute();
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

// Browser point writes are server-authoritative and /api/points requires the
// signed-in Firebase user's ID token. Bind once at app startup, but resolve the
// CURRENT user/token at call time so login restoration and token refreshes are
// naturally respected.
bindPointsApiIdToken(async () => {
  const user = auth?.currentUser;
  if (!user) throw new Error("登录状态尚未恢复，请稍后重试或重新登录。");
  return await user.getIdToken();
});

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Suspense fallback={todayRoute ? <TodayBootFallback /> : null}>
      <App />
      {!todayRoute && <RewardShopGamePanelsHost />}
    </Suspense>
  </React.StrictMode>
);
