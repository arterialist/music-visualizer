import { useEffect, useState } from "react";

const SEARCH_IDLE_MS = 2400;

/**
 * Immersive search: start typing anywhere and non-matching orbs fade out.
 * Escape clears; Backspace trims. Ignores when focus is in an input.
 */
export function useImmersiveSearch() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(false);
  const [lastInputAt, setLastInputAt] = useState(0);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      if (e.key === "Escape") {
        setQuery("");
        setActive(false);
        return;
      }

      if (e.key === "Backspace") {
        e.preventDefault();
        setQuery((q) => {
          const next = q.slice(0, -1);
          setActive(next.length > 0);
          return next;
        });
        setLastInputAt(Date.now());
        return;
      }

      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setQuery((q) => q + e.key);
        setActive(true);
        setLastInputAt(Date.now());
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!active || !query) return;
    const timer = window.setTimeout(() => setActive(false), SEARCH_IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [query, active, lastInputAt]);

  return { query, active, clear: () => { setQuery(""); setActive(false); } };
}
