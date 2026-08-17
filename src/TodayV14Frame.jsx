import { useEffect, useMemo, useRef, useState } from "react";

const TODAY_V14_SHA256 = "cc173b04831963316c107dd0a913df234d548997a586607d9c3e36f0e0f925ef";

function createBootDocument(origin) {
  const base = `${String(origin || "").replace(/\/$/, "")}/`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#100f14">
<title>今日排程</title>
<style>html,body{margin:0;min-height:100%;background:#100f14;color:#8f8888;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}body{display:grid;place-items:center}.boot{width:6px;height:6px;border-radius:50%;background:#8f7ca0;opacity:.72}.error{max-width:420px;padding:20px;line-height:1.6;color:#d7a3a7}</style>
</head>
<body>
<div class="boot"></div>
<script>
(async()=>{
  const expected=${JSON.stringify(TODAY_V14_SHA256)};
  const base=${JSON.stringify(base)};
  try{
    const response=await fetch(base+'today-ui/payload.txt',{cache:'no-cache',credentials:'same-origin'});
    if(!response.ok)throw new Error('payload → '+response.status);
    const b64=(await response.text()).trim();
    const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const source=await new Response(stream).text();
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source)))).map(v=>v.toString(16).padStart(2,'0')).join('');
    if(digest!==expected)throw new Error('UI source mismatch: '+digest);
    const liveSource=source.replace('<head>','<head><base href="'+base+'"><script>history.replaceState(null,"",'+JSON.stringify(base+'today-ui/index.html?live=1')+');<\\/script>');
    document.open();document.write(liveSource);document.close();
  }catch(error){
    document.body.innerHTML='<div class="error"><b>今日排程没有通过 UI 源码校验。</b><br>'+String(error?.message||error)+'</div>';
  }
})();
<\/script>
</body>
</html>`;
}

export default function TodayV14Frame({ state, onAction }) {
  const frameRef = useRef(null);
  const [ready, setReady] = useState(false);
  const payload = useMemo(() => state || {}, [state]);
  const bootDocument = useMemo(
    () => createBootDocument(typeof window !== "undefined" ? window.location.origin : ""),
    [],
  );

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
        srcDoc={bootDocument}
        style={{ display: "block", width: "100%", height: "100%", border: 0, background: "#100f14" }}
      />
    </main>
  );
}
