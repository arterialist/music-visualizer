import { useMemo, useState } from "react";
import AddTrackPanel from "../../components/AddTrackPanel";
import TrackArtwork from "../../components/TrackArtwork";
import { useArtworkColors } from "../../hooks/useArtworkColors";
import { useImmersiveSearch } from "../../hooks/useImmersiveSearch";
import { hueOf, REALM_PINK } from "../../library/artworkColor";
import { trackMatchesQuery, useMusicLibrary } from "../../library/storage";
import type { MusicTrack } from "../../types";
import HaloCanvas from "./HaloCanvas";
import LiquidArtworkLoader from "./LiquidArtworkLoader";
import { togglePin, usePlayerState } from "./trackPlayer";
import { useTrackAudio } from "./useTrackAudio";

function h01(s: string, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function similarity(a: MusicTrack, b: MusicTrack) {
  if (a.similar?.includes(b.id)) return 1;
  const ta = new Set(a.tags);
  const shared = b.tags.filter((t) => ta.has(t)).length;
  return shared / Math.max(1, new Set([...a.tags, ...b.tags]).size);
}

interface OrbPos {
  x: number;
  y: number;
  scale: number;
  z: number;
}

export default function MusicRealm() {
  const player = usePlayerState();
  const tracks = useMusicLibrary();
  const artworkColors = useArtworkColors(tracks);
  const [importing, setImporting] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(() =>
    player.pinned && player.track ? player.track.id : null,
  );
  const { preview } = useTrackAudio();
  const { query, active: searchActive, clear: clearSearch } = useImmersiveSearch();
  const [compact] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(pointer: coarse)").matches &&
      Math.min(window.innerWidth, window.innerHeight) < 820,
  );

  const visibleTracks = useMemo(
    () => tracks.filter((t) => trackMatchesQuery(t, query)),
    [tracks, query],
  );

  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const focusedTrack = focused ? byId.get(focused) : null;

  const positions = useMemo(() => {
    const map = new Map<string, OrbPos>();
    const layoutTracks = visibleTracks.length ? visibleTracks : tracks;
    if (!layoutTracks.length) return map;

    if (!focusedTrack || !visibleTracks.some((t) => t.id === focusedTrack.id)) {
      const points = layoutTracks.map((t) => ({
        track: t,
        x: 8 + h01(t.id, 1) * 84,
        y: 14 + h01(t.id, 2) * 70,
      }));
      const minX = 6.4;
      const minY = 8.2;
      for (let step = 0; step < 240; step++) {
        for (let i = 0; i < points.length; i++) {
          for (let j = i + 1; j < points.length; j++) {
            const a = points[i];
            const b = points[j];
            let dx = (a.x - b.x) / minX;
            let dy = (a.y - b.y) / minY;
            const distance = Math.hypot(dx, dy) || 0.001;
            if (distance >= 1) continue;
            const push = ((1 - distance) * 0.09) / distance;
            dx *= push;
            dy *= push;
            a.x += dx;
            a.y += dy;
            b.x -= dx;
            b.y -= dy;
          }
        }
        points.forEach((point) => {
          point.x = Math.max(5, Math.min(95, point.x));
          point.y = Math.max(12, Math.min(86, point.y));
        });
      }
      points.forEach(({ track: t, x, y }) => {
        map.set(t.id, {
          x,
          y,
          scale: 0.52 + h01(t.id, 3) * 0.12,
          z: Math.floor(h01(t.id, 4) * 10),
        });
      });
      return map;
    }

    const focusY = compact ? 40 : 44;
    map.set(focusedTrack.id, {
      x: 50,
      y: focusY,
      scale: compact ? 1.85 : 2.85,
      z: 30,
    });
    const others = layoutTracks
      .filter((t) => t.id !== focusedTrack.id)
      .sort((a, b) => similarity(focusedTrack, b) - similarity(focusedTrack, a));
    const ring = others.slice(0, 6);
    const rest = others.slice(6);
    ring.forEach((t, i) => {
      const start = (130 * Math.PI) / 180;
      const span = (280 * Math.PI) / 180;
      const a = start + (i / Math.max(1, ring.length - 1)) * span;
      map.set(t.id, {
        x: 50 + Math.cos(a) * (compact ? 39 : 31),
        y: focusY + Math.sin(a) * (compact ? 31 : 29),
        scale: compact ? 0.58 : 0.95,
        z: 20,
      });
    });
    rest.forEach((t) => {
      map.set(t.id, {
        x: 8 + h01(t.id, 5) * 84,
        y: 84 + h01(t.id, 6) * 10,
        scale: 0.45,
        z: 1,
      });
    });
    return map;
  }, [tracks, visibleTracks, focusedTrack, compact]);

  const onHover = (t: MusicTrack | null) => {
    setHovered(t?.id ?? null);
    preview(t ?? focusedTrack ?? null);
  };

  const showEmptyHint = tracks.length === 0 && !importing;

  return (
    <div
      className="absolute inset-0 overflow-hidden select-none"
      onClick={() => {
        setFocused(null);
        preview(null);
      }}
    >
      <AddTrackPanel onImportingChange={setImporting} />

      {showEmptyHint && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <div className="text-xs uppercase tracking-[0.35em] text-white/40">auditory cortex</div>
          <h1 className="mt-4 max-w-md text-2xl font-semibold text-white">
            Your music realm is empty
          </h1>
          <p className="mt-3 max-w-sm text-sm text-white/50">
            Add SoundCloud tracks to float them here. Playback stays in the realm — no uploads
            required.
          </p>
          <p className="mt-8 text-[10px] uppercase tracking-[0.28em] text-white/30">
            click + to paste a link
          </p>
        </div>
      )}

      {importing && tracks.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-2xl border border-white/10 bg-[#0a0c18aa] px-6 py-4 text-center backdrop-blur-sm">
            <div className="text-[10px] uppercase tracking-[0.28em] text-sky-100/50">
              tuning stream
            </div>
            <div className="mt-2 text-sm text-white/60">Pulling track from SoundCloud…</div>
          </div>
        </div>
      )}

      {(() => {
        const active = (hovered ? byId.get(hovered) : null) ?? focusedTrack;
        const p = active ? positions.get(active.id) : null;
        const accent = active ? (artworkColors.get(active.id) ?? REALM_PINK) : REALM_PINK;
        return (
          <HaloCanvas
            hue={hueOf(accent)}
            x={p?.x ?? 50}
            y={p?.y ?? 44}
          />
        );
      })()}

      {!(compact && focusedTrack) && tracks.length > 0 && (
        <div className="pointer-events-none absolute top-24 left-1/2 w-full -translate-x-1/2 text-center md:top-12">
          <div className="text-xs uppercase tracking-[0.35em] text-white/40">
            {searchActive && query ? (
              <>
                filtering ·{" "}
                <span className="font-mono text-pink-200/80">{query}</span>
                <span className="ml-2 text-white/25">esc to clear</span>
              </>
            ) : focusedTrack ? (
              "similar frequencies drift closer"
            ) : (
              "sounds floating through the auditory cortex"
            )}
          </div>
        </div>
      )}

      {tracks.map((t) => {
        const p = positions.get(t.id);
        if (!p) return null;
        const matches = trackMatchesQuery(t, query);
        const isHovered = hovered === t.id;
        const isFocused = focused === t.id;
        const isLoading = player.loading && player.track?.id === t.id;
        const dimmed = hovered !== null && !isHovered;
        const accent = artworkColors.get(t.id) ?? REALM_PINK;
        return (
          <div
            key={t.id}
            className="absolute cursor-pointer"
            style={{
              left: 0,
              top: 0,
              zIndex: isHovered ? 50 : p.z,
              transform: `translate3d(${p.x}vw, ${p.y}vh, 0) translate(-50%, -50%) scale(${p.scale * (isHovered && !isFocused ? 1.18 : 1)})`,
              opacity: !matches ? 0 : dimmed ? 0.34 : 1,
              pointerEvents: matches ? "auto" : "none",
              transition:
                "transform 0.72s cubic-bezier(0.22,1,0.36,1), opacity 0.3s ease",
              // Promoting ~200 orbs to persistent compositor layers blows
              // Android's GPU layer budget: covers and icons rasterize
              // blank/grey. Mobile lets the transitions promote on demand.
              willChange: compact ? undefined : "transform, opacity",
            }}
            onPointerEnter={() => onHover(t)}
            onPointerLeave={() => onHover(null)}
            onClick={(e) => {
              if (!matches) return;
              e.stopPropagation();
              setFocused(isFocused ? null : t.id);
              preview(isFocused ? null : t);
            }}
          >
            <div
              className="relative h-28 w-28"
              style={{
                animation: `orb-float ${5 + h01(t.id, 7) * 4}s ease-in-out ${h01(t.id, 8) * -8}s infinite`,
              }}
            >
              <div className="relative h-28 w-28">
              {isLoading && !compact && (
                  <div
                    className="track-liquid-pool pointer-events-none absolute"
                    style={{ backgroundImage: `url("${t.artworkUrl}")` }}
                    aria-hidden="true"
                  />
                )}
                {isLoading && compact && (
                  <div
                    className="track-glow pointer-events-none"
                    style={{
                      // mixed toward the realm pink so near-black covers
                      // still visibly breathe
                      background: `radial-gradient(circle, color-mix(in srgb, ${accent} 45%, #ff6ec7cc) 0%, color-mix(in srgb, ${accent} 45%, #ff6ec744) 45%, transparent 72%)`,
                    }}
                    aria-hidden="true"
                  />
                )}
                <TrackArtwork
                  artworkUrl={t.artworkUrl}
                  title={t.title}
                  className={`track-artwork relative h-28 w-28 rounded-2xl object-cover shadow-2xl ${isLoading && !compact ? "track-artwork-under-liquid" : ""}`}
                  style={{
                    boxShadow: isFocused
                      ? `0 0 60px 8px color-mix(in srgb, ${accent} 55%, transparent)`
                      : "0 20px 50px rgba(0,0,0,0.6)",
                  }}
                />
                {isLoading && !compact && (
                  <LiquidArtworkLoader artworkUrl={t.artworkUrl} />
                )}
              </div>
              {(isHovered || isFocused) && (
              <div
                  className="pointer-events-none absolute top-full left-1/2 mt-2 text-center"
                  style={{
                    width: "min(18rem, 70vw)",
                    transform: `translateX(-50%) scale(${isFocused ? 1 / p.scale : 1})`,
                    transformOrigin: "top center",
                  }}
                >
                  <div className="truncate text-sm font-semibold text-white drop-shadow">
                    {t.title}
                  </div>
                  <div className="truncate text-xs text-white/55">{t.artist}</div>
                  {isLoading && (
                    <div className="mt-1 flex items-center justify-center gap-1 text-[8px] uppercase tracking-[0.24em] text-sky-100/50">
                      <span>tuning stream</span>
                      <span className="inline-flex gap-0.5" aria-hidden="true">
                        {[0, 1, 2].map((dot) => (
                          <span
                            key={dot}
                            className="h-0.5 w-0.5 animate-pulse rounded-full bg-sky-100/70"
                            style={{ animationDelay: `${dot * 180}ms` }}
                          />
                        ))}
                      </span>
                    </div>
                  )}
                  {isFocused && (
                    <div className="pointer-events-auto mt-2 flex items-center justify-center gap-2">
                      {(t.audioUrl || t.previewUrl) && (
                        <button
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePin();
                        }}
                        title={
                          player.pinned && player.track?.id === t.id
                            ? "unpin (stops when you leave)"
                            : "pin — keep playing everywhere"
                        }
                        className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border transition-colors ${compact ? "" : "backdrop-blur-sm"}`}
                        style={{
                          borderColor:
                            player.pinned && player.track?.id === t.id
                              ? "#ff6ec799"
                              : "rgba(255,255,255,0.2)",
                          background:
                            player.pinned && player.track?.id === t.id
                              ? "#ff6ec726"
                              : "rgba(10,12,24,0.5)",
                          color:
                            player.pinned && player.track?.id === t.id
                              ? "#ff9ddb"
                              : "rgba(255,255,255,0.65)",
                        }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M16 3a1 1 0 0 1 1 1v1l-1 1v5.5l2.5 2.5v2h-5.5V22l-1 1-1-1v-6H5.5v-2L8 11.5V6L7 5V4a1 1 0 0 1 1-1h8z" />
                        </svg>
                      </button>
                    )}
                    {t.soundcloudUrl && (
                      <a
                        href={t.soundcloudUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="open on SoundCloud"
                        className={`flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-[#0a0c1880] text-white/65 transition-colors hover:border-pink-300/50 hover:text-pink-200 ${compact ? "" : "backdrop-blur-sm"}`}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 4h6v6" />
                          <path d="M20 4 9 15" />
                          <path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6" />
                        </svg>
                      </a>
                    )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {focusedTrack && (
        <div className="pointer-events-none absolute bottom-10 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-[0.3em] text-white/35">
          click anywhere to release the cloud
        </div>
      )}

      {searchActive && query && visibleTracks.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-2xl border border-white/10 bg-[#0a0c18aa] px-6 py-4 text-center backdrop-blur-sm">
            <div className="text-sm text-white/70">No tracks match</div>
            <button
              type="button"
              onClick={clearSearch}
              className="pointer-events-auto mt-2 cursor-pointer text-xs uppercase tracking-[0.2em] text-pink-200/70 hover:text-pink-100"
            >
              clear search
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
