import type { ReactNode } from "react";
import { PaneSizeToggle } from "./PaneWidthControls.tsx";
import "./collection-header.css";

export function CollectionHeader({
  icon,
  children,
  caption,
  compact,
  closeLabel,
  close,
}: {
  icon: ReactNode;
  children: ReactNode;
  caption: ReactNode;
  compact: boolean;
  closeLabel: string;
  close: () => void;
}) {
  const closeButton = (
    <button
      key="close"
      type="button"
      className="channels-icon-action collection-close"
      aria-label={closeLabel}
      title={closeLabel}
      onClick={close}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={compact ? "m12 5-7 7 7 7M5 12h15" : "m6 6 12 12M18 6 6 18"} />
      </svg>
    </button>
  );
  return (
    <header className="channels-pane-head collection-header">
      {compact && closeButton}
      <div className="collection-heading">
        <div>
          {icon}
          {children}
        </div>
        <p>{caption}</p>
      </div>
      <PaneSizeToggle />
      {!compact && closeButton}
    </header>
  );
}
