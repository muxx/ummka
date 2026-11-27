import {
  createContext,
  type ReactNode,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isAndroid } from "../build-platform.ts";
import { observeClipboardAllowed } from "../device/clipboard-policy.ts";
import { Chevron } from "./ChannelsFrame.tsx";
import "./published-table-mobile.css";

type Locale = "en" | "ru";
export const tableCopy = {
  en: {
    title: "Table",
    open: "Open table",
    back: "Back",
    channel: "Channel",
    thread: "Thread",
    inThread: (room: string) => `thread in ${room}`,
    rows: { one: "row", few: "rows", other: "rows" },
    columns: { one: "column", few: "columns", other: "columns" },
  },
  ru: {
    title: "Таблица",
    open: "Открыть таблицу",
    back: "Назад",
    channel: "Канал",
    thread: "Тред",
    inThread: (room: string) => `тред в ${room}`,
    rows: { one: "строка", few: "строки", other: "строк" },
    columns: { one: "столбец", few: "столбца", other: "столбцов" },
  },
};
const plurals = {
  en: new Intl.PluralRules("en"),
  ru: new Intl.PluralRules("ru"),
};

export function tableOpenLabel(locale: Locale, rows: number, columns: number) {
  const text = tableCopy[locale];
  const form = (count: number) => {
    const plural = plurals[locale].select(count);
    return plural === "one" || plural === "few" ? plural : "other";
  };
  return `${text.open}: ${rows} ${text.rows[form(rows)]}, ${columns} ${text.columns[form(columns)]}`;
}

export type ReaderOrigin = { authorName: string; inThread?: boolean };

export type CodeSource = { language: string | null; text: string };
type Request = ReaderOrigin & {
  locale: Locale;
  button: HTMLButtonElement;
} & (
    | { kind: "table"; content: ReactNode }
    | { kind: "code"; source: CodeSource; blockId: string }
  );
type Opening = Request & { scope: string };

export const PublishedReaderWindow = createContext<{
  limit: number;
  open: (opening: Request) => void;
} | null>(null);

function visibleTableSize() {
  return Math.max(1, Math.floor(window.innerWidth / 96));
}

export function usePublishedReaderWindow(scope: string, roomTitle: string) {
  const [limit, setLimit] = useState(() =>
    isAndroid ? visibleTableSize() : 0,
  );
  const [opening, select] = useState<Opening | null>(null);
  const activeScope = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!isAndroid) return;
    function update() {
      setLimit(visibleTableSize());
    }
    window.addEventListener("resize", update);
    update();
    return () => window.removeEventListener("resize", update);
  }, []);
  useLayoutEffect(() => {
    activeScope.current = scope;
    return () => {
      activeScope.current = null;
    };
  }, [scope]);
  if (opening && opening.scope !== scope) select(null);
  const value = useMemo(
    () => ({
      limit,
      open(selection: Request) {
        select({ ...selection, scope });
      },
    }),
    [limit, scope],
  );
  const close = useCallback(() => select(null), []);
  return { value, opening, close, activeScope, roomTitle };
}

export type ReaderWindow = ReturnType<typeof usePublishedReaderWindow>;

export function PublishedTableScreen({ reader }: { reader: ReaderWindow }) {
  const opening = reader.opening;
  if (opening?.kind !== "table") return null;
  return (
    <PublishedReaderDialog
      reader={reader}
      opening={opening}
      title={tableCopy[opening.locale].title}
      className="post-table-screen"
      regionClass="published-post post-table post-table-screen-content"
    >
      {opening.content}
    </PublishedReaderDialog>
  );
}

type ClipboardSnapshot = {
  allowed: boolean;
  revision: number;
  lastDenial: number;
};

export type ReaderClipboard = {
  allowed: boolean;
  snapshot: () => ClipboardSnapshot;
  restrictIfCurrent: (checkedAt: number) => void;
};

