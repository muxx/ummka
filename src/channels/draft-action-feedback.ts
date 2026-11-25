import type { EntryLanguage } from "../entry/language.ts";
import type { submitChannelReaction } from "./submit-channel-reaction.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";

type Command = Awaited<ReturnType<WorkspaceConnection["submitDraftCommand"]>>;
type Reaction = Awaited<ReturnType<typeof submitChannelReaction>>;
export type ActionFeedback =
  | { kind: "command"; answer: Command }
  | { kind: "reaction"; answer: Reaction; emoji: string }
  | { kind: "localCommand"; trigger: string }
  | { kind: "blockedCommand"; reason: "attachments" | "scheduled" }
  | { kind: "blockedReaction" };

export function draftActionFeedback(
  action: ActionFeedback,
  lang: EntryLanguage,
): string {
  const ru = lang === "ru";
  switch (action.kind) {
    case "localCommand":
      return ru
        ? `Команда ${action.trigger} пока недоступна в этом окне.`
        : `${action.trigger} isn’t available in this window yet.`;
    case "blockedCommand":
      return action.reason === "attachments"
        ? ru
          ? "Для команды уберите вложения."
          : "Remove the attachments to run a command."
        : ru
          ? "Команду нельзя запланировать."
          : "Commands can’t be scheduled.";
    case "blockedReaction":
      return ru
        ? "Имя эмодзи слишком длинное для реакции."
        : "This emoji name is too long for a reaction.";
    case "command":
      return commandText(action.answer, lang);
    case "reaction": {
      const answer = action.answer;
      const name = ":" + action.emoji + ":";
      switch (answer.kind) {
        case "changed":
          return "";
        case "offline":
          return ru
            ? "Для изменения реакции нужна связь."
            : "Reconnect to change a reaction.";
        case "historyUnknown":
          return ru
            ? "История канала ещё загружается."
            : "Channel history is still loading.";
        case "noTarget":
          return ru
            ? "В канале нет сообщения для реакции."
            : "There’s no message to react to in this channel.";
        case "archived":
          return ru
            ? "Реакции в архивном канале доступны для чтения."
            : "Reactions in an archived channel are read-only.";
        case "permissionUnknown":
          return ru
            ? "Права на реакции ещё загружаются."
            : "Reaction permissions are still loading.";
        case "permissionDenied":
          return ru
            ? "Нет права изменить эту реакцию."
            : "You don’t have permission to change this reaction.";
        case "alreadyAdded":
          return ru
            ? `Вы уже поставили ${name}.`
            : `You’ve already added ${name}.`;
        case "notAdded":
          return ru
            ? `У вас нет реакции ${name} на этом сообщении.`
            : `You haven’t added ${name} to this message.`;
        case "limitUnknown":
          return ru
            ? "Пока неизвестно, сколько разных реакций разрешено."
            : "The server’s reaction limit is unavailable.";
        case "limitReached":
          return ru
            ? "На сообщении уже максимум разных реакций."
            : "This message has reached its limit for distinct reactions.";
        case "appliedWithDraftError":
          return ru
            ? "Реакция изменена. Не удалось очистить черновик."
            : "Reaction updated. Couldn’t clear the draft.";
        case "applied":
          return answer.action === "add"
            ? ru
              ? `Реакция ${name} поставлена.`
              : `Added ${name}.`
            : ru
              ? `Реакция ${name} снята.`
              : `Removed ${name}.`;
      }
    }
  }
}

function commandText(answer: Command, lang: EntryLanguage): string {
  const ru = lang === "ru";
  const uncertain = ru
    ? "Сервер мог выполнить команду. Проверьте результат перед повтором."
    : "The command may have run. Check its result before trying again.";
  switch (answer.kind) {
    case "offline":
      return ru
        ? "Для выполнения команды нужна связь."
        : "Reconnect to run the command.";
    case "unconfirmed":
      return uncertain;
    case "conflict":
      return answer.draft.commandPending
        ? uncertain
        : ru
          ? "Черновик изменился. Проверьте текст."
          : "The draft changed. Check the text.";
    case "answered":
      switch (answer.result.kind) {
        case "executed":
          return answer.result.response.responseType === "ephemeral" &&
            answer.result.response.text
            ? answer.result.response.text
            : ru
              ? "Команда выполнена."
              : "Command completed.";
        case "unknownCommand":
          return ru
            ? "На сервере нет такой команды."
            : "The server doesn’t recognize this command.";
        case "unauthorized":
          return ru
            ? "Войдите снова, чтобы выполнить команду."
            : "Sign in again to run the command.";
        case "refused":
          return (
            answer.result.refusal.message ||
            (ru
              ? "Сервер отклонил команду."
              : "The server declined the command.")
          );
      }
  }

  const exhausted: never = answer;
  return exhausted;
}
