import type { EntryLanguage } from "./language";
import type { EntryLinkResult } from "./use-system-permalink";
import "./link-outcome.css";

const russianPlural = new Intl.PluralRules("ru");
const copy = {
  en: {
    unknownTitle: "This link can’t be opened",
    unsupportedTitle: "ummka can’t open this type of link yet",
    unknown:
      "The address doesn’t match a server on this device. ummka didn’t open or add it.",
    unsupported: (place: string, server?: string) =>
      `It points to ${place} on ${server ? `“${server}”` : "a saved server"}. ummka currently opens only links to messages.`,
    places: {
      threads: "a thread list",
      channels: "a channel",
      messages: "a direct conversation",
    },
    connect: "You’re still on the server connection screen.",
    signIn: (server: string) =>
      server
        ? `You’re still signing in to “${server}”.`
        : "You’re still signing in.",
    waiting: (count: number) =>
      count === 1
        ? "One more link is waiting. It’ll open when you select Close."
        : `${count} more links are waiting. The next one will open when you select Close.`,
    close: "Close",
  },
  ru: {
    unknownTitle: "Ссылку не открыть",
    unsupportedTitle: "Такую ссылку ummka пока не открывает",
    unknown:
      "Адрес не распознан среди серверов на этом устройстве. ummka его не открывал и не добавлял.",
    unsupported: (place: string, server?: string) =>
      `Она ведёт на ${place} на ${server ? `сервере «${server}»` : "сохранённом сервере"}. По ссылке ummka пока открывает только сообщения.`,
    places: {
      threads: "список тредов",
      channels: "канал",
      messages: "личную беседу",
    },
    connect: "Вы остаётесь на подключении сервера.",
    signIn: (server: string) =>
      server
        ? `Вы остаётесь на входе в «${server}».`
        : "Вы остаётесь на входе.",
    waiting: (count: number) => {
      if (count === 1)
        return "Ещё одна ссылка ждёт: она откроется после «Закрыть».";
      const form = russianPlural.select(count);
      const links =
        form === "one"
          ? "ссылка ждёт"
          : form === "few"
            ? "ссылки ждут"
            : "ссылок ждут";
      return `Ещё ${count} ${links}: следующая откроется после «Закрыть».`;
    },
    close: "Закрыть",
  },
};

export function EntryLinkOutcome({
  language,
  result,
  server,
  onClose,
}: {
  language: EntryLanguage;
  result: EntryLinkResult;
  server?: { url: string; name: string };
  onClose: () => void;
}) {
  const text = copy[language];
  const known = result.kind === "unsupported";
  return (
    <div className="entry-link-outcome">
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="6.2" />
        <path d="M8 7.2v4m0-6.4h.01" />
      </svg>
      <div className="entry-link-outcome-copy" role="status">
        <strong>{known ? text.unsupportedTitle : text.unknownTitle}</strong>
        <span>
          {known
            ? text.unsupported(
                text.places[result.place],
                server?.url === result.serverUrl ? server.name : undefined,
              )
            : text.unknown}
        </span>
        <span>{server ? text.signIn(server.name) : text.connect}</span>
        {result.waiting !== undefined && result.waiting > 0 && (
          <small>{text.waiting(result.waiting)}</small>
        )}
      </div>
      <button
        type="button"
        className="entry-link-outcome-close"
        onClick={() => {
          result.close();
          onClose();
        }}
      >
        {text.close}
      </button>
    </div>
  );
}
