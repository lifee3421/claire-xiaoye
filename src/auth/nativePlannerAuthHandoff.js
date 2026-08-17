import { isTodayPlannerPath } from "../utils/plannerTodayRoute.js";

const MESSAGE_TYPE = "snowdust.planner.google-id-token.v1";
const ERROR_TYPE = "snowdust.planner.auth-error.v1";

export const NativePlannerAuthState = Object.freeze({
  IDLE: "IDLE",
  LOGIN_REQUESTED: "LOGIN_REQUESTED",
  CONSUMING: "CONSUMING",
  CONSUMED: "CONSUMED",
  FAILED: "FAILED",
});

export function isNativePlannerAuthContext(windowRef = window) {
  const location = windowRef?.location;
  return location?.protocol === "https:"
    && isTodayPlannerPath(location.pathname)
    && typeof windowRef?.SnowDustPlannerAuth?.requestLogin === "function";
}

function createNonce(windowRef) {
  const values = new Uint32Array(4);
  windowRef.crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16)).join("");
}

/**
 * Narrow Web endpoint for Scheme B. The only incoming payload is one Google
 * ID token for an outstanding native-login request; it never enters storage.
 */
export function createNativePlannerAuthHandoff({ windowRef = window, onCredential, onStateChange = () => {} } = {}) {
  let state = NativePlannerAuthState.IDLE;
  let nonce = null;
  let stopped = false;

  const update = (next) => {
    state = next;
    onStateChange(next);
  };

  const reset = () => {
    nonce = null;
    update(NativePlannerAuthState.IDLE);
  };

  const receive = async (event) => {
    if (stopped || state !== NativePlannerAuthState.LOGIN_REQUESTED) return;
    if (event.origin !== windowRef.location.origin) return;
    const payload = event.data;
    if (!payload || payload.nonce !== nonce) return;
    if (payload.type === ERROR_TYPE) {
      nonce = null;
      update(NativePlannerAuthState.FAILED);
      return;
    }
    if (payload.type !== MESSAGE_TYPE || typeof payload.idToken !== "string" || !payload.idToken) return;

    // Clear the replay key before calling application code. A reload, second
    // message, or navigation cannot reuse the credential after this point.
    nonce = null;
    update(NativePlannerAuthState.CONSUMING);
    try {
      await onCredential(payload.idToken);
      update(NativePlannerAuthState.CONSUMED);
    } catch {
      update(NativePlannerAuthState.FAILED);
    }
  };

  return {
    start() {
      windowRef.addEventListener("message", receive);
    },
    stop() {
      stopped = true;
      nonce = null;
      windowRef.removeEventListener("message", receive);
    },
    requestLogin() {
      if (stopped || state !== NativePlannerAuthState.IDLE || !isNativePlannerAuthContext(windowRef)) return false;
      nonce = createNonce(windowRef);
      update(NativePlannerAuthState.LOGIN_REQUESTED);
      try {
        windowRef.SnowDustPlannerAuth.requestLogin(nonce);
        return true;
      } catch {
        reset();
        return false;
      }
    },
    notifyLogout() {
      if (!isNativePlannerAuthContext(windowRef)) return;
      nonce = null;
      windowRef.SnowDustPlannerAuth.notifyLogout();
      update(NativePlannerAuthState.IDLE);
    },
    getState() {
      return state;
    },
  };
}
