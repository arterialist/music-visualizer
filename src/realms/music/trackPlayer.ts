import { useSyncExternalStore } from "react";
import type { MusicTrack } from "../../types";
import { directAudioUrl } from "../../library/audioProxy";
import { addTrack } from "../../library/storage";
import { refreshTrackStream } from "../../library/soundcloud";
import {
  pauseSoundCloudEmbed,
  playSoundCloudEmbed,
  stopSoundCloudEmbed,
} from "./soundcloudWidget";

/**
 * Module-level singleton player: the <audio> element lives outside React so
 * a "pinned" track keeps playing while the visitor wanders other realms.
 * Playback positions are remembered per track so switching back resumes.
 */

/** 30 log-spaced display bands, plus four resolved bass resonances. */
export const BAND_COUNT = 30;
export const DEEP_PEAK_COUNT = 4;
export const WOB_WAVE_COUNT = 6;
const MIN_BAND_HZ = 25;
const MAX_BAND_HZ = 16_000;
const MAX_DEEP_HZ = 320;
const WOB_MIN_HZ = 90;
const WOB_MAX_HZ = 260;
const WOB_WAVE_LIFETIME = 1.65;
let bandEdges: number[] = [];
let bandCenters: number[] = [];

function rebuildBandLayout(sampleRate: number, fftSize: number) {
  const binHz = sampleRate / fftSize;
  const edges: number[] = [];
  for (let i = 0; i <= BAND_COUNT; i++) {
    const hz = Math.exp(
      Math.log(MIN_BAND_HZ) +
        (Math.log(MAX_BAND_HZ) - Math.log(MIN_BAND_HZ)) * (i / BAND_COUNT),
    );
    edges.push(Math.round(hz / binHz));
  }
  const maxBin = fftSize / 2;
  for (let i = 1; i < edges.length; i++) {
    edges[i] = Math.min(maxBin, Math.max(edges[i], edges[i - 1] + 1));
  }
  bandEdges = edges;
  bandCenters = edges.slice(0, -1).map((from, i) => ((from + edges[i + 1]) * binHz) / 2);
}

export interface VisualState {
  /** auto-gained energy 0..1 per band (low → high) */
  energy: Float32Array;
  /** stereo balance -1 (left) .. +1 (right) per band */
  balance: Float32Array;
  /** transient punch 0..1 per band (spectral flux, auto-gained) */
  punch: Float32Array;
  /** 0 tonal/smooth (piano, clean sub) .. 1 noisy/buzzy (gritty bass) */
  buzz: number;
  /** 0 static bass .. 1 strong LFO wobble ("wob wob") */
  wobble: number;
  /** short sub-bass impact, kept separate from the sustained wob body */
  kick: number;
  /** Four strongest resolved peaks from 25–320 Hz, frequency log-normalized. */
  deepFrequency: Float32Array;
  deepEnergy: Float32Array;
  deepPunch: Float32Array;
  deepBalance: Float32Array;
  /** Only the most forceful sub-85 Hz transients bend the whole field. */
  deepWarp: number;
  /** Independently aging deep-beat pressure fronts. */
  waveFrequency: Float32Array;
  waveStrength: Float32Array;
  waveAge: Float32Array;
}

interface PlayerState {
  track: MusicTrack | null;
  pinned: boolean;
  loading: boolean;
}

let state: PlayerState = { track: null, pinned: false, loading: false };
const listeners = new Set<() => void>();

