import { readRawBody } from "../src/server/adminFirestore.js";
import {
  plannerMutateHandler,
  plannerDirectEditHandler,
  plannerDraftSidecarHandler,
  plannerUiProposalHandler,
  plannerUiProposalApplyHandler,
} from "../src/server/consolidatedPlannerEndpoints.js";
import { plannerUiContextHandler } from "../src/server/plannerUiContextEndpoint.js";

// One deployment-level Function serves a small group of existing Planner
// endpoints so the project stays inside Vercel Hobby's Function-count budget.
// The HMAC direct-edit endpoint needs the exact raw request bytes, therefore
// body parsing is disabled for this shared Function. Firebase-authenticated
// routes are parsed below before delegating to their unchanged handlers.
export const config = { api: { bodyParser: false } };

const ROUTES = new Map([
  ["mutate", plannerMutateHandler],
  ["direct-edit", plannerDirectEditHandler],
  ["draft-sidecar", plannerDraftSidecarHandler],
  ["ui-proposal", plannerUiProposalHandler],
  ["ui-proposal-apply", plannerUiProposalApplyHandler],
  ["ui-context", plannerUiContextHandler],
]);

function plannerRoute(req) {
  const value = req.query?.__plannerRoute;
  return String(Array.isArray(value) ? value[0] : (value || "")).trim();
}

async function ensureJsonBody(req, res) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return true;
  const rawBody = await readRawBody(req);
  if (!rawBody) {
    req.body = {};
    return true;
  }
  try {
    req.body = JSON.parse(rawBody);
    return true;
  } catch {
    res.status(400).json({ error: "body is not valid JSON" });
    return false;
  }
}

export default async function handler(req, res) {
  const route = plannerRoute(req);
  const routeHandler = ROUTES.get(route);
  if (!routeHandler) {
    res.status(404).json({ error: "planner route not found" });
    return;
  }

  // HMAC verification must see the unconsumed raw stream.
  if (route === "direct-edit") {
    await routeHandler(req, res);
    return;
  }

  if (req.method === "POST" && !(await ensureJsonBody(req, res))) return;
  await routeHandler(req, res);
}