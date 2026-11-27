import { type RefObject, useLayoutEffect, useState } from "react";
import {
  devicePaneWidths,
  type PaneWidthChoices,
  type PaneWidthMode,
  paneGeometry,
} from "./pane-widths.ts";

export function usePaneWidths(
  frame: RefObject<HTMLElement | null>,
  mode: PaneWidthMode,
) {
  const [width, setWidth] = useState(0);
  const [choices, setChoices] = useState<PaneWidthChoices>({});
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  useLayoutEffect(() => {
    const node = frame.current;
    if (!node) return;
    function restore(event?: StorageEvent) {
      if (event?.key && !event.key.startsWith("ummka.layout.width.")) return;
      try {
        setChoices(devicePaneWidths(window.localStorage).read());
        setStorageUnavailable(false);
      } catch {
        setStorageUnavailable(true);
      }
    }
    const measure = () => setWidth(node.clientWidth);
    const observer = new ResizeObserver(measure);
    measure();
    restore();
    observer.observe(node);
    window.addEventListener("storage", restore);
    return () => {
      observer.disconnect();
      window.removeEventListener("storage", restore);
    };
  }, [frame]);

  return { geometry: paneGeometry(width, choices, mode), storageUnavailable };
}
