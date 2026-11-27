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

export type TableOrigin = { authorName: string; inThread?: boolean };

type Opening = TableOrigin & {
  locale: Locale;
  button: HTMLButtonElement;
  content: ReactNode;
  scope: string;
};

export const PublishedTableWindow = createContext<{
  limit: number;
  open: (opening: Omit<Opening, "scope">) => void;
} | null>(null);

function visibleTableSize() {
  return Math.max(1, Math.floor(window.innerWidth / 96));
}

export function usePublishedTableWindow(scope: string, roomTitle: string) {
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
      open(selection: Omit<Opening, "scope">) {
        select({ ...selection, scope });
      },
    }),
    [limit, scope],
  );
  const close = useCallback(() => select(null), []);
  return { value, opening, close, activeScope, roomTitle };
}

export function PublishedTableScreen({
  tables,
}: {
  tables: ReturnType<typeof usePublishedTableWindow>;
}) {
  const { opening, close, activeScope, roomTitle } = tables;
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLElement>(null);
  const heading = useId();
  const origin = useId();
  useLayoutEffect(() => {
    const modal = dialog.current;
    const viewport = content.current;
    if (!modal || !opening || !viewport) return;
    modal.showModal();
    viewport.focus({ preventScroll: true });
    const stop = isAndroid
      ? observeClipboardAllowed((allowed) => {
          viewport.toggleAttribute("data-selection-allowed", allowed);
          if (allowed) return;
          const selection = viewport.ownerDocument.getSelection();
          if (!selection) return;
          for (let index = 0; index < selection.rangeCount; index++) {
            const range = selection.getRangeAt(index);
            if (!range.collapsed && range.intersectsNode(viewport)) {
              selection.removeAllRanges();
              break;
            }
          }
        })
      : undefined;
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
          document.activeElement === document.body
        )
          button.focus({ preventScroll: true });
      });
    };
  }, [opening, activeScope]);
  if (!opening) return null;
  const text = tableCopy[opening.locale];
  const place = opening.inThread
    ? roomTitle
      ? text.inThread(roomTitle)
      : text.thread
    : roomTitle || text.channel;
  return (
    <dialog
      ref={dialog}
      className="post-table-screen"
      aria-labelledby={heading}
      aria-describedby={origin}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="channels-pane-head post-table-screen-bar">
        <button
          className="channels-icon-action"
          type="button"
          aria-label={text.back}
          onClick={close}
        >
          <Chevron direction="back" />
        </button>
        <h2 id={heading}>{text.title}</h2>
      </header>
      <p className="post-table-screen-origin" id={origin}>
        {opening.authorName} · {place}
      </p>
      <section
        ref={content}
        className="published-post post-table post-table-screen-content"
        aria-labelledby={heading}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: A keyboard must be able to scroll the full table.
        tabIndex={0}
      >
        {opening.content}
      </section>
    </dialog>
  );
}
