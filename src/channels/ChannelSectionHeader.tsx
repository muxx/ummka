import type { ReactNode, RefObject } from "react";
import { PaneSizeToggle } from "./PaneWidthControls.tsx";
export function ChannelSectionHeader({
  id,
  heading,
  icon,
  title,
  name,
  detailAction,
  detailStatus,
  desktopBack,
  backLabel,
  closeLabel,
  back,
  close,
}: {
  id: string;
  heading: RefObject<HTMLHeadingElement | null>;
  icon: ReactNode;
  title: string;
  name: string;
  detailAction?: ReactNode;
  detailStatus?: string;
  desktopBack?: boolean;
  backLabel: string;
  closeLabel: string;
  back: () => void;
  close: () => void;
}) {
  return (
    <header className="channels-pane-head channel-section-header">
      <button
        type="button"
        className="channels-icon-action channel-section-back"
        data-desktop-back={desktopBack || undefined}
        aria-label={backLabel}
        onClick={back}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path d="m11 5-7 7 7 7M4 12h16" />
        </svg>
      </button>
      <div className="channels-pane-titles">
        <h2 id={id} tabIndex={-1} ref={heading}>
          {icon}
          <span>{title}</span>
        </h2>
        {detailStatus ? (
          <div className="channel-section-detail">
            <span className="panel-text--secondary">{detailStatus}</span>
            {detailAction}
          </div>
        ) : (
          <p>{name}</p>
        )}
      </div>
      <div className="channel-section-actions">
        <PaneSizeToggle />
        <button
          type="button"
          className="channels-icon-action channel-section-close"
          aria-label={closeLabel}
          onClick={close}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path d="m6 6 12 12m0-12L6 18" />
          </svg>
        </button>
      </div>
    </header>
  );
}
