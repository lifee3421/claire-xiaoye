import { readFile } from "node:fs/promises";

const BUNDLE_FILE = new URL("./xuechen-routine.bundle.bin", import.meta.url);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).send("method not allowed");
    return;
  }

  try {
    const bytes = await readFile(BUNDLE_FILE);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).send(bytes.toString("base64"));
  } catch (error) {
    res.status(500).send(`bundle local read failed: ${error?.code || "ERR"} · ${error?.message || "unknown error"}`);
  }
}
