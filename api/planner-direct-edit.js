export const config = { api: { bodyParser: false } };

export {
  validateDirectPlannerChanges,
  handlePlannerDirectEditRequest,
  plannerDirectEditHandler as default,
} from "../src/server/consolidatedPlannerEndpoints.js";
