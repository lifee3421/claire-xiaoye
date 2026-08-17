const APP_SUFFIX = "/src/App.jsx";
const SCHEDULE_MARKER = "function ScheduleAssistant(";
const DROP_STATE_MARKER = "  const [dropPreview, setDropPreview] = useState(null);";
const REF_LINE = "  const todayV14ReturnStartsRef = useRef(new Map());";
const REF_USE = "todayV14ReturnStartsRef.current";

export function todayV14ScopeHotfixPlugin() {
  return {
    // The v14 standalone plugin runs in the pre phase and generates the live
    // /today source first. This normal-phase transform must then see that
    // generated reference before React compiles App.jsx. If it cannot, the
    // build fails instead of shipping a runtime-only scope error.
    name: "snowdust-today-v14-scope-hotfix",
    transform(code, id) {
      const normalized = id.replace(/\\/g, "/").split("?")[0];
      if (!normalized.endsWith(APP_SUFFIX)) return null;

      const scheduleIndex = code.indexOf(SCHEDULE_MARKER);
      if (scheduleIndex < 0) return null;

      const firstUseIndex = code.indexOf(REF_USE, scheduleIndex);
      if (firstUseIndex < 0) {
        throw new Error("Today v14 scope hotfix: generated ScheduleAssistant return-position ref use not found");
      }

      let next = code;
      let localRefIndex = next.indexOf(REF_LINE, scheduleIndex);
      if (localRefIndex < 0 || localRefIndex > firstUseIndex) {
        const dropIndex = next.indexOf(DROP_STATE_MARKER, scheduleIndex);
        if (dropIndex < 0 || dropIndex > firstUseIndex) {
          throw new Error("Today v14 scope hotfix: ScheduleAssistant dropPreview marker not found before return-position ref use");
        }
        const insertAt = dropIndex + DROP_STATE_MARKER.length;
        next = `${next.slice(0, insertAt)}\n${REF_LINE}${next.slice(insertAt)}`;
        localRefIndex = next.indexOf(REF_LINE, scheduleIndex);
      }

      const verifiedUseIndex = next.indexOf(REF_USE, scheduleIndex);
      if (localRefIndex < scheduleIndex || localRefIndex > verifiedUseIndex) {
        throw new Error("Today v14 scope hotfix: return-position ref is not defined in ScheduleAssistant before first use");
      }

      return { code: next, map: null };
    },
  };
}
