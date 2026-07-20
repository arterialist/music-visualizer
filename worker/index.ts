const SOUNDCLOUD_ORIGIN = "https://api-v2.soundcloud.com";

interface Env {
  ASSETS: Fetcher;
}

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

async function handleScApi(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const apiPath = url.pathname.replace(/^\/sc-api/, "") || "/";
  const target = new URL(`${SOUNDCLOUD_ORIGIN}${apiPath}${url.search}`);

  const headers = new Headers();
  const accept = request.headers.get("Accept");
  if (accept) headers.set("Accept", accept);

  const response = await fetch(target.toString(), {
    method: request.method,
    headers,
    body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function handleScClientId(): Promise<Response> {
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname.startsWith("/sc-api")) {
      return handleScApi(request);
    }
    if (pathname === "/sc-client-id") {
      return handleScClientId();
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
