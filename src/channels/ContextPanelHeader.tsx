import type { ReactNode, RefObject } from "react";
import "./context-panel.css";

type Action = { label: string; run: () => void };

export function ContextPanelHeader({
  id,
  heading,
  title,
  subtitle,
  subtitleId,
  status,
  icon,
  back,
  close,
  actions,
  dialog,
}: {
  id: string;
  heading?: RefObject<HTMLHeadingElement | null>;
  title: string;
  subtitle?: string;
  subtitleId?: string;
  status?: ReactNode;
  icon?: ReactNode;
  back?: Action & { compactOnly?: boolean };
  close?: Action & { compact?: boolean };
  actions?: ReactNode;
  dialog?: boolean;
}) {
  return (
    <header
      className={
        dialog
          ? "context-panel-header context-panel-header--dialog"
          : "context-panel-header"
      }
    >
      {back && (
        <button
          className="channels-icon-action context-panel-header__back"
          data-compact-only={back.compactOnly || undefined}
          type="button"
          aria-label={back.label}
          title={back.label}
          onClick={back.run}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <path d="m11 5-7 7 7 7M4 12h16" />
          </svg>
        </button>
      )}
      <div className="context-panel-header__labels">
        <h2
          id={id}
          ref={heading}
          tabIndex={heading ? -1 : undefined}
          aria-describedby={subtitle ? subtitleId : undefined}
          title={title}
        >
          {icon}
          <span>{title}</span>
        </h2>
        {status ? (
          <div className="context-panel-header__status">{status}</div>
        ) : (
          subtitle && (
            <p
              className="context-panel-header__subtitle"
              id={subtitleId}
              title={subtitle}
            >
              {subtitle}
            </p>
          )
        )}
      </div>
      {(actions || close) && (
        <div
          className="context-panel-header__actions"
          data-compact-close={close?.compact || undefined}
        >
          {actions}
          {close && (
            <button
              className="channels-icon-action context-panel-header__close"
              type="button"
              aria-label={close.label}
              title={close.label}
              onClick={close.run}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <path d="m6 6 12 12m0-12L6 18" />
              </svg>
            </button>
          )}
        </div>
      )}
    </header>
  );
}
