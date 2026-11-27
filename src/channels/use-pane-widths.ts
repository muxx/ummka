import { type RefObject, useLayoutEffect, useState } from "react";
import {
  devicePaneWidths,
  type PaneWidthChoices,
  type PaneWidthKey,
  type PaneWidthMode,
  paneGeometry,
} from "./pane-widths.ts";

export function usePaneWidths(
  frame: RefObject<HTMLElement | null>,
  mode: PaneWidthMode,
) {
  const [width, setWidth] = useState(0);
  const [choices, setChoices] = useState<PaneWidthChoices>({});
  const [preview, setPreview] = useState<{
    key: PaneWidthKey;
    width: number;
  }>();
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [expanded, setExpanded] = useState({ right: false, thread: true });

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

  const panelKey = mode === "thread" ? "thread" : "right";
  const geometry = paneGeometry(
    width,
    preview ? { ...choices, [preview.key]: preview.width } : choices,
    mode,
  );
  function save(key: PaneWidthKey, width: number | null) {
    setPreview(undefined);
    setChoices((old) => {
      const next = { ...old };
      if (width === null) delete next[key];
      else next[key] = width;
      return next;
    });
    try {
      devicePaneWidths(window.localStorage).set(key, width);
      setStorageUnavailable(false);
    } catch {
      setStorageUnavailable(true);
    }
  }
  return {
    geometry,
    panelKey,
    storageUnavailable,
    expanded: expanded[panelKey],
    toggleExpanded: () =>
      setExpanded((old) => ({ ...old, [panelKey]: !old[panelKey] })),
    setPreview,
    save,
  } as const;
}
