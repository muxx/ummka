import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { EntryLanguage } from "../entry/language.ts";
import { startConversationCopy } from "./start-conversation-copy.ts";

export function StartConversationCategoryMenu({
  language,
  start,
}: {
  language: EntryLanguage;
  start: (opener: HTMLButtonElement) => void;
}) {
  const text = startConversationCopy[language];
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const item = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    if (open) item.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const menu = root.current;
    function outside(event: Event) {
      if (event.target instanceof Node && !menu?.contains(event.target))
        setOpen(false);
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      button.current?.focus({ preventScroll: true });
    }
    menu?.addEventListener("keydown", dismissOnEscape);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      menu?.removeEventListener("keydown", dismissOnEscape);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open]);
  return (
    <div className="direct-message-category__actions" ref={root}>
      <button
        ref={button}
        type="button"
        className="direct-message-category__trigger channels-icon-action"
        aria-label={text.menu}
        title={text.menu}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          setOpen(true);
          item.current?.focus({ preventScroll: true });
        }}
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <circle cx="3" cy="8" r="1.25" />
          <circle cx="8" cy="8" r="1.25" />
          <circle cx="13" cy="8" r="1.25" />
        </svg>
      </button>
      {open && (
        <div
          className="direct-message-category__menu"
          id={menuId}
          role="menu"
          aria-label={text.menu}
        >
          <button
            ref={item}
            className="direct-message-category__item"
            type="button"
            role="menuitem"
            onClick={() => {
              const opener = button.current;
              if (!opener) return;
              setOpen(false);
              opener.focus({ preventScroll: true });
              start(opener);
            }}
          >
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.65"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l1.8-3.4A8.5 8.5 0 1 1 21 11.5Z" />
              <path d="M9 11h7M9 14h4" />
            </svg>
            {text.action}
          </button>
        </div>
      )}
    </div>
  );
}
