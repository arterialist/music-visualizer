import { useEffect } from "react";
import { preview } from "./trackPlayer";

export function useTrackAudio() {
  useEffect(
    () => () => {
      preview(null);
    },
    [],
  );

  return { preview };
}
