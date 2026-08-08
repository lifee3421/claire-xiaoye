import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import RewardShopGamePanelsHost from "./components/RewardShopGamePanelsHost.jsx";
import { auth } from "./services/firebase.js";
import { bindPointsApiIdToken } from "./services/pointsApi.js";
import "./styles.css";

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
    <RewardShopGamePanelsHost />
  </React.StrictMode>
);
