import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import RewardShopGamePanelsHost from "./components/RewardShopGamePanelsHost.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    <RewardShopGamePanelsHost />
  </React.StrictMode>
);
