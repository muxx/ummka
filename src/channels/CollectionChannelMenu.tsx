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

// These Tabler icons are shared with the interactive channel menu prototype.
const sheetIconPaths = {
  archive:
    "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 0 4H5a2 2 0 0 1-2-2 M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8 M10 12h4",
  bell: "M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3H4a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6 M9 17v1a3 3 0 0 0 6 0v-1",
  group:
    "M5 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2 M16 3.13a4 4 0 0 1 0 7.75 M21 21v-2a4 4 0 0 0-3-3.85",
  hash: "M5 9h14 M5 15h14 M11 4l-4 16 M17 4l-4 16",
  lock: "M5 13a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6 M11 16a1 1 0 1 0 2 0a1 1 0 0 0-2 0 M8 11V7a4 4 0 1 1 8 0v4",
  message:
    "M3 20l1.3-3.9c-2.324-3.437-1.426-7.872 2.1-10.374c3.526-2.501 8.59-2.296 11.845.48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235-7.615 4.215-11.574 2.293L3 20",
  pin: "M15 4.5l-4 4-4 1.5-1.5 1.5 7 7 1.5-1.5 1.5-4 4-4 M9 15l-4.5 4.5 M14.5 4l5.5 5.5",
} as const;

const channelKindIcons = { P: "lock", D: "message", G: "group" } as const;

function SheetIcon({
  name,
  className,
}: {
  name: keyof typeof sheetIconPaths;
  className?: string;
}) {
  return (
    <svg
      className={className}
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
      <path d={sheetIconPaths[name]} />
    </svg>
  );
}

export function CollectionChannelMenu({
  headingId,
  headingRef,
  title,
  kind,
  archived,
  language,
  compact,
  trigger,
  open,
  setOpen,
  onPins,
  onNotifications,
}: {
  headingId: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  title: string;
  kind: string;
  archived: boolean;
  language: EntryLanguage;
  compact: boolean;
  trigger: RefObject<HTMLButtonElement | null>;
  open: boolean;
  setOpen: (value: boolean) => void;
  onPins: (trigger: HTMLButtonElement) => void;
  onNotifications?: () => void;
}) {
  const text = collectionCopy[language],
    id = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDialogElement>(null);
  const pins = useRef<HTMLButtonElement>(null);
  const notifications = useRef<HTMLButtonElement>(null);
  const selected = useRef<"pins" | "notifications">("pins");
  useLayoutEffect(() => {
    if (!open) return;
    const modal = compact ? sheet.current : null;
    modal?.showModal();
    const item = selected.current === "notifications" && notifications.current;
    (item || pins.current)?.focus({ preventScroll: true });
    return () => modal?.close();
  }, [compact, open]);
  useEffect(() => {
    if (!open || compact) return;
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
  }, [compact, open, setOpen]);
  function dismissSheet() {
    sheet.current?.close();
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }
  const actions = open && (
    <div
      id={id}
      role="menu"
      aria-label={text.menu}
      className={
        compact ? "collection-sheet-actions" : "collection-channel-actions"
      }
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
        onFocus={() => {
          selected.current = "pins";
        }}
        onClick={() => {
          if (trigger.current) onPins(trigger.current);
        }}
      >
        {compact && <SheetIcon name="pin" />}
        {text.pins}
      </button>
      {onNotifications && (
        <button
          type="button"
          role="menuitem"
          className="collection-channel-action"
          ref={notifications}
          onFocus={() => {
            selected.current = "notifications";
          }}
          onClick={() => {
            selected.current = "notifications";
            onNotifications();
          }}
        >
          {compact && <SheetIcon name="bell" />}
          {notificationCopy[language].title}
        </button>
      )}
    </div>
  );
  return (
    <div ref={wrapper} className="collection-channel-menu">
      <h1 id={headingId} ref={headingRef} tabIndex={-1} aria-label={title}>
        <button
          type="button"
          ref={trigger}
          className="collection-channel-trigger"
          aria-label={`${text.menu}, ${title}`}
          aria-controls={open ? (compact ? `${id}-sheet` : id) : undefined}
          aria-expanded={open}
          aria-haspopup={compact ? "dialog" : "menu"}
          onClick={(event) => {
            selected.current = "pins";
            if (compact) event.currentTarget.focus({ preventScroll: true });
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
      {open && compact ? (
        // biome-ignore lint/a11y/useKeyWithClickEvents: The backdrop uses the completed tap. Escape and the close button dismiss from the keyboard.
        <dialog
          ref={sheet}
          id={`${id}-sheet`}
          className="collection-channel-sheet modal-layout"
          aria-labelledby={`${id}-heading`}
          onCancel={(event) => {
            event.preventDefault();
            dismissSheet();
          }}
          onClick={(event) => {
            if (event.target !== event.currentTarget || event.detail === 0)
              return;
            const { left, top, right, bottom } =
              event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < left ||
              event.clientX > right ||
              event.clientY < top ||
              event.clientY > bottom
            )
              dismissSheet();
          }}
        >
          <header>
            <SheetIcon
              className="collection-sheet-mark"
              name={
                archived
                  ? "archive"
                  : kind === "P" || kind === "D" || kind === "G"
                    ? channelKindIcons[kind]
                    : "hash"
              }
            />
            <h2 id={`${id}-heading`}>{title}</h2>
            <button
              type="button"
              className="channels-icon-action"
              aria-label={text.closeMenu}
              onClick={dismissSheet}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.65"
                strokeLinecap="round"
              >
                <path d="m6 6 12 12M6 18 18 6" />
              </svg>
            </button>
          </header>
          {actions}
        </dialog>
      ) : (
        actions
      )}
    </div>
  );
}
