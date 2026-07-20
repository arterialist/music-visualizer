# Music Realm

An immersive browser music player with audio-reactive visuals. Paste SoundCloud links, build a personal library that lives in your browser, and explore tracks as floating orbs in a dark, atmospheric space.

No uploads. No accounts. Just paste a link and listen.

## Features

- **SoundCloud library** — Add tracks by URL, including private share links (`/s-…` tokens). Metadata and artwork are resolved automatically.
- **Audio-reactive halo** — Web Audio FFT drives a living visual field: band energy, stereo balance, bass wobble, and transient punch.
- **Liquid artwork loader** — Focused tracks get a WebGL refraction effect over the cover art while the stream buffers.
- **Dominant-color tinting** — Cover art is sampled to tint the halo, glow, and shadows per track.
- **Immersive search** — Start typing anywhere to filter the library. `Esc` clears the query.
- **Pin playback** — Keep a track playing while you browse other orbs.
- **Stream refresh** — Signed SoundCloud CDN URLs are re-resolved on playback so stale links don't break your library.
- **Local-first** — Your library persists in `localStorage`. Nothing leaves your browser except SoundCloud API calls.

## Quick start

**Requirements:** Node.js 20+

```bash
git clone https://github.com/arterialist/music-visualizer.git
cd music-visualizer
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173), click **+**, and paste a SoundCloud track URL.

## Usage

| Action | How |
|--------|-----|
| Add a track | Click **+** (top right) and paste a SoundCloud URL |
| Preview | Hover an orb |
| Focus | Click an orb — similar tracks drift closer |
| Pin | Click the pin icon on a focused track |
| Search | Start typing (title, artist, or tags) |
| Clear search | `Esc` |
| Stop / unfocus | Click the background |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server with SoundCloud API proxy |
| `npm run build` | Typecheck and build for production |
| `npm run preview` | Serve the production build locally |
| `npm run deploy` | Build and deploy to Cloudflare Workers |
| `npm run typecheck` | Run TypeScript checks (app + worker) |

## Deploy to Cloudflare

The app ships as a Cloudflare Worker with static assets and two API routes for SoundCloud resolution:

- `/sc-api/*` — Proxies the SoundCloud v2 API (avoids CORS in production)
- `/sc-client-id` — Scrapes a fresh SoundCloud client ID

**Build command**

```bash
npm run build
```

**Deploy command**

```bash
npm run deploy
```

Output directory: `dist`

SPA routing is handled by Wrangler (`not_found_handling: "single-page-application"`). Do not add a `public/_redirects` file — it conflicts with Wrangler's SPA mode.

### GitHub → Cloudflare

Connect the repo in the Cloudflare dashboard, set Node.js 22, and use the build/deploy commands above. Pushes to `main` will build and deploy automatically.

## How it works

```
┌─────────────────────────────────────────────────────────┐
│  React UI (MusicRealm)                                  │
│  · floating orbs · search · add-track panel             │
└───────────────┬─────────────────────────────────────────┘
                │
    ┌───────────┼───────────┐
    ▼           ▼           ▼
 HaloCanvas  trackPlayer  localStorage
 (Canvas 2D)  (Web Audio)  (library)
    │           │
    │     ┌─────┴─────┐
    │     ▼           ▼
    │  <audio>   SoundCloud widget
    │  (CDN)     (embed fallback)
    ▼
 LiquidArtworkLoader (Three.js — focused track only)
```

**Import flow:** oEmbed + SoundCloud resolve API → artwork URL, stream URL, tags → saved to library.

**Playback:** Hover/click triggers stream refresh if needed, then plays via `<audio>` with `crossOrigin="anonymous"` so the analyser can read frequency data. Tracks without a direct stream fall back to a hidden SoundCloud embed.

**Colors:** Cover art is loaded with CORS, sampled on a 48×48 grid (saturated mid-tones weighted), and cached as `accentColor` on each track.

## Tech stack

- [Vite 8](https://vite.dev/) + [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS 4](https://tailwindcss.com/)
- [Three.js](https://threejs.org/) / [React Three Fiber](https://docs.pmnd.rs/react-three-fiber) — liquid artwork shader
- [Cloudflare Workers](https://workers.cloudflare.com/) + Wrangler — hosting and SoundCloud proxy

## Project structure

```
src/
  realms/music/       Core player UI and audio engine
  library/            SoundCloud import, storage, artwork/color utils
  components/         Add-track panel, artwork image with fallbacks
  hooks/              Immersive search, artwork color preloading
worker/
  index.ts            Cloudflare Worker — API routes + static assets
functions/            Cloudflare Pages Functions (legacy/alternate deploy path)
```

## License

MIT
