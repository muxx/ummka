import { useContext, useEffect, useId, useRef, useState } from "react";
import { readClipboardAllowed } from "../device/clipboard-policy.ts";
import type { EntryLanguage } from "../entry/language.ts";
import {
  type CodeSource,
  PublishedReaderDialog,
  PublishedReaderWindow,
  type ReaderClipboard,
  type ReaderOrigin,
  type ReaderWindow,
} from "./PublishedReaderWindow.tsx";
import "./published-code-reader.css";

const previewLimit = 4;
const copy = {
  en: {
    code: "Code",
    open: "Open code",
    full: "Full code",
    copy: "Copy",
    action: "Copy code",
    writing: "Copying…",
    copied: "Copied",
    failed: "Not copied",
    success: "Code copied.",
    failure: "Could not copy code.",
    blocked: "Copying code is restricted.",
    lines: { one: "line", few: "lines", other: "lines" },
  },
  ru: {
    code: "Код",
    open: "Открыть код",
    full: "Код целиком",
    copy: "Копировать",
    action: "Копировать код",
    writing: "Копируем…",
    copied: "Скопировано",
    failed: "Не скопировано",
    success: "Код скопирован.",
    failure: "Не удалось скопировать код.",
    blocked: "Копирование кода запрещено.",
    lines: { one: "строка", few: "строки", other: "строк" },
  },
};
const plurals = {
  en: new Intl.PluralRules("en"),
  ru: new Intl.PluralRules("ru"),
};

function lineCount(locale: EntryLanguage, n: number) {
  const category = plurals[locale].select(n);
  const forms = copy[locale].lines;
  return `${n} ${forms[category === "one" || category === "few" ? category : "other"]}`;
}

export function CodePreview({
  source,
  locale,
  origin,
}: {
  source: CodeSource;
  locale: EntryLanguage;
  origin: ReaderOrigin;
}) {
  const reader = useContext(PublishedReaderWindow);
  if (!reader) throw Error("Mobile code requires its workspace");
  const blockId = useId();
  const lines = source.text.split("\n");
  const preview = lines.slice(0, previewLimit);
  return (
    <button
      className="post-code-preview"
      type="button"
      aria-label={`${copy[locale].open}: ${lineCount(locale, lines.length)}`}
      onClick={(event) =>
        reader.open({
          kind: "code",
          source,
          blockId,
          locale,
          button: event.currentTarget,
          ...origin,
        })
      }
    >
      <span className="post-code-preview-box">
        <code style={{ minBlockSize: `${preview.length}lh` }}>
          {preview.join("\n")}
        </code>
      </span>
      {lines.length > previewLimit && (
        <span className="post-code-remaining">
          +{lineCount(locale, lines.length - previewLimit)}
        </span>
      )}
    </button>
  );
}

type CopyStatus = "ready" | "writing" | "copied" | "failed" | "blocked";

export function CodeCopy({
  source,
  locale,
  permission,
}: {
  source: string;
  locale: EntryLanguage;
  permission?: ReaderClipboard;
}) {
  const words = copy[locale];
  const [status, setStatus] = useState<CopyStatus>("ready");
  const writing = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (status === "ready" || status === "writing") return;
    const timer = setTimeout(() => setStatus("ready"), 2000);
    return () => clearTimeout(timer);
  }, [status]);
  async function write() {
    const owner = container.current;
    const started = permission?.snapshot();
    if (!owner || writing.current || (started && !started.allowed)) return;
    writing.current = true;
    setStatus("writing");
    try {
      if (permission && started) {
        const checked = await readClipboardAllowed();
        if (!owner.isConnected) return;
        const current = permission.snapshot();
        // A re-grant cannot resume an action that predates an observed denial.
        if (
          !checked ||
          !current.allowed ||
          current.lastDenial > started.revision
        ) {
          setStatus("blocked");
          if (!checked) permission.restrictIfCurrent(started.revision);
          return;
        }
      }
      await navigator.clipboard.writeText(source);
      if (owner.isConnected) setStatus("copied");
    } catch {
      if (owner.isConnected) setStatus("failed");
    } finally {
      writing.current = false;
    }
  }
  const label =
    status === "writing" || status === "copied" || status === "failed"
      ? words[status]
      : words.copy;
  return (
    <div className="post-code-copy" ref={container}>
      {(!permission || permission.allowed) && (
        <button
          className="post-code-copy-button"
          type="button"
          aria-label={words.action}
          aria-disabled={status === "writing" || undefined}
          onClick={() => void write()}
        >
          <span>{label}</span>
        </button>
      )}
      <span className="post-code-copy-status" role="status">
        {status === "copied"
          ? words.success
          : status === "failed"
            ? words.failure
            : status === "blocked"
              ? words.blocked
              : ""}
      </span>
    </div>
  );
}

function CodeScreen({
  reader,
  opening,
}: {
  reader: ReaderWindow;
  opening: Extract<NonNullable<ReaderWindow["opening"]>, { kind: "code" }>;
}) {
  const { locale, source } = opening;
  const lines = source.text.split("\n").length;
  return (
    <PublishedReaderDialog
      reader={reader}
      opening={opening}
      title={copy[locale].code}
      className="post-code-reader"
      regionClass="post-code-reader-content"
      regionLabel={`${copy[locale].full}, ${lineCount(locale, lines)}`}
      actions={(permission) => (
        <CodeCopy
          source={source.text}
          locale={locale}
          permission={permission}
        />
      )}
    >
      <span className="post-code-line-numbers" aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
      </span>
      <pre>
        <code>{source.text}</code>
      </pre>
    </PublishedReaderDialog>
  );
}

export function PublishedCodeReader({ reader }: { reader: ReaderWindow }) {
  const opening = reader.opening;
  return opening?.kind === "code" ? (
    <CodeScreen key={opening.blockId} reader={reader} opening={opening} />
  ) : null;
}