function setState(patch: Partial<PlayerState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function usePlayerState(): PlayerState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

let el: HTMLAudioElement | null = null;
let analyserL: AnalyserNode | null = null;
let analyserR: AnalyserNode | null = null;
let binsL: Uint8Array<ArrayBuffer> | null = null;
let binsR: Uint8Array<ArrayBuffer> | null = null;
let prevMono: Float32Array | null = null;
let monoBins: Float32Array | null = null;
let fluxBins: Float32Array | null = null;
let fadeTimer: number | null = null;
type SavedPosition = { segmentIndex: number; time: number };
const positions = new Map<string, SavedPosition>();
let activeTrackId: string | null = null;
let activeSources: string[] = [];
let activeSegmentIndex = 0;
let segmentPreloader: HTMLAudioElement | null = null;
let sourceGeneration = 0;

const ePeaks = new Float32Array(BAND_COUNT).fill(0.12);
const fluxPeaks = new Float32Array(BAND_COUNT).fill(0.05);
const visual: VisualState = {
  energy: new Float32Array(BAND_COUNT),
  balance: new Float32Array(BAND_COUNT),
  punch: new Float32Array(BAND_COUNT),
  buzz: 0,
  wobble: 0,
  kick: 0,
  deepFrequency: new Float32Array(DEEP_PEAK_COUNT),
  deepEnergy: new Float32Array(DEEP_PEAK_COUNT),
  deepPunch: new Float32Array(DEEP_PEAK_COUNT),
  deepBalance: new Float32Array(DEEP_PEAK_COUNT),
  deepWarp: 0,
  waveFrequency: new Float32Array(WOB_WAVE_COUNT),
  waveStrength: new Float32Array(WOB_WAVE_COUNT),
  waveAge: new Float32Array(WOB_WAVE_COUNT),
};
// bass-envelope history for wobble ("wob wob") detection
const bassHist = new Float32Array(48);
let bassHistIdx = 0;
let resonantWobBody = 0;
let deepFluxPeak = 0.04;
const waveStartedAt = new Float64Array(WOB_WAVE_COUNT).fill(-Infinity);
const waveStoredFrequency = new Float32Array(WOB_WAVE_COUNT);
const waveStoredStrength = new Float32Array(WOB_WAVE_COUNT);
let wobOnsetLatched = false;
let nextWaveSlot = 0;

const streamCache = new Map<string, { url: string; at: number }>();
const STREAM_CACHE_MS = 45 * 60 * 1000;
let previewGeneration = 0;

async function playableTrack(track: MusicTrack): Promise<MusicTrack> {
  const cached = streamCache.get(track.id);
  if (cached && Date.now() - cached.at < STREAM_CACHE_MS) {
    return { ...track, audioUrl: cached.url };
  }

  const fresh = await refreshTrackStream(track);
  if (fresh.audioUrl) {
    streamCache.set(track.id, { url: fresh.audioUrl, at: Date.now() });
    addTrack(fresh);
    return fresh;
  }
  return track;
}

function sourcesFor(track: MusicTrack): string[] {
  return track.previewUrl
    ? [track.previewUrl]
    : track.audioSegments?.length
      ? track.audioSegments
      : track.audioUrl
        ? [track.audioUrl]
        : [];
}

function beginPreview(track: MusicTrack, sources: string[]) {
  const a = ensureElement();
  pauseSoundCloudEmbed();
  if (state.pinned && state.track && state.track.id !== track.id) {
    setState({ pinned: false });
  }
  ensureAnalyser();
  const absoluteSources = sources.map(
    (source) => directAudioUrl(new URL(source, location.origin).href) ?? source,
  );
  const sourcesChanged =
    absoluteSources.length !== activeSources.length ||
    absoluteSources.some((source, index) => source !== activeSources[index]);
  if (activeTrackId !== track.id || sourcesChanged) {
    saveActivePosition();
    bassHist.fill(0);
    bassHistIdx = 0;
    resonantWobBody = 0;
    wobOnsetLatched = false;
    prevMono?.fill(0);
    activeTrackId = track.id;
    activeSources = absoluteSources;
    const saved = positions.get(track.id) ?? { segmentIndex: 0, time: 0 };
    loadSegment(saved.segmentIndex, saved.time, false);
  }
  setState({ track });
  void a.play().catch(() => undefined);
  fadeTo(1);
}

function ensureElement(): HTMLAudioElement {
  if (!el) {
    el = new Audio();
    el.crossOrigin = "anonymous";
    el.loop = false;
    el.preload = "auto";
    el.volume = 0;
    const markLoading = () => {
      if (state.track) setState({ loading: true });
    };
    const markReady = () => setState({ loading: false });
    el.addEventListener("loadstart", markLoading);
    el.addEventListener("waiting", markLoading);
    el.addEventListener("stalled", markLoading);
    el.addEventListener("seeking", markLoading);
    el.addEventListener("canplay", markReady);
    el.addEventListener("playing", markReady);
    el.addEventListener("seeked", markReady);
    el.addEventListener("error", markReady);
    el.addEventListener("ended", () => {
      if (!activeSources.length) return;
      const nextIndex = (activeSegmentIndex + 1) % activeSources.length;
      loadSegment(nextIndex, 0, true);
    });
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__player = {
        el,
        visual: () => getVisual(),
      };
    }
  }
  return el;
}

