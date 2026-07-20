const SOUNDCLOUD_ORIGIN = "https://api-v2.soundcloud.com";

export async function onRequest(context: { request: Request }): Promise<Response> {
  const url = new URL(context.request.url);
  const apiPath = url.pathname.replace(/^\/sc-api/, "") || "/";
  const target = new URL(`${SOUNDCLOUD_ORIGIN}${apiPath}${url.search}`);

  const headers = new Headers();
  const accept = context.request.headers.get("Accept");
  if (accept) headers.set("Accept", accept);

  const response = await fetch(target.toString(), {
    method: context.request.method,
    headers,
    body:
      context.request.method !== "GET" && context.request.method !== "HEAD"
        ? context.request.body
        : undefined,
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
