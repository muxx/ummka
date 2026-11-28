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
      className="channels-icon-action pane-header-action collection-close"
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
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {compact ? (
          <>
            <path d="M5 12l14 0" />
            <path d="M5 12l6 6" />
            <path d="M5 12l6 -6" />
          </>
        ) : (
          <>
            <path d="M18 6l-12 12" />
            <path d="M6 6l12 12" />
          </>
        )}
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
