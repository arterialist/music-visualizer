import { useEffect, useMemo, useState } from "react";
import {
  cacheArtworkColor,
  extractDominantColor,
  getCachedArtworkColor,
  REALM_PINK,
} from "../library/artworkColor";
import { addTrack } from "../library/storage";
import type { MusicTrack } from "../types";

export function useArtworkColors(tracks: MusicTrack[]): Map<string, string> {
  const [tick, setTick] = useState(0);

  const colors = useMemo(() => {
    const map = new Map<string, string>();
    for (const track of tracks) {
      map.set(
        track.id,
        track.accentColor ?? getCachedArtworkColor(track.id) ?? REALM_PINK,
      );
    }
    return map;
    // tick forces refresh after async extraction completes
  }, [tracks, tick]);

  useEffect(() => {
    let cancelled = false;

    for (const track of tracks) {
      if (track.accentColor || getCachedArtworkColor(track.id)) continue;
      if (!track.artworkUrl) continue;

      void extractDominantColor(track.artworkUrl).then((color) => {
        if (cancelled) return;
        cacheArtworkColor(track.id, color);
        setTick((n) => n + 1);
        if (track.accentColor !== color) {
          addTrack({ ...track, accentColor: color });
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [tracks]);

  return colors;
}
