/** Unwrap legacy /audio-proxy URLs; playback uses direct CDN URLs with crossOrigin. */
export function directAudioUrl(url: string | null): string | null {
  if (!url) return null;
  if (!url.includes("/audio-proxy")) return url;
  try {
    const parsed = new URL(url, typeof location !== "undefined" ? location.origin : "https://example.com");
    return parsed.searchParams.get("url") ?? url;
  } catch {
    return url;
  }
}
