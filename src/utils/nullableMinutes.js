// Distinguishes "no explicit minute value" from a genuine 0 (00:00).
//
// `Number(null) === 0`, `Number(undefined) === NaN`, `Number("") === 0` — so a
// bare `Number.isFinite(Number(v))` wrongly treats a *cleared* manual start
// (`null`/`undefined`/`""`) as midnight. Throughout the planner a
// return-to-pool / cleared-start must mean "no manual start", while a real `0`
// is a legitimate 00:00 slot. Use this helper everywhere a planner minute can
// be explicitly absent.
export function hasExplicitFiniteMinute(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}