function saveActivePosition() {
  if (!el || !activeTrackId || !activeSources.length) return;
  positions.set(activeTrackId, {
    segmentIndex: activeSegmentIndex,
    time: Number.isFinite(el.currentTime) ? el.currentTime : 0,
  });
}

function preloadFollowingSegment() {
  if (activeSources.length < 2) return;
  const nextIndex = (activeSegmentIndex + 1) % activeSources.length;
  if (!segmentPreloader) {
    segmentPreloader = new Audio();
    segmentPreloader.preload = "auto";
  }
  segmentPreloader.src = activeSources[nextIndex];
  segmentPreloader.load();
}

function loadSegment(index: number, time: number, autoplay: boolean) {
  const audio = ensureElement();
  const generation = ++sourceGeneration;
  activeSegmentIndex = Math.max(0, Math.min(index, activeSources.length - 1));
  const source = activeSources[activeSegmentIndex];
  if (!source) return;

  if (audio.src !== source) {
    setState({ loading: true });
    audio.src = source;
    if (time > 0) {
      audio.addEventListener(
        "loadedmetadata",
        () => {
          if (generation !== sourceGeneration) return;
          const maximum = Number.isFinite(audio.duration)
            ? Math.max(0, audio.duration - 0.05)
            : time;
          audio.currentTime = Math.min(time, maximum);
        },
        { once: true },
      );
    }
  } else {
    audio.currentTime = Math.max(0, time);
  }

  preloadFollowingSegment();
  if (autoplay) void audio.play().catch(() => undefined);
}

let audioCtx: AudioContext | null = null;

// dev only: without this, every hot reload of this module leaks a live
// AudioContext holding the old element captive — playback goes silent
// until a full page reload
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    el?.pause();
    void audioCtx?.close();
  });
}

function ensureAnalyser() {
  const a = ensureElement();
  if (analyserL) {
    // The analyser is often initialized by pointer hover, which is not a
    // playback gesture. Chrome leaves that AudioContext suspended; retrying
    // resume here lets the subsequent click actually open the routed output.
    void audioCtx?.resume();
    return;
  }
  try {
    const ctx = new AudioContext();
    audioCtx = ctx;
    const src = ctx.createMediaElementSource(a);
    src.connect(ctx.destination); // playback path, full stereo
    const splitter = ctx.createChannelSplitter(2);
    src.connect(splitter);
    const mk = () => {
      const an = ctx.createAnalyser();
      // 4096 resolves ~11 Hz at 44.1 kHz, enough to distinguish this track's
      // 43–46 Hz sub impacts from its 65–73 Hz bass and 113–151 Hz body.
      an.fftSize = 4096;
      // low smoothing: we need raw frames for spectral flux (punch);
      // visual smoothing happens on our side
      an.smoothingTimeConstant = 0.45;
      return an;
    };
    analyserL = mk();
    analyserR = mk();
    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);
    binsL = new Uint8Array(analyserL.frequencyBinCount);
    binsR = new Uint8Array(analyserR.frequencyBinCount);
    prevMono = new Float32Array(analyserL.frequencyBinCount);
    monoBins = new Float32Array(analyserL.frequencyBinCount);
    fluxBins = new Float32Array(analyserL.frequencyBinCount);
    rebuildBandLayout(ctx.sampleRate, analyserL.fftSize);
    void ctx.resume();
  } catch {
    /* analyser is progressive enhancement only */
  }
}

