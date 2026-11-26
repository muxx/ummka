import {
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
import type { EntryLanguage } from "../entry/language.ts";
import { notificationCopy } from "./channel-notification-copy.ts";
import { collectionCopy } from "./collection-copy.ts";

export function CollectionChannelMenu({
  headingId,
  headingRef,
  title,
  language,
  trigger,
  open,
  setOpen,
  onPins,
  onNotifications,
}: {
  headingId: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  title: string;
  language: EntryLanguage;
  trigger: RefObject<HTMLButtonElement | null>;
  open: boolean;
  setOpen: (value: boolean) => void;
  onPins: (trigger: HTMLButtonElement) => void;
  onNotifications?: () => void;
}) {
  const text = collectionCopy[language],
    id = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const pins = useRef<HTMLButtonElement>(null);
  const notifications = useRef<HTMLButtonElement>(null);
  const returnToNotifications = useRef(false);
  useLayoutEffect(() => {
    if (open) {
      const item = returnToNotifications.current && notifications.current;
      (item || pins.current)?.focus();
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    function outside(event: Event) {
      if (
        event.target instanceof Node &&
        !wrapper.current?.contains(event.target)
      )
        setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open, setOpen]);
  return (
    <div ref={wrapper} className="collection-channel-menu">
      <h1 id={headingId} ref={headingRef} tabIndex={-1} aria-label={title}>
        <button
          type="button"
          ref={trigger}
          className="collection-channel-trigger"
          aria-label={`${text.menu}, ${title}`}
          aria-controls={open ? id : undefined}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => {
            returnToNotifications.current = false;
            setOpen(!open);
          }}
        >
          <span>{title}</span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </h1>
      {open && (
        <div
          id={id}
          role="menu"
          aria-label={text.menu}
          className="collection-channel-actions"
          onKeyDown={(event) => {
            const first = pins.current,
              last = notifications.current ?? first;
            const key = event.key;
            if (
              key !== "ArrowDown" &&
              key !== "ArrowUp" &&
              key !== "Home" &&
              key !== "End"
            )
              return;
            event.preventDefault();
            if (key === "Home") first?.focus();
            else if (key === "End") last?.focus();
            else (document.activeElement === first ? last : first)?.focus();
          }}
        >
          <button
            type="button"
            role="menuitem"
            className="collection-channel-action"
            ref={pins}
            onClick={() => {
              if (trigger.current) onPins(trigger.current);
            }}
          >
            {text.pins}
          </button>
          {onNotifications && (
            <button
              type="button"
              role="menuitem"
              className="collection-channel-action"
              ref={notifications}
              onClick={() => {
                returnToNotifications.current = true;
                onNotifications();
              }}
            >
              {notificationCopy[language].title}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
