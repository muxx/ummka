import type { openAccountRestConnection } from "../mattermost/native-rest.ts";

type State = ReturnType<
  Awaited<ReturnType<typeof openAccountRestConnection>>["getOutgoingPostState"]
>;
const text = {
  en: {
    sending: "Sending…",
    unknown: "Delivery unconfirmed. The message may have arrived.",
    refused: "Not sent",
    retryRefused:
      "The server declined the retry. The first message may have arrived.",
    previous:
      "Your sign-in changed. This message belongs to your earlier session.",
    offline: "You can check delivery when you’re back online.",
    readFailed: "Couldn’t update outgoing messages on this device.",
    retry: "Try again",
    earlier: "Show earlier outgoing messages",
    you: "You",
    copyText: "Copy text",
    remove: "Remove",
    sendAgain: "Send again",
    duplicateRisk:
      "If the first message arrived, the channel may show a duplicate.",
    sendAnyway: "Send anyway",
    cancel: "Cancel",
    resendFailed: "Couldn’t retry this message. Check its delivery status.",
    copied: "Text copied.",
    copyFailed: "Couldn’t copy the text.",
    removeFailed: "Couldn’t remove this message from the device.",
    removed: "Unsent message removed.",
    removedLocally: "Message removed from this device.",
    changed: "The outgoing message has changed.",
    noAccess: "You don’t have permission to post in this channel.",
  },
  ru: {
    sending: "Отправляется…",
    unknown: "Доставка не подтверждена. Сообщение могло дойти.",
    refused: "Не отправлено",
    retryRefused: "Сервер отклонил повтор. Первая отправка могла дойти.",
    previous: "Вход в аккаунт сменился. Сообщение относится к прежнему входу.",
    offline: "Проверить доставку можно, когда будет связь.",
    readFailed: "Не удалось обновить исходящие на устройстве.",
    retry: "Повторить",
    earlier: "Показать более ранние исходящие",
    you: "Вы",
    copyText: "Скопировать текст",
    remove: "Удалить",
    sendAgain: "Отправить ещё раз",
    duplicateRisk:
      "Если первое сообщение дошло, в канале может появиться копия.",
    sendAnyway: "Всё равно отправить",
    cancel: "Отмена",
    resendFailed:
      "Не удалось повторить отправку. Проверьте состояние сообщения.",
    copied: "Текст скопирован.",
    copyFailed: "Не удалось скопировать текст.",
    removeFailed: "Не удалось удалить сообщение с устройства.",
    removed: "Неотправленное сообщение удалено.",
    removedLocally: "Строка удалена только с устройства.",
    changed: "Состояние исходящего сообщения изменилось.",
    noAccess: "Нет права писать в этот канал.",
  },
} as const;
export const outgoingCopy = text;

export function outgoingDescription(state: State, locale: keyof typeof text) {
  const copy = text[locale];
  if (state.kind === "delivered") return "";
  if (state.kind === "sending") return copy.sending;
  const outcome = state.kind === "previousLogin" ? state.outcome : state;
  const refusal =
    outcome.kind === "refused" ? outcome.refusal : outcome.retryRefusal;
  const issue =
    refusal?.code === "api.context.permissions.app_error"
      ? copy.noAccess
      : refusal?.message?.trim();
  const label =
    outcome.kind === "refused"
      ? copy.refused
      : refusal
        ? copy.retryRefused
        : copy.unknown;
  return [
    label,
    issue,
    state.kind === "previousLogin" ? copy.previous : null,
    state.kind === "unconfirmed" && state.actions.checkDelivery === false
      ? copy.offline
      : null,
  ]
    .filter(Boolean)
    .join(" ");
}
