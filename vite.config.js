import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";

function buildCommit() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  try {
    return execFileSync("git", ["-c", "safe.directory=*", "rev-parse", "--short=7", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

const buildInfo = Object.freeze({ commit: buildCommit(), builtAt: new Date().toISOString() });

export default defineConfig({
  plugins: [react()],
  define: {
    __DAILY_BUILD_INFO__: JSON.stringify(buildInfo),
  },
});
