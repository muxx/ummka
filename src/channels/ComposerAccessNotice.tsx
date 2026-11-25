import type { EntryLanguage } from "../entry/language.ts";
import type { channelComposerAccess } from "./composer-access.ts";
import { workspaceCopy } from "./workspace-copy.ts";
import type { WorkspaceRead } from "./workspace-data.ts";

type Status = WorkspaceRead<unknown>["status"];
function unknownReason(online: boolean, statuses: Status[]) {
  if (statuses.includes("storage")) return "failed";
  if (!online) return "offline";
  if (statuses.some((s) => s === "forbidden" || s === "network"))
    return "failed";
  if (
    statuses.some(
      (s) => s === "loading" || s === "refreshing" || s === "offline",
    )
  )
    return "checking";
  return "failed";
}

const messages = {
  en: {
    archived: [
      "You’re viewing an archived channel.",
      "New messages can’t be posted.",
    ],
    deactivated: [
      "This account has been deactivated.",
      "You can still read the conversation.",
    ],
    readOnly: [
      "This channel is read-only.",
      "Only members with posting permission can write here.",
    ],
    sharedDisabled: [
      "Messaging across servers is disabled.",
      "You can still read the conversation.",
    ],
    checking: ["Checking posting permissions…", ""],
    offline: [
      "Posting permissions aren’t saved on this device.",
      "Reconnect to check them.",
    ],
    failed: ["Couldn’t verify posting permissions.", ""],
    close: "Close channel",
  },
  ru: {
    archived: [
      "Вы просматриваете архивный канал.",
      "Новые сообщения публиковать нельзя.",
    ],
    deactivated: [
      "Аккаунт собеседника деактивирован.",
      "Переписку по-прежнему можно читать.",
    ],
    readOnly: [
      "Канал только для чтения.",
      "Писать сюда могут участники с правом публикации.",
    ],
    sharedDisabled: [
      "Обмен сообщениями между серверами отключён.",
      "Переписку по-прежнему можно читать.",
    ],
    checking: ["Проверяем права на публикацию…", ""],
    offline: [
      "На устройстве нет данных о праве на публикацию.",
      "Для проверки нужно подключение.",
    ],
    failed: ["Не удалось проверить право на публикацию.", ""],
    close: "Закрыть канал",
  },
} as const;

export function ComposerAccessNotice({
  access,
  language,
  online,
  statuses,
  close,
  retry,
}: {
  access: ReturnType<typeof channelComposerAccess>;
  language: EntryLanguage;
  online: boolean;
  statuses: Status[];
  close: () => void;
  retry: () => void;
}) {
  if (access === "absent" || access === "writable") return null;
  const reason =
    access === "unknown" ? unknownReason(online, statuses) : access;
  const copy = messages[language];
  const [lead, detail] = copy[reason];
  const closed = reason === "archived" || reason === "deactivated";
  return (
    <div
      className="workspace-composer-note"
      role={access === "unknown" ? "status" : "note"}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {closed ? (
          <path d="M3 4h18v5H3z M5 9v11h14V9 M10 13h4" />
        ) : (
          <>
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
          </>
        )}
      </svg>
      <p>
        <strong>{lead}</strong>
        {detail && " "}
        {detail}
      </p>
      {closed && (
        <button type="button" onClick={close}>
          {copy.close}
        </button>
      )}
      {reason === "failed" && (
        <button type="button" onClick={retry}>
          {workspaceCopy[language].retry}
        </button>
      )}
    </div>
  );
}
