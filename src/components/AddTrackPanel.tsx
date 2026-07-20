import { useState } from "react";
import { importSoundCloudUrl, isSoundCloudUrl } from "../library/soundcloud";
import { addTrack } from "../library/storage";

interface AddTrackPanelProps {
  onImportingChange?: (importing: boolean) => void;
}

export default function AddTrackPanel({ onImportingChange }: AddTrackPanelProps) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const importUrl = async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (!isSoundCloudUrl(trimmed)) {
      setError("Paste a SoundCloud track URL");
      return;
    }
    setBusy(true);
    onImportingChange?.(true);
    setError(null);
    try {
      const track = await importSoundCloudUrl(trimmed);
      addTrack(track);
      setUrl("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
      onImportingChange?.(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Add SoundCloud track"
        className="fixed top-5 right-5 z-[70] flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-[#0a0c18aa] text-white/70 backdrop-blur-sm transition-colors hover:border-pink-300/50 hover:text-pink-200"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[65] flex items-start justify-center bg-[#04050d]/40 px-4 pt-24 backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
        >
          <form
            className="w-full max-w-md rounded-2xl border border-white/15 bg-[#0a0c18ee] p-5 shadow-[0_16px_70px_rgba(0,0,0,0.55)] backdrop-blur-xl"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void importUrl(url);
            }}
          >
            <div className="text-[10px] uppercase tracking-[0.28em] text-pink-100/60">
              add frequency
            </div>
            <p className="mt-2 text-sm text-white/55">
              Paste a SoundCloud link — plays as an embed, no upload needed.
            </p>
            <input
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData("text");
                if (isSoundCloudUrl(pasted)) {
                  e.preventDefault();
                  setUrl(pasted.trim());
                  void importUrl(pasted.trim());
                }
              }}
              placeholder="https://soundcloud.com/…"
              className="mt-4 w-full rounded-xl border border-white/15 bg-[#05060f] px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-pink-300/45"
            />
            {error && <p className="mt-2 text-xs text-red-300/90">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="cursor-pointer rounded-full px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/45 hover:text-white/70"
              >
                cancel
              </button>
              <button
                type="submit"
                disabled={busy || !url.trim()}
                className="cursor-pointer rounded-full border border-pink-300/40 bg-pink-300/10 px-4 py-2 text-xs uppercase tracking-[0.2em] text-pink-100 disabled:opacity-40"
              >
                {busy ? "tuning…" : "add track"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
