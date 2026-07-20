export const REALM_PINK = "#ff6ec7";

const SAMPLE_SIZE = 48;
const colorCache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

function pixelSaturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  if (max === 0) return 0;
  return (max - Math.min(r, g, b)) / max;
}

function pixelLuminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Weight saturated mid-tone pixels so dark/noisy covers still pick a visible accent. */
function extractFromImageData(data: Uint8ClampedArray): string {
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let weightSum = 0;

  let avgR = 0;
  let avgG = 0;
  let avgB = 0;
  let avgCount = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 128) continue;

    avgR += r;
    avgG += g;
    avgB += b;
    avgCount++;

    const lum = pixelLuminance(r, g, b);
    if (lum < 0.06 || lum > 0.94) continue;

    const sat = pixelSaturation(r, g, b);
    const weight = sat * sat + 0.12;
    rSum += r * weight;
    gSum += g * weight;
    bSum += b * weight;
    weightSum += weight;
  }

  if (weightSum > 0) {
    return rgbToHex(rSum / weightSum, gSum / weightSum, bSum / weightSum);
  }

  if (avgCount > 0) {
    return rgbToHex(avgR / avgCount, avgG / avgCount, avgB / avgCount);
  }

  return REALM_PINK;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`artwork load failed: ${url}`));
    img.src = url;
  });
}

function readDominantColor(img: HTMLImageElement): string {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return REALM_PINK;
  ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  return extractFromImageData(ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
}

export function getCachedArtworkColor(trackId: string): string | undefined {
  return colorCache.get(trackId);
}

export function cacheArtworkColor(trackId: string, color: string): void {
  colorCache.set(trackId, color);
}

export function extractDominantColor(artworkUrl: string): Promise<string> {
  const cached = colorCache.get(artworkUrl);
  if (cached) return Promise.resolve(cached);

  const pending = inflight.get(artworkUrl);
  if (pending) return pending;

  const task = loadImage(artworkUrl)
    .then((img) => {
      const color = readDominantColor(img);
      colorCache.set(artworkUrl, color);
      return color;
    })
    .catch(() => REALM_PINK)
    .finally(() => {
      inflight.delete(artworkUrl);
    });

  inflight.set(artworkUrl, task);
  return task;
}

/** Hue of a hex color, 0..360. Greyscale returns realm pink hue. */
export function hueOf(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 320;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
