import React from "react";
import App from "./App.jsx";
import { auth } from "./services/firebase.js";
import { bindPointsApiIdToken } from "./services/pointsApi.js";

bindPointsApiIdToken(async () => {
  const user = auth?.currentUser;
  if (!user) throw new Error("登录状态尚未恢复，请稍后重试或重新登录。");
  return await user.getIdToken();
});

export default function AppRuntime() {
  return <App />;
}
