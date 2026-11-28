import {
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
import type { EntryLanguage } from "../entry/language.ts";
import { FileIcon, filePanelCopy } from "./ChannelFilesPanel.tsx";
import { channelKindIconPaths } from "./channel-kind-icon-paths.ts";
import { notificationCopy } from "./channel-notification-copy.ts";
import { collectionCopy } from "./collection-copy.ts";
import "./conversation-heading.css";

// These Tabler icons are shared with the interactive channel menu prototype.
const sheetIconPaths = {
  ...channelKindIconPaths,
  bell: "M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3H4a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6 M9 17v1a3 3 0 0 0 6 0v-1",
  group:
    "M5 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2 M16 3.13a4 4 0 0 1 0 7.75 M21 21v-2a4 4 0 0 0-3-3.85",
  message:
    "M3 20l1.3-3.9c-2.324-3.437-1.426-7.872 2.1-10.374c3.526-2.501 8.59-2.296 11.845.48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235-7.615 4.215-11.574 2.293L3 20",
  members:
    "M9 6a3 3 0 1 0 0 6a3 3 0 0 0 0-6M3 20v-1a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v1M17 6a3 3 0 0 1 0 6M21 20v-1a4 4 0 0 0-4-4",
  info: "M12 7.5v.2M12 11v6M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0",
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

export type ChannelMenu = "title" | "quick" | null;

const channelMenuCopy = {
  en: {
    info: "Conversation info",
    details: "Info",
    members: "Members",
    actions: "Channel actions",
    chatActions: "Conversation actions",
  },
  ru: {
    info: "Сведения о беседе",
    details: "Сведения",
    members: "Участники",
    actions: "Действия с каналом",
    chatActions: "Действия с беседой",
  },
};

export function ChannelQuickActionsButton({
  kind,
  language,
  button,
  open,
  show,
}: {
  kind: string;
  language: EntryLanguage;
  button: RefObject<HTMLButtonElement | null>;
  open: boolean;
  show: () => void;
}) {
  const t = channelMenuCopy[language];
  const label = kind === "D" || kind === "G" ? t.chatActions : t.actions;
  return (
    <button
      ref={button}
      type="button"
      className="channels-icon-action channel-quick-actions"
      aria-label={label}
      title={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={show}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="currentColor"
      >
        <circle cx="5" cy="12" r="1.4" />
        <circle cx="12" cy="12" r="1.4" />
        <circle cx="19" cy="12" r="1.4" />
      </svg>
    </button>
  );
}

export function CollectionChannelMenu({
  headingId,
  headingRef,
  title,
  description,
  kind,
  archived,
  language,
  compact,
  trigger,
  quickTrigger,
  open,
  setOpen,
  onInfo,
  onMembers,
  onPins,
  onFiles,
  onNotifications,
}: {
  headingId: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  title: string;
  description: string;
  kind: string;
  archived: boolean;
  language: EntryLanguage;
  compact: boolean;
  trigger: RefObject<HTMLButtonElement | null>;
  quickTrigger: RefObject<HTMLButtonElement | null>;
  open: ChannelMenu;
  setOpen: (value: ChannelMenu) => void;
  onInfo?: (trigger: HTMLButtonElement) => void;
  onMembers?: (trigger: HTMLButtonElement) => void;
  onPins: (trigger: HTMLButtonElement) => void;
  onFiles?: (trigger: HTMLButtonElement) => void;
  onNotifications?: () => void;
}) {
  const text = collectionCopy[language],
    id = useId();
  const mark = archived
    ? "archive"
    : kind === "P" || kind === "D" || kind === "G"
      ? channelKindIcons[kind]
      : "hash";
  const actionList = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDialogElement>(null);
  const selected = useRef("info");
  const quick = open === "quick";
  const menuTrigger = quick ? quickTrigger : trigger;
  const labels = channelMenuCopy[language];
  const actions = [
    {
      key: "info",
      icon: "info",
      label: quick ? labels.details : labels.info,
      run: onInfo,
    },
    ...(!quick
      ? [
          {
            key: "members",
            icon: "members",
            label: labels.members,
            run: onMembers,
          } as const,
          { key: "pins", icon: "pin", label: text.pins, run: onPins } as const,
          {
            key: "files",
            icon: null,
            label: filePanelCopy[language].title,
            run: onFiles,
          } as const,
          {
            key: "notifications",
            icon: "bell",
            label: notificationCopy[language].title,
            run: onNotifications,
          } as const,
        ]
      : []),
  ] as const;
  useLayoutEffect(() => {
    if (!open) return;
    const modal = compact ? sheet.current : null;
    modal?.showModal();
    const items = Array.from(
      actionList.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    const item = quick
      ? items[0]
      : (items.find((entry) => entry.dataset.action === selected.current) ??
        items[0]);
    item?.focus({ preventScroll: true });
    return () => modal?.close();
  }, [compact, open, quick]);
  useEffect(() => {
    if (!open || compact) return;
    function outside(event: Event) {
      if (
        event.target instanceof Node &&
        !menuTrigger.current?.contains(event.target) &&
        !actionList.current?.contains(event.target)
      )
        setOpen(null);
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [compact, open, setOpen, menuTrigger]);
  function dismissSheet() {
    sheet.current?.close();
    setOpen(null);
    menuTrigger.current?.focus({ preventScroll: true });
  }
  const content = open && (
    <div
      ref={actionList}
      id={id}
      role="menu"
      aria-label={quick ? labels.details : text.menu}
      className={
        compact ? "collection-sheet-actions" : "collection-channel-actions"
      }
      onKeyDown={(event) => {
        const key = event.key;
        if (
          key !== "ArrowDown" &&
          key !== "ArrowUp" &&
          key !== "Home" &&
          key !== "End"
        )
          return;
        const items = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
        );
        if (!items.length) return;
        event.preventDefault();
        const index = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          key === "Home"
            ? 0
            : key === "End"
              ? items.length - 1
              : (index + (key === "ArrowDown" ? 1 : -1) + items.length) %
                items.length;
        items[next]?.focus();
      }}
    >
      {actions.map(
        ({ key, icon, label, run }) =>
          run && (
            <button
              type="button"
              key={key}
              role="menuitem"
              className="collection-channel-action"
              data-action={key}
              onFocus={() => {
                selected.current = key;
              }}
              onClick={() => {
                const opener = menuTrigger.current;
                if (!opener) return;
                selected.current = key;
                run(opener);
              }}
            >
              {compact &&
                (icon === null ? <FileIcon /> : <SheetIcon name={icon} />)}
              {label}
            </button>
          ),
      )}
    </div>
  );
  const topic = (
    <span
      className="conversation-heading-description"
      id={`${id}-description`}
      title={description}
    >
      <bdi>{description}</bdi>
    </span>
  );
  return (
    <div className="collection-channel-menu">
      <h1 id={headingId} ref={headingRef} tabIndex={-1} aria-label={title}>
        <button
          type="button"
          ref={trigger}
          className="collection-channel-trigger"
          aria-label={`${text.menu}, ${title}`}
          aria-describedby={`${id}-description`}
          aria-controls={
            open === "title" ? (compact ? `${id}-sheet` : id) : undefined
          }
          aria-expanded={open === "title"}
          aria-haspopup={compact ? "dialog" : "menu"}
          onClick={(event) => {
            selected.current = "info";
            if (compact) event.currentTarget.focus({ preventScroll: true });
            setOpen(open === "title" ? null : "title");
          }}
        >
          <span className="conversation-heading-title">
            <SheetIcon className="conversation-heading-mark" name={mark} />
            <bdi>{title}</bdi>
            <svg
              className="conversation-heading-chevron"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
          {compact && topic}
        </button>
      </h1>
      {!compact && topic}
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
            <SheetIcon className="collection-sheet-mark" name={mark} />
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
          {content}
        </dialog>
      ) : (
        content
      )}
    </div>
  );
}
