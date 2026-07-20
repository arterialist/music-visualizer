import type { MusicTrack } from "../types";
import { normalizeArtworkUrl, resolveArtworkUrl } from "./artwork";

const SOUNDCLOUD_HOST = /^https?:\/\/(www\.)?soundcloud\.com\//i;
const SC_API = "/sc-api";
const SC_API_ORIGIN = "https://api-v2.soundcloud.com";

export function isSoundCloudUrl(url: string): boolean {
  return SOUNDCLOUD_HOST.test(url.trim());
}

interface OEmbedResponse {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
  html?: string;
}

interface ResolvedTrack {
  id: number;
  title: string;
  user: { username: string; avatar_url?: string | null };
  artwork_url: string | null;
  tag_list?: string;
  permalink_url: string;
  streamable?: boolean;
  media?: {
    transcodings?: Array<{
      format: { protocol: string; mime_type: string };
      url: string;
    }>;
  };
}

let cachedClientId: string | null = null;

function toScApiUrl(apiUrl: string): string {
  if (apiUrl.startsWith(SC_API_ORIGIN)) {
    return `${SC_API}${apiUrl.slice(SC_API_ORIGIN.length)}`;
  }
  return apiUrl;
}

async function fetchClientId(): Promise<string | null> {
  if (cachedClientId) return cachedClientId;
  try {
    const res = await fetch("/sc-client-id");
    if (res.ok) {
      const data = (await res.json()) as { clientId?: string };
      if (data.clientId) {
        cachedClientId = data.clientId;
        return cachedClientId;
      }
    }
  } catch {
    /* fall through */
  }
  return null;
}

async function resolveTrackApi(url: string, clientId: string): Promise<ResolvedTrack | null> {
  try {
    const res = await fetch(
      `${SC_API}/resolve?url=${encodeURIComponent(url)}&client_id=${clientId}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as ResolvedTrack;
    if (!data.id || !data.title) return null;
    return data;
  } catch {
    return null;
  }
}

async function resolveStreamUrl(
  track: ResolvedTrack,
  clientId: string,
): Promise<string | null> {
  const progressive = track.media?.transcodings?.find(
    (t) => t.format.protocol === "progressive" && t.format.mime_type === "audio/mpeg",
  );
  if (!progressive?.url) return null;
  try {
    const proxyUrl = toScApiUrl(progressive.url);
    const separator = proxyUrl.includes("?") ? "&" : "?";
    const res = await fetch(`${proxyUrl}${separator}client_id=${clientId}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { url?: string };
    return data.url ?? null;
  } catch {
    return null;
  }
}

function artworkFromResolved(track: ResolvedTrack, ...fallbacks: (string | null | undefined)[]): string {
  return resolveArtworkUrl(track.artwork_url, track.user?.avatar_url, ...fallbacks);
}

function tagsFromResolved(track: ResolvedTrack): string[] {
  if (!track.tag_list) return [];
  return track.tag_list
    .split(/\s+/)
    .map((t) => t.replace(/^"/, "").replace(/"$/, ""))
    .filter(Boolean);
}

export async function refreshTrackStream(track: MusicTrack): Promise<MusicTrack> {
  const clientId = await fetchClientId();
  if (!clientId) return track;

  const resolved = await resolveTrackApi(track.soundcloudUrl, clientId);
  if (!resolved) return track;

  let streamUrl: string | null = null;
  if (resolved.streamable !== false) {
    streamUrl = await resolveStreamUrl(resolved, clientId);
  }

  const nextArtwork = artworkFromResolved(resolved, track.artworkUrl) || track.artworkUrl;

  return {
    ...track,
    title: resolved.title || track.title,
    artist: resolved.user.username || track.artist,
    artworkUrl: nextArtwork,
    accentColor: nextArtwork === track.artworkUrl ? track.accentColor : undefined,
    audioUrl: streamUrl,
    tags: tagsFromResolved(resolved).length ? tagsFromResolved(resolved) : track.tags,
  };
}

export async function importSoundCloudUrl(rawUrl: string): Promise<MusicTrack> {
  const url = rawUrl.trim();
  if (!isSoundCloudUrl(url)) {
    throw new Error("Paste a SoundCloud track URL (soundcloud.com/…)");
  }

  const oembedRes = await fetch(
    `https://soundcloud.com/oembed?url=${encodeURIComponent(url)}&format=json`,
  );
  if (!oembedRes.ok) throw new Error("Could not resolve that SoundCloud link");
  const oembed = (await oembedRes.json()) as OEmbedResponse;

  const clientId = await fetchClientId();
  let resolved: ResolvedTrack | null = null;
  let streamUrl: string | null = null;

  if (clientId) {
    resolved = await resolveTrackApi(url, clientId);
    if (resolved && resolved.streamable !== false) {
      streamUrl = await resolveStreamUrl(resolved, clientId);
    }
  }

  const id = resolved ? `sc-${resolved.id}` : `sc-${hashUrl(url)}`;
  const title = resolved?.title ?? oembed.title?.replace(/^.*-\s*/, "") ?? "Untitled";
  const artist = resolved?.user.username ?? oembed.author_name ?? "Unknown";
  const artworkUrl = resolved
    ? artworkFromResolved(resolved, oembed.thumbnail_url)
    : normalizeArtworkUrl(oembed.thumbnail_url) ?? oembed.thumbnail_url ?? "";
  const soundcloudUrl = url;

  return {
    id,
    title,
    artist,
    artworkUrl,
    soundcloudUrl,
    previewUrl: null,
    audioUrl: streamUrl,
    tags: resolved ? tagsFromResolved(resolved) : [],
    similar: [],
    addedAt: Date.now(),
  };
}

function hashUrl(url: string): string {
  let h = 2166136261;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
