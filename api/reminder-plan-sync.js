// Server-side proxy: the Snow-dust shared token is never sent to the browser.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  const target = process.env.CYBERBOSS_REMINDER_SYNC_URL;
  const token = process.env.CYBERBOSS_REMINDER_SYNC_TOKEN;
  if (!target || !token) return res.status(503).json({ error: "reminder sync is not configured" });
  try {
    const response = await fetch(target, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(req.body || {}) });
    const body = await response.json().catch(() => ({ error: "invalid upstream response" }));
    return res.status(response.status).json(body);
  } catch {
    return res.status(502).json({ error: "snow-dust receiver unavailable" });
  }
}
