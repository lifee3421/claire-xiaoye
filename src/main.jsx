import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import RewardShopGamePanelsHost from "./components/RewardShopGamePanelsHost.jsx";
import { auth } from "./services/firebase.js";
import { bindPointsApiIdToken } from "./services/pointsApi.js";
import "./styles.css";

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

// Browser point writes are server-authoritative and /api/points requires the
// signed-in Firebase user's ID token. Bind once at app startup, but resolve the
// CURRENT user/token at call time so login restoration and token refreshes are
// naturally respected. This mirrors rewardShopApi's proven auth path while
// keeping pointsApi dependency-injected for its Node tests.
bindPointsApiIdToken(async () => {
  const user = auth?.currentUser;
  if (!user) throw new Error("登录状态尚未恢复，请稍后重试或重新登录。");
  return await user.getIdToken();
});

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    {!todayRoute && <RewardShopGamePanelsHost />}
  </React.StrictMode>
);
