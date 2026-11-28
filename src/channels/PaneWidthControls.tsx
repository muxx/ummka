import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
} from "react";
import type { EntryLanguage } from "../entry/language.ts";
import type { PaneWidthKey } from "./pane-widths.ts";

const copy = {
  en: {
    navigation: "Navigation pane width",
    right: "Side pane width",
    widen: "Expand panel",
    restore: "Restore narrow panel",
    size: (width: number) => `${width} pixels`,
    storage: "Couldn’t save or load pane widths on this device.",
    drag: "Drag to resize. Double-click to reset.",
  },
  ru: {
    navigation: "Ширина списка каналов",
    right: "Ширина правой панели",
    widen: "Развернуть панель",
    restore: "Вернуть узкую панель",
    size: (width: number) => `${width} пикселей`,
    storage:
      "Не удалось сохранить или прочитать ширину панелей на этом устройстве.",
    drag: "Потяните за границу. Двойной щелчок вернёт исходную ширину.",
  },
} as const;

export function PaneWidthNotice({ language }: { language: EntryLanguage }) {
  return (
    <p className="pane-width-notice" role="status">
      {copy[language].storage}
    </p>
  );
}

export const PaneExpansion = createContext<{
  language: EntryLanguage;
  expanded: boolean;
  toggle: () => void;
} | null>(null);

const expandPaths = [
  "M16 4l4 0l0 4",
  "M14 10l6 -6",
  "M8 20l-4 0l0 -4",
  "M4 20l6 -6",
  "M16 20l4 0l0 -4",
  "M14 14l6 6",
  "M8 4l-4 0l0 4",
  "M4 4l6 6",
];
const restorePaths = [
  "M5 9l4 0l0 -4",
  "M3 3l6 6",
  "M5 15l4 0l0 4",
  "M3 21l6 -6",
  "M19 9l-4 0l0 -4",
  "M15 9l6 -6",
  "M19 15l-4 0l0 4",
  "M15 15l6 6",
];

export function PaneSizeToggle() {
  const pane = useContext(PaneExpansion);
  if (!pane) return null;
  const text = copy[pane.language];
  const label = pane.expanded ? text.restore : text.widen;
  return (
    <button
      type="button"
      className="channels-icon-action pane-header-action pane-size-toggle"
      data-pane-width-control="right"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.currentTarget.focus({ preventScroll: true });
        pane.toggle();
      }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {(pane.expanded ? restorePaths : expandPaths).map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </button>
  );
}

type Range = { width: number; min: number; max: number };
type Drag = {
  pointer: number;
  start: number;
  width: number;
  direction: number;
  clientX: number;
  frame: number | undefined;
};
type Props = {
  pane: PaneWidthKey;
  range: Range;
  language: EntryLanguage;
  preview: (next?: { key: PaneWidthKey; width: number }) => void;
  save: (key: PaneWidthKey, width: number | null) => void;
};

export function PaneResizer({ pane, range, language, preview, save }: Props) {
  const drag = useRef<Drag | undefined>(undefined);
  const navigation = pane === "navigation";
  const clamp = (width: number) =>
    Math.round(Math.min(range.max, Math.max(range.min, width)));
  const direction = (target: HTMLElement) =>
    (getComputedStyle(target).direction === "rtl" ? -1 : 1) *
    (navigation ? 1 : -1);
  const widthAt = (current: Drag) =>
    clamp(
      current.width + current.direction * (current.clientX - current.start),
    );
  const widthAtFrame = useRef(widthAt);
  useLayoutEffect(() => {
    widthAtFrame.current = widthAt;
  });
  const takeDrag = useCallback(() => {
    const current = drag.current;
    drag.current = undefined;
    if (current?.frame !== undefined) cancelAnimationFrame(current.frame);
    return current;
  }, []);
  useLayoutEffect(
    () => () => {
      if (takeDrag()) preview();
    },
    [preview, takeDrag],
  );
  const text = copy[language];
  return (
    <hr
      tabIndex={0}
      className="pane-resizer"
      data-pane-width-control={navigation ? "navigation" : "right"}
      aria-label={navigation ? text.navigation : text.right}
      aria-orientation="vertical"
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      aria-valuenow={range.width}
      aria-valuetext={text.size(range.width)}
      title={text.drag}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0 || drag.current) return;
        event.preventDefault();
        const target = event.currentTarget;
        target.focus({ preventScroll: true });
        target.setPointerCapture(event.pointerId);
        drag.current = {
          pointer: event.pointerId,
          start: event.clientX,
          width: range.width,
          direction: direction(target),
          clientX: event.clientX,
          frame: undefined,
        };
        target.setAttribute("data-dragging", "");
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.pointer !== event.pointerId) return;
        current.clientX = event.clientX;
        if (current.frame !== undefined) return;
        current.frame = requestAnimationFrame(() => {
          current.frame = undefined;
          preview({ key: pane, width: widthAtFrame.current(current) });
        });
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointer !== event.pointerId) return;
        const current = takeDrag();
        if (!current) return;
        event.currentTarget.removeAttribute("data-dragging");
        current.clientX = event.clientX;
        const width = widthAt(current);
        if (event.clientX === current.start || width === current.width)
          preview();
        else save(pane, width);
      }}
      onLostPointerCapture={(event) => {
        if (drag.current?.pointer !== event.pointerId) return;
        takeDrag();
        event.currentTarget.removeAttribute("data-dragging");
        preview();
      }}
      onKeyDown={(event) => {
        if (drag.current) return;
        let next: number;
        switch (event.key) {
          case "Home":
            next = range.min;
            break;
          case "End":
            next = range.max;
            break;
          case "ArrowLeft":
          case "ArrowRight": {
            const sign = event.key === "ArrowLeft" ? -1 : 1;
            const step = event.shiftKey ? 48 : 16;
            next = clamp(
              range.width + sign * direction(event.currentTarget) * step,
            );
            break;
          }
          default:
            return;
        }
        event.preventDefault();
        if (next !== range.width) save(pane, next);
      }}
      onDoubleClick={() => save(pane, null)}
    />
  );
}
