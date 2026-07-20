async function scrapeClientId(): Promise<string | null> {
  const page = await fetch("https://soundcloud.com/");
  const html = await page.text();
  const scripts = [
    ...html.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+)"/g),
  ];
  for (const [, scriptUrl] of scripts) {
    const js = await fetch(scriptUrl).then((r) => r.text());
    const match = js.match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{32})"/);
    if (match) return match[1];
  }
  return null;
}

export async function onRequest(): Promise<Response> {
  try {
    const clientId = await scrapeClientId();
    if (!clientId) {
      return Response.json({ error: "client_id not found" }, { status: 502 });
    }
    return Response.json(
      { clientId },
      { headers: { "Cache-Control": "public, max-age=3600" } },
    );
  } catch {
    return Response.json({ error: "SoundCloud lookup failed" }, { status: 502 });
  }
}
