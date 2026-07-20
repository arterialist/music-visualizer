/** SoundCloud CDN artwork sizes, largest first. */
const SIZE_VARIANTS = ["-t500x500", "-t300x300", "-large", "-crop"] as const;

/** Pick the best available hi-res artwork URL from SoundCloud CDN paths. */
export function normalizeArtworkUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const trimmed = url.trim();
  if (trimmed.includes("-t500x500")) return trimmed;
  if (trimmed.includes("-t300x300")) return trimmed.replace("-t300x300", "-t500x500");
  if (trimmed.includes("-large")) return trimmed.replace("-large", "-t500x500");
  return trimmed;
}

/** Fallback chain when resolving cover art from API / oEmbed fields. */
export function resolveArtworkUrl(...candidates: (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    const normalized = normalizeArtworkUrl(candidate);
    if (normalized) return normalized;
  }
  return "";
}

/** Alternate CDN sizes to try when the primary artwork URL fails to load. */
export function artworkFallbackUrls(url: string): string[] {
  if (!url) return [];
  const out: string[] = [];
  for (const variant of SIZE_VARIANTS) {
    if (url.includes(variant)) {
      for (const alt of SIZE_VARIANTS) {
        if (alt === variant) continue;
        const candidate = url.replace(variant, alt);
        if (!out.includes(candidate)) out.push(candidate);
      }
      break;
    }
  }
  return out;
}

export interface SoundCloudArtworkSource {
  artwork_url?: string | null;
  user?: { avatar_url?: string | null };
}

export function artworkFromSoundCloud(
  track: SoundCloudArtworkSource | null | undefined,
  oembedThumb?: string | null,
): string {
  return resolveArtworkUrl(track?.artwork_url, track?.user?.avatar_url, oembedThumb);
}
