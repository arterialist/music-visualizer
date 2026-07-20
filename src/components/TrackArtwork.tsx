import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { artworkFallbackUrls, normalizeArtworkUrl } from "../library/artwork";

interface TrackArtworkProps {
  artworkUrl: string;
  title: string;
  className?: string;
  style?: CSSProperties;
}

export default function TrackArtwork({
  artworkUrl,
  title,
  className,
  style,
}: TrackArtworkProps) {
  const candidates = useMemo(() => {
    const primary = normalizeArtworkUrl(artworkUrl) ?? artworkUrl;
    const fallbacks = artworkFallbackUrls(primary);
    return [primary, ...fallbacks.filter((url) => url !== primary)];
  }, [artworkUrl]);

  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [artworkUrl]);

  const src = candidates[Math.min(index, candidates.length - 1)] ?? "";

  return (
    <img
      src={src}
      alt={title}
      draggable={false}
      crossOrigin="anonymous"
      className={className}
      style={style}
      onError={() => {
        setIndex((current) => (current + 1 < candidates.length ? current + 1 : current));
      }}
    />
  );
}