export function PublishedReaderDialog({
  reader,
  opening,
  title,
  className,
  regionClass,
  regionLabel,
  actions,
  children,
}: {
  reader: ReaderWindow;
  opening: Opening;
  title: string;
  className: string;
  regionClass: string;
  regionLabel?: string;
  actions?: (clipboard: ReaderClipboard) => ReactNode;
  children: ReactNode;
}) {
  const { close, activeScope, roomTitle } = reader;
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLElement>(null);
  const heading = useId();
  const origin = useId();
  const actionsNode = useRef<HTMLDivElement>(null);
  const device = useRef<ClipboardSnapshot>({
    allowed: !isAndroid,
    revision: 0,
    lastDenial: 0,
  });
  const [allowed, setAllowed] = useState(!isAndroid);

  const report = useCallback((next: boolean) => {
    const revision = device.current.revision + 1;
    device.current = {
      allowed: next,
      revision,
      lastDenial: next ? device.current.lastDenial : revision,
    };
    setAllowed(next);
    const viewport = content.current;
    viewport?.toggleAttribute("data-selection-allowed", next);
    if (!viewport || next) return;
    if (actionsNode.current?.contains(viewport.ownerDocument.activeElement))
      viewport.focus({ preventScroll: true });
    const selection = viewport.ownerDocument.getSelection();
    if (!selection) return;
    for (let index = 0; index < selection.rangeCount; index++) {
      const range = selection.getRangeAt(index);
      if (!range.collapsed && range.intersectsNode(viewport)) {
        selection.removeAllRanges();
        break;
      }
    }
  }, []);

  useLayoutEffect(() => {
    const modal = dialog.current;
    const viewport = content.current;
    if (!modal || !viewport) return;
    const previousFocus = document.activeElement;
    modal.showModal();
    viewport.focus({ preventScroll: true });
    const stop = isAndroid ? observeClipboardAllowed(report) : undefined;
    if (!isAndroid) report(true);
    return () => {
      stop?.();
      const ownedFocus =
        modal.contains(document.activeElement) ||
        document.activeElement === document.body;
      modal.close();
      const button = opening.button;
      if (!ownedFocus) return;
      queueMicrotask(() => {
        if (
          activeScope.current === opening.scope &&
          button.isConnected &&
          !modal.open &&
          // WebKit may restore the previous focus after closing a pointer-opened dialog.
          (document.activeElement === document.body ||
            document.activeElement === previousFocus)
        )
          button.focus({ preventScroll: true });
      });
    };
  }, [opening, activeScope, report]);
  const text = tableCopy[opening.locale];
  const place = opening.inThread
    ? roomTitle
      ? text.inThread(roomTitle)
      : text.thread
    : roomTitle || text.channel;
  return (
    <dialog
      ref={dialog}
      className={`post-reader-screen ${className}`}
      aria-labelledby={heading}
      aria-describedby={origin}
      onCopyCapture={(event) => {
        if (!device.current.allowed) event.preventDefault();
      }}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="channels-pane-head post-reader-screen-bar">
        <button
          className="channels-icon-action"
          type="button"
          aria-label={text.back}
          onClick={close}
        >
          <Chevron direction="back" />
        </button>
        <h2 id={heading}>{title}</h2>
        {actions && (
          <div className="post-reader-screen-actions" ref={actionsNode}>
            {actions({
              allowed,
              snapshot: () => device.current,
              restrictIfCurrent: (checkedAt) => {
                if (device.current.revision === checkedAt) report(false);
              },
            })}
          </div>
        )}
      </header>
      <p className="post-reader-screen-origin" id={origin}>
        {opening.authorName} · {place}
      </p>
      <section
        ref={content}
        className={`post-reader-region ${regionClass}`}
        aria-label={regionLabel}
        aria-labelledby={regionLabel ? undefined : heading}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: A keyboard must be able to scroll the full content.
        tabIndex={0}
      >
        {children}
      </section>
    </dialog>
  );
}
