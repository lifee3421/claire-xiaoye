import { useEffect, useMemo, useRef, useState } from "react";

export default function TodayV14Frame({ state, onAction }) {
  const frameRef = useRef(null);
  const [ready, setReady] = useState(false);
  const payload = useMemo(() => state || {}, [state]);

  useEffect(() => {
    document.title = "今日排程";
    document.body.classList.add("snowdust-today-v14-host");
    return () => document.body.classList.remove("snowdust-today-v14-host");
  }, []);

  useEffect(() => {
    const handleMessage = (event) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow || event.origin !== window.location.origin) return;
      const message = event.data;
      if (!message || message.type !== "snowdust:today-v14-action") return;
      if (message.action === "ready") {
        setReady(true);
        frame.contentWindow.postMessage({ type: "snowdust:today-v14-state", payload }, window.location.origin);
        return;
      }
      onAction?.(message.action, message.payload || {});
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onAction, payload]);

  useEffect(() => {
    if (!ready || !frameRef.current?.contentWindow) return;
    frameRef.current.contentWindow.postMessage({ type: "snowdust:today-v14-state", payload }, window.location.origin);
  }, [payload, ready]);

  return (
    <main style={{ width: "100%", height: "100dvh", margin: 0, overflow: "hidden", background: "#100f14" }}>
      <iframe
        ref={frameRef}
        title="今日排程"
        src="/today-ui/index.html?live=1"
        onLoad={() => setReady(true)}
        style={{ display: "block", width: "100%", height: "100%", border: 0, background: "#100f14" }}
      />
    </main>
  );
}
