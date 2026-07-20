export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  artworkUrl: string;
  /** Dominant accent sampled from artwork — cached in library after first load. */
  accentColor?: string;
  previewUrl: string | null;
  audioUrl: string | null;
  audioSegments?: string[];
  soundcloudUrl: string;
  tags: string[];
  similar: string[];
  addedAt: number;
}

export interface MusicLibrary {
  version: 1;
  tracks: MusicTrack[];
}