function fadeTo(target: number, thenPause = false) {
  const a = ensureElement();
  if (fadeTimer) window.clearInterval(fadeTimer);
  fadeTimer = window.setInterval(() => {
    const dv = target - a.volume;
    if (Math.abs(dv) < 0.04) {
      a.volume = target;
      if (thenPause) a.pause();
      window.clearInterval(fadeTimer!);
    } else {
      a.volume += dv * 0.25;
    }
  }, 50);
}

/** play a track (or fade out with null — unless a pin is holding it) */
export function preview(track: MusicTrack | null) {
  const a = ensureElement();
  if (!track) {
    previewGeneration++;
    if (state.pinned && state.track) return; // pinned: keep playing
    setState({ track: null, loading: false });
    stopSoundCloudEmbed();
    fadeTo(0, true);
    return;
  }

  const generation = ++previewGeneration;
  setState({ track, loading: true });

  void (async () => {
    try {
      const ready = await playableTrack(track);
      if (generation !== previewGeneration) return;

      const sources = sourcesFor(ready);
      if (!sources.length) {
        setState({ track: ready, loading: true });
        await playSoundCloudEmbed(ready.soundcloudUrl, true);
        if (generation !== previewGeneration) return;
        setState({ loading: false });
        fadeTo(0, true);
        a.pause();
        return;
      }

      if (generation !== previewGeneration) return;
      setState({ loading: false });
      beginPreview(ready, sources);
    } catch {
      if (generation !== previewGeneration) return;
      setState({ loading: false });
    }
  })();
}

export function togglePin() {
  if (!state.track) return;
  setState({ pinned: !state.pinned });
}

/** unpin and fade out — the mini-player's stop button */
export function stopPinned() {
  setState({ pinned: false, track: null, loading: false });
  stopSoundCloudEmbed();
  fadeTo(0, true);
}

/**
 * Live audio features for the visuals. Computed fresh per call (call once
 * per rAF): per-band energy/stereo-balance/transient-punch, plus global
 * buzz (spectral flatness — noisy vs tonal) and bass wobble (LFO depth).
 */
