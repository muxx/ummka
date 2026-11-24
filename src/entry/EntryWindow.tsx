import type { ReactNode } from "react";
import lockup from "./brand/lockup.svg?no-inline";
import smallLockup from "./brand/lockup-small.svg?no-inline";
import "./window.css";

type BackAction = { label: string; activate: () => void };

export function EntryWindow({
  children,
  back,
}: {
  children: ReactNode;
  back?: BackAction;
}) {
  const overlay = import.meta.env.UMMKA_MACOS_OVERLAY === true;
  return (
    <div className="entry-window" data-macos-overlay={overlay || undefined}>
      <header
        className="entry-bar"
        data-tauri-drag-region={overlay || undefined}
      >
        {back && (
          <button
            className="entry-back"
            type="button"
            aria-label={back.label}
            onClick={back.activate}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m10 5-7 7 7 7M3 12h18" />
            </svg>
          </button>
        )}
        <img
          className="entry-brand-small"
          src={smallLockup}
          alt="ummka"
          width="80"
          height="24"
        />
      </header>
      <main className="entry-body">
        <div className="entry-layout">
          <img
            className="entry-brand"
            src={lockup}
            alt="ummka"
            width="403"
            height="121"
          />
          <div className="entry-card">{children}</div>
        </div>
      </main>
    </div>
  );
}
