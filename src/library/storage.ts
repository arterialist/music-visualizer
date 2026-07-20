import { useSyncExternalStore } from "react";
import type { MusicLibrary, MusicTrack } from "../types";
import { directAudioUrl } from "./audioProxy";
import { normalizeArtworkUrl } from "./artwork";

const STORAGE_KEY = "music-realm-library-v1";
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function emptyLibrary(): MusicLibrary {
  return { version: 1, tracks: [] };
}

function normalizeTrack(track: MusicTrack & { streamUrl?: string | null }): MusicTrack {
  const audioUrl = track.audioUrl ?? track.streamUrl ?? null;
  const artworkUrl = normalizeArtworkUrl(track.artworkUrl) ?? track.artworkUrl;
  return {
    ...track,
    artworkUrl,
    previewUrl: track.previewUrl ?? null,
    audioUrl: directAudioUrl(audioUrl),
    soundcloudUrl: track.soundcloudUrl,
    tags: track.tags ?? [],
    similar: track.similar ?? [],
    addedAt: track.addedAt ?? Date.now(),
  };
}

export function loadLibrary(): MusicLibrary {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyLibrary();
    const parsed = JSON.parse(raw) as MusicLibrary;
    if (parsed.version !== 1 || !Array.isArray(parsed.tracks)) return emptyLibrary();
    parsed.tracks = parsed.tracks.map(normalizeTrack);
    return parsed;
  } catch {
    return emptyLibrary();
  }
}

export function saveLibrary(library: MusicLibrary): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
  notify();
}

export function subscribeLibrary(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

let tracksSnapshot: MusicTrack[] = [];
let tracksSnapshotRaw: string | null = null;

function getTracksSnapshot(): MusicTrack[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === tracksSnapshotRaw) return tracksSnapshot;
  tracksSnapshotRaw = raw;
  tracksSnapshot = loadLibrary().tracks;
  return tracksSnapshot;
}

export function useMusicLibrary(): MusicTrack[] {
  return useSyncExternalStore(subscribeLibrary, getTracksSnapshot, () => []);
}

export function addTrack(track: MusicTrack): MusicLibrary {
  const library = loadLibrary();
  const existing = library.tracks.findIndex((t) => t.id === track.id);
  if (existing >= 0) {
    library.tracks[existing] = track;
  } else {
    library.tracks.unshift(track);
  }
  recomputeSimilar(library.tracks);
  saveLibrary(library);
  return library;
}

export function removeTrack(id: string): MusicLibrary {
  const library = loadLibrary();
  library.tracks = library.tracks.filter((t) => t.id !== id);
  recomputeSimilar(library.tracks);
  saveLibrary(library);
  return library;
}

/** Shared-tag similarity edges, same idea as the personal site manifest. */
function recomputeSimilar(tracks: MusicTrack[]): void {
  for (const track of tracks) {
    const scored = tracks
      .filter((other) => other.id !== track.id)
      .map((other) => {
        const ta = new Set(track.tags);
        const shared = other.tags.filter((t) => ta.has(t)).length;
        const score = shared / Math.max(1, new Set([...track.tags, ...other.tags]).size);
        return { id: other.id, score };
      })
      .sort((a, b) => b.score - a.score);
    track.similar = scored.slice(0, 8).filter((s) => s.score > 0).map((s) => s.id);
  }
}

export function trackMatchesQuery(track: MusicTrack, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  const haystack = [track.title, track.artist, ...track.tags].join(" ").toLowerCase();
  return q.split(/\s+/).every((term) => haystack.includes(term));
}