export function getVisual(): VisualState {
  // ?fakeaudio=1: synthetic bands for tuning visuals without sound
  if (location.search.includes("fakeaudio=1")) {
    const t = performance.now() / 1000;
    for (let b = 0; b < BAND_COUNT; b++) {
      const ph = b * 0.7;
      visual.energy[b] = Math.max(
        0,
        0.45 + 0.5 * Math.sin(t * (0.9 + b * 0.13) + ph) - b * 0.006,
      );
      visual.balance[b] = Math.sin(t * 0.5 + b * 1.3) * 0.7;
      visual.punch[b] = Math.max(0, Math.sin(t * 3.1 + ph * 2.0)) ** 8;
    }
    visual.buzz = 0.5 + 0.5 * Math.sin(t * 0.4);
    visual.wobble = 0.5 + 0.5 * Math.sin(t * 0.23 + 2);
    visual.kick = Math.max(0, Math.sin(t * 2.1)) ** 10;
    visual.deepWarp = visual.kick;
    for (let i = 0; i < DEEP_PEAK_COUNT; i++) {
      visual.deepFrequency[i] = [0.22, 0.42, 0.68, 0.86][i];
      visual.deepEnergy[i] = Math.max(0, Math.sin(t * (1.4 + i * 0.17) + i)) ** 4;
      visual.deepPunch[i] = Math.max(0, Math.sin(t * 2.1 + i * 0.8)) ** 10;
      visual.deepBalance[i] = Math.sin(t * 0.4 + i * 1.7) * 0.55;
    }
    for (let i = 0; i < WOB_WAVE_COUNT; i++) {
      const age = (t + i * 0.31) % 2.15;
      visual.waveFrequency[i] = 0.2 + (i % 3) * 0.1;
      visual.waveAge[i] = age;
      visual.waveStrength[i] = age < 1.55 ? (1 - age / 1.55) * (0.78 - (i % 3) * 0.08) : 0;
    }
    return visual;
  }
  if (
    !analyserL ||
    !analyserR ||
    !binsL ||
    !binsR ||
    !prevMono ||
    !monoBins ||
    !fluxBins ||
    !el ||
    el.paused
  ) {
    visual.energy.fill(0);
    visual.punch.fill(0);
    visual.balance.fill(0);
    visual.buzz = 0;
    visual.wobble = 0;
    visual.kick = 0;
    visual.deepEnergy.fill(0);
    visual.deepPunch.fill(0);
    visual.deepBalance.fill(0);
    visual.deepWarp = 0;
    visual.waveStrength.fill(0);
    visual.waveAge.fill(0);
    resonantWobBody = 0;
    wobOnsetLatched = false;
    bassHist.fill(0);
    bassHistIdx = 0;
    prevMono?.fill(0);
    return visual;
  }
  analyserL.getByteFrequencyData(binsL);
  analyserR.getByteFrequencyData(binsR);

  for (let j = 0; j < monoBins.length; j++) {
    const mono = (binsL[j] + binsR[j]) / 510;
    fluxBins[j] = Math.max(0, mono - prevMono[j]);
    monoBins[j] = mono;
    prevMono[j] = mono;
  }

  for (let b = 0; b < BAND_COUNT; b++) {
    const from = bandEdges[b];
    const to = bandEdges[b + 1];
    let sl = 0;
    let sr = 0;
    let flux = 0;
    for (let j = from; j < to; j++) {
      const l = binsL[j] / 255;
      const r = binsR[j] / 255;
      sl += l;
      sr += r;
      flux += fluxBins[j];
    }
    const n = to - from;
    const eL = sl / n;
    const eR = sr / n;
    const raw = (eL + eR) / 2;
    ePeaks[b] = Math.max(raw, ePeaks[b] * 0.9985, 0.08);
    // auto-gain for visibility, but weighted by absolute loudness so a
    // full mix doesn't pin every band at 1.0 and white out the field
    visual.energy[b] =
      Math.min(1, raw / ePeaks[b]) *
      (0.3 + 0.7 * Math.min(1, ePeaks[b] * 2.4));
    visual.balance[b] =
      eL + eR > 0.02 ? Math.max(-1, Math.min(1, (eR - eL) / (eL + eR))) : 0;
    const rawFlux = flux / n;
    fluxPeaks[b] = Math.max(rawFlux, fluxPeaks[b] * 0.997, 0.03);
    visual.punch[b] = Math.min(1, rawFlux / fluxPeaks[b]);
  }

  // Resolve the strongest simultaneous bass resonances instead of collapsing
  // the entire bottom end into one scalar. Non-maximum suppression keeps a
  // broad note from occupying every slot with adjacent FFT bins.
  const binHz = audioCtx!.sampleRate / analyserL.fftSize;
  const deepFrom = Math.max(1, Math.ceil(MIN_BAND_HZ / binHz));
  const deepTo = Math.min(monoBins.length - 2, Math.floor(MAX_DEEP_HZ / binHz));
  const candidates: Array<{ bin: number; score: number }> = [];
  let frameFluxPeak = 0;
  for (let j = deepFrom; j <= deepTo; j++) {
    const energy = monoBins[j];
    const flux = fluxBins[j];
    frameFluxPeak = Math.max(frameFluxPeak, flux);
    if (energy < monoBins[j - 1] || energy < monoBins[j + 1]) continue;
    const hz = j * binHz;
    const depth = 1 - Math.log(hz / MIN_BAND_HZ) / Math.log(MAX_DEEP_HZ / MIN_BAND_HZ);
    candidates.push({
      bin: j,
      score: energy * (0.45 + flux * 4.0) * (0.85 + depth * 0.3),
    });
  }
  deepFluxPeak = Math.max(0.035, frameFluxPeak, deepFluxPeak * 0.996);
  candidates.sort((a, b) => b.score - a.score);
  const chosen: typeof candidates = [];
  for (const candidate of candidates) {
    if (chosen.every((other) => Math.abs(other.bin - candidate.bin) * binHz >= 18)) {
      chosen.push(candidate);
      if (chosen.length === DEEP_PEAK_COUNT) break;
    }
  }
  let deepestImpact = 0;
  for (let i = 0; i < DEEP_PEAK_COUNT; i++) {
    const peak = chosen[i];
    if (!peak) {
      visual.deepEnergy[i] = 0;
      visual.deepPunch[i] = 0;
      visual.deepBalance[i] = 0;
      continue;
    }
    const hz = peak.bin * binHz;
    const energy = Math.max(0, Math.min(1, (monoBins[peak.bin] - 0.08) * 1.35));
    const punch = Math.max(0, Math.min(1, fluxBins[peak.bin] / deepFluxPeak));
    visual.deepFrequency[i] = Math.max(
      0,
      Math.min(1, Math.log(hz / MIN_BAND_HZ) / Math.log(MAX_DEEP_HZ / MIN_BAND_HZ)),
    );
    visual.deepEnergy[i] = energy;
    visual.deepPunch[i] = punch;
    const left = binsL[peak.bin] / 255;
    const right = binsR[peak.bin] / 255;
    visual.deepBalance[i] =
      left + right > 0.02 ? Math.max(-1, Math.min(1, (right - left) / (left + right))) : 0;
    if (hz < 85) {
      const depth = 1 - (hz - MIN_BAND_HZ) / (85 - MIN_BAND_HZ);
      deepestImpact = Math.max(deepestImpact, energy * punch * (0.55 + depth * 0.75));
    }
  }
  visual.deepWarp = Math.max(0, Math.min(1, (deepestImpact - 0.08) * 1.75));

  const now = performance.now();
  const wobPeak = candidates.find(({ bin }) => {
    const hz = bin * binHz;
    return hz >= WOB_MIN_HZ && hz <= WOB_MAX_HZ;
  });

  // buzz: spectral flatness over the mid/high spectrum (geo/arith mean).
  // noise (gritty bass, cymbal wash) → 1; tonal (piano, clean sub) → 0
  let logSum = 0;
  let sum = 0;
  let cnt = 0;
  const buzzFrom = Math.max(1, Math.round(130 / binHz));
  const buzzTo = Math.min(monoBins.length, Math.round(16_000 / binHz));
  for (let j = buzzFrom; j < buzzTo; j++) {
    const v = (binsL[j] + binsR[j]) / 510 + 1e-4;
    logSum += Math.log(v);
    sum += v;
    cnt++;
  }
  const flatness = Math.exp(logSum / cnt) / (sum / cnt);
  visual.buzz = Math.max(0, Math.min(1, (flatness - 0.15) * 2.2));

  // A kick is a brief sub-band impact. It remains its own visual signal so
  // it cannot consume the slower spatial bloom reserved for wob resonance.
  visual.kick = Math.max(0, Math.min(1, deepestImpact * 1.3));

  const energyInRange = (minHz: number, maxHz: number) => {
    let total = 0;
    let count = 0;
    for (let i = 0; i < BAND_COUNT; i++) {
      if (bandCenters[i] >= minHz && bandCenters[i] <= maxHz) {
        total += visual.energy[i];
        count++;
      }
    }
    return count ? total / count : 0;
  };

  // wobble: oscillation depth of the bass envelope over ~0.8s.
  // "wob wob" LFOs swing the envelope; static sub keeps it flat
  // Include the bass/growl range that the track analysis found around
  // 55–220 Hz, without letting the wider midrange drive detection.
  const bassNow = energyInRange(55, 220);
  bassHist[bassHistIdx] = bassNow;
  bassHistIdx = (bassHistIdx + 1) % bassHist.length;
  let mean = 0;
  for (let i = 0; i < bassHist.length; i++) mean += bassHist[i];
  mean /= bassHist.length;
  let swings = 0;
  let above = bassHist[bassHistIdx] > mean;
  let dev = 0;
  for (let i = 0; i < bassHist.length; i++) {
    const v = bassHist[(bassHistIdx + i) % bassHist.length];
    dev += Math.abs(v - mean);
    const nowAbove = v > mean + (above ? -0.06 : 0.06);
    if (nowAbove !== above) {
      swings++;
      above = nowAbove;
    }
  }
  dev /= bassHist.length;
  // A real wob needs repeated envelope direction changes. Keep a small visual
  // response for non-oscillating bass, but do not let a single silence→sound
  // edge qualify for wave emission.
  const hasWobOscillation = swings >= 2 && swings <= 14;
  const lfoWobble = dev * 9 * (hasWobOscillation ? 1 : 0.25) * (mean > 0.18 ? 1 : 0);
  const verifiedLfoWobble = dev * 9 * (hasWobOscillation && mean > 0.18 ? 1 : 0);
  // A dubstep wob body can be a sustained low-mid resonance after the sub
  // kick, rather than a second bass transient. Compare explicit frequency
  // ranges, then smooth heavily to reject frame-to-frame peak flicker.
  const sub = energyInRange(25, 85);
  const lowMid = energyInRange(90, 260);
  const bodyTarget = Math.max(0, Math.min(1, (lowMid - sub * 0.32 - 0.02) * 2.8));
  resonantWobBody +=
    (bodyTarget - resonantWobBody) * (bodyTarget > resonantWobBody ? 0.16 : 0.035);
  visual.wobble = Math.max(0, Math.min(1, Math.max(lfoWobble, resonantWobBody)));

  // Wave emission requires verified LFO motion plus a resonant low-mid body.
  // A broadband onset can raise bodyTarget, but it cannot manufacture the two
  // envelope swings required here. Hysteresis groups a wob phrase into one
  // event; the event pool still lets separate phrases overlap in space.
  const wobGate = Math.min(1, verifiedLfoWobble * (0.58 + bodyTarget * 0.42));
  if (!wobOnsetLatched && wobGate > 0.34 && bodyTarget > 0.2 && wobPeak) {
    const hz = wobPeak.bin * binHz;
    const energy = Math.max(0, Math.min(1, (monoBins[wobPeak.bin] - 0.08) * 1.35));
    let launched = false;
    for (let offset = 0; offset < WOB_WAVE_COUNT; offset++) {
      const slot = (nextWaveSlot + offset) % WOB_WAVE_COUNT;
      const slotAge = (now - waveStartedAt[slot]) / 1000;
      if (slotAge < WOB_WAVE_LIFETIME) continue;
      waveStartedAt[slot] = now;
      waveStoredFrequency[slot] = Math.max(
        0,
        Math.min(1, Math.log(hz / MIN_BAND_HZ) / Math.log(MAX_DEEP_HZ / MIN_BAND_HZ)),
      );
      waveStoredStrength[slot] = Math.max(
        0.34,
        Math.min(1, wobGate * 0.82 + bodyTarget * 0.3 + energy * 0.12),
      );
      nextWaveSlot = (slot + 1) % WOB_WAVE_COUNT;
      launched = true;
      break;
    }
    wobOnsetLatched = launched;
  } else if (wobGate < 0.12 || bodyTarget < 0.12) {
    wobOnsetLatched = false;
  }

  for (let i = 0; i < WOB_WAVE_COUNT; i++) {
    const age = (now - waveStartedAt[i]) / 1000;
    visual.waveFrequency[i] = waveStoredFrequency[i];
    visual.waveAge[i] = age;
    visual.waveStrength[i] =
      age >= 0 && age < WOB_WAVE_LIFETIME
        ? waveStoredStrength[i] * (1 - age / WOB_WAVE_LIFETIME)
        : 0;
  }

  return visual;
}
