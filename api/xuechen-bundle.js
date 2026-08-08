const RAW_BUNDLE_URL = "https://raw.githubusercontent.com/lifee3421/claire-xiaoye/main/public/xuechen/routine.bundle.bin";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).send("method not allowed");
    return;
  }

  try {
    const upstream = await fetch(RAW_BUNDLE_URL, {
      headers: { "user-agent": "claire-xiaoye-xuechen-loader" },
    });
    if (!upstream.ok) {
      res.status(502).send(`upstream ${upstream.status}`);
      return;
    }

    const bytes = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).send(bytes.toString("base64"));
  } catch (error) {
    res.status(502).send(`bundle proxy failed: ${error?.message || "unknown error"}`);
  }
}
