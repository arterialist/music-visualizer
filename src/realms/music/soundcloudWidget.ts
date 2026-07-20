interface SoundCloudWidget {
  bind(event: string, listener: (...args: unknown[]) => void): void;
  unbind(event: string): void;
  load(url: string, options?: Record<string, unknown>): void;
  play(): void;
  pause(): void;
  seekTo(ms: number): void;
  getDuration(callback: (ms: number) => void): void;
  getPosition(callback: (ms: number) => void): void;
  isPaused(callback: (paused: boolean) => void): void;
}

interface SoundCloudGlobal {
  Widget: {
    new (iframe: HTMLIFrameElement): SoundCloudWidget;
    Events: {
      READY: string;
      PLAY: string;
      PAUSE: string;
      FINISH: string;
      PLAY_PROGRESS: string;
    };
  };
}

declare global {
  interface Window {
    SC?: SoundCloudGlobal;
  }
}

let scriptPromise: Promise<void> | null = null;
let iframe: HTMLIFrameElement | null = null;
let widget: SoundCloudWidget | null = null;
let activeUrl: string | null = null;

function loadScript(): Promise<void> {
  if (window.SC?.Widget) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://w.soundcloud.com/player/api.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("SoundCloud widget failed to load"));
    document.head.append(script);
  });
  return scriptPromise;
}

function ensureIframe(): HTMLIFrameElement {
  if (iframe) return iframe;
  iframe = document.createElement("iframe");
  iframe.src = "https://w.soundcloud.com/player/?url=about:blank";
  iframe.title = "SoundCloud player";
  iframe.allow = "autoplay";
  iframe.style.cssText =
    "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;bottom:0;left:0;border:0;";
  document.body.append(iframe);
  return iframe;
}

function waitForReady(w: SoundCloudWidget): Promise<void> {
  return new Promise((resolve) => {
    const onReady = () => {
      w.unbind(window.SC!.Widget.Events.READY);
      resolve();
    };
    w.bind(window.SC!.Widget.Events.READY, onReady);
  });
}

async function ensureWidget(): Promise<SoundCloudWidget> {
  await loadScript();
  if (!widget) {
    widget = new window.SC!.Widget(ensureIframe());
  }
  return widget;
}

export async function playSoundCloudEmbed(url: string, fromFocus = false): Promise<void> {
  const w = await ensureWidget();
  if (activeUrl !== url) {
    activeUrl = url;
    const ready = waitForReady(w);
    w.load(url, {
      auto_play: false,
      hide_related: true,
      show_comments: false,
      visual: false,
    });
    await ready;
  }
  if (fromFocus) {
    w.play();
    return;
  }
  w.isPaused((paused) => {
    if (paused) w.play();
  });
}

export function pauseSoundCloudEmbed(): void {
  widget?.pause();
}

export function stopSoundCloudEmbed(): void {
  widget?.pause();
  activeUrl = null;
}
