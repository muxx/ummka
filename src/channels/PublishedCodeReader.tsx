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
    action: "Copy code",
    copied: "Copied",
    failed: "Not copied",
    success: "Code copied.",
    failure: "Could not copy code.",
    blocked: "Copying code is restricted.",
    clipboardNotice: "Copying code is disabled on this device.",
    lines: { one: "line", few: "lines", other: "lines" },
  },
  ru: {
    code: "Код",
    open: "Открыть код",
    full: "Код целиком",
    action: "Копировать код",
    copied: "Скопировано",
    failed: "Не скопировано",
    success: "Код скопирован.",
    failure: "Не удалось скопировать код.",
    blocked: "Копирование кода запрещено.",
    clipboardNotice: "Копирование кода запрещено на этом устройстве.",
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

function CopyMark({ status }: { status: CopyStatus }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {status === "copied" ? (
        <path d="m5 12 4 4L19 6" />
      ) : status === "failed" ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4m0 4h.01" />
        </>
      ) : (
        <>
          <rect x="8" y="8" width="12" height="12" rx="2" />
          <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
        </>
      )}
    </svg>
  );
}

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
  const [result, setResult] = useState<{ status: CopyStatus; attempt: number }>(
    {
      status: "ready",
      attempt: 0,
    },
  );
  const { status } = result;
  const attempt = useRef(0);
  const writing = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (result.status === "ready" || result.status === "writing") return;
    const timer = setTimeout(
      () => setResult({ status: "ready", attempt: result.attempt }),
      result.status === "failed" ? 4000 : 2000,
    );
    return () => clearTimeout(timer);
  }, [result]);
  async function write() {
    const owner = container.current;
    const started = permission?.snapshot();
    if (!owner || writing.current || (started && !started.allowed)) return;
    const currentAttempt = ++attempt.current;
    writing.current = true;
    setResult({ status: "writing", attempt: currentAttempt });
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
          setResult({ status: "blocked", attempt: currentAttempt });
          if (!checked) permission.restrictIfCurrent(started.revision);
          return;
        }
      }
      await navigator.clipboard.writeText(source);
      if (owner.isConnected)
        setResult({ status: "copied", attempt: currentAttempt });
    } catch {
      if (owner.isConnected)
        setResult({ status: "failed", attempt: currentAttempt });
    } finally {
      writing.current = false;
    }
  }
  const label = status === "copied" || status === "failed" ? words[status] : "";
  const announcement =
    status === "copied"
      ? words.success
      : status === "failed"
        ? words.failure
        : status === "blocked" && permission?.allowed
          ? words.blocked
          : "";
  return (
    <div className="post-code-copy" data-state={status} ref={container}>
      {(!permission || permission.allowed) && (
        <>
          {label && (
            <span className="post-code-copy-feedback" aria-hidden="true">
              {label}
            </span>
          )}
          <button
            className="post-code-copy-button"
            type="button"
            aria-label={words.action}
            aria-disabled={status === "writing" || undefined}
            title={words.action}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void write()}
          >
            <CopyMark status={status} />
          </button>
        </>
      )}
      <span className="post-code-copy-status" role="status">
        {announcement && <span key={result.attempt}>{announcement}</span>}
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
      clipboardNotice={copy[locale].clipboardNotice}
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
