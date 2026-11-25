import { useId, useLayoutEffect, useRef, useState } from "react";
import type { EntryLanguage } from "../entry/language.ts";
import type { PendingCommandAction } from "./resolve-pending-command.ts";

const copy = {
  en: {
    recorded: "The device still has an open attempt for",
    knownResult: "The server responded. Your saved draft could not be updated.",
    unknown: "It’s unclear whether the command ran",
    interrupted:
      "The connection closed before a response arrived. The command won’t run again on its own.",
    restored:
      "No response was saved before the app closed. The command won’t run again on its own.",
    repeat: "Run again",
    edit: "Edit text",
    clear: "Clear field",
    confirm: "Run anyway",
    cancel: "Cancel",
    warning:
      "If the server already ran the command, running it again will execute it twice.",
  },
  ru: {
    recorded: "На устройстве осталась отметка команды",
    knownResult: "Сервер ответил. Обновить черновик на устройстве не удалось.",
    unknown: "Неизвестно, выполнилась ли команда",
    interrupted: "Связь прервалась после передачи. Сама команда не повторится.",
    restored:
      "Ответа не было до закрытия приложения. Сама команда не повторится.",
    repeat: "Выполнить ещё раз",
    edit: "Изменить текст",
    clear: "Очистить поле",
    confirm: "Всё равно выполнить",
    cancel: "Отмена",
    warning:
      "Если команда уже выполнилась, она выполнится второй раз. Сервер не распознает повтор.",
  },
};

export function PendingCommandActions({
  language,
  message,
  known,
  interrupted,
  online,
  busy,
  act,
}: {
  language: EntryLanguage;
  message: string;
  known: boolean;
  interrupted: boolean;
  online: boolean;
  busy: boolean;
  act: (action: PendingCommandAction) => void;
}) {
  const text = copy[language];
  const [asking, setAsking] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);
  const title = useId();
  const warning = useId();
  function ask(value: boolean) {
    moveFocus.current = true;
    setAsking(value);
  }
  useLayoutEffect(() => {
    if (moveFocus.current)
      (asking ? confirm : first).current?.focus({ preventScroll: true });
    moveFocus.current = false;
  }, [asking]);
  return (
    <fieldset
      className="draft-pending"
      aria-labelledby={title}
      onKeyDown={(event) => {
        if (
          asking &&
          event.key === "Escape" &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          event.stopPropagation();
          ask(false);
        }
      }}
    >
      <legend id={title}>
        {known ? text.recorded : text.unknown} {message.split(/\s/u, 1)[0]}
      </legend>
      <p role="status">
        {known
          ? text.knownResult
          : interrupted
            ? text.interrupted
            : text.restored}
      </p>
      {asking ? (
        <>
          <p id={warning}>{text.warning}</p>
          <div>
            <button
              ref={confirm}
              aria-describedby={warning}
              type="button"
              disabled={!online || busy}
              onClick={() => act("repeat")}
            >
              {text.confirm}
            </button>
            <button type="button" disabled={busy} onClick={() => ask(false)}>
              {text.cancel}
            </button>
          </div>
        </>
      ) : (
        <div>
          <button
            ref={first}
            type="button"
            disabled={!online || busy}
            onClick={() => ask(true)}
          >
            {text.repeat}
          </button>
          <button type="button" disabled={busy} onClick={() => act("edit")}>
            {text.edit}
          </button>
          <button type="button" disabled={busy} onClick={() => act("clear")}>
            {text.clear}
          </button>
        </div>
      )}
    </fieldset>
  );
}
