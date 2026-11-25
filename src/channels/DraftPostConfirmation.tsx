import { useId, useLayoutEffect, useRef } from "react";
import type { EntryLanguage } from "../entry/language.ts";
import type { mentionConfirmation } from "./mention-confirmation.ts";

export type MentionConfirmation = NonNullable<
  ReturnType<typeof mentionConfirmation>["confirmation"]
>;

type Props = {
  language: EntryLanguage;
  confirmation: MentionConfirmation;
  conversation: { name: string; direct: boolean };
  confirm: () => void;
  cancel: () => void;
};

function describe({
  language,
  confirmation,
  conversation,
}: Pick<Props, "language" | "confirmation" | "conversation">) {
  const { kind, members, timezones, mentions } = confirmation;
  const group = kind === "groups";
  const many = mentions.length > 1;
  const list = new Intl.ListFormat(language, {
    style: "long",
    type: "conjunction",
  }).format(mentions);
  if (language === "ru") {
    const verb = many ? "уведомят" : "уведомит";
    const title = group
      ? many
        ? "группы"
        : "группу"
      : kind === "here"
        ? "всех в сети"
        : conversation.direct
          ? "всю беседу"
          : "весь канал";
    const location = conversation.direct ? "беседы" : "канала";
    const people = new Intl.PluralRules("ru").select(members);
    const crowd =
      kind === "channel"
        ? people === "few"
          ? "человека"
          : "человек"
        : people === "one"
          ? "человека"
          : "человек";
    const zones =
      timezones > 1
        ? ` в ${timezones} ${new Intl.PluralRules("ru").select(timezones) === "one" ? "часовом поясе" : "часовых поясах"}`
        : "";
    const number = `${members} ${crowd}${zones}.`;
    const place = `${location} «${conversation.name}»`;
    const description = group
      ? `Уведомление получат участники ${many ? "групп" : "группы"} ${conversation.direct ? "в беседе" : "в канале"} «${conversation.name}». Не меньше ${number}`
      : kind === "here"
        ? `Уведомление получат участники ${place}, которые сейчас в сети. До ${number}`
        : `Уведомление получат все участники ${place}. ${number}`;
    return {
      title: `${list} ${verb} ${title}`,
      description,
      confirm: "Отправить",
      cancel: "Отмена",
    };
  }
  const place = `${conversation.direct ? "conversation" : "channel"} “${conversation.name}”`;
  const title = group
    ? many
      ? "the groups"
      : "the group"
    : kind === "here"
      ? "everyone online"
      : conversation.direct
        ? "the whole conversation"
        : "the whole channel";
  const count = `${members} ${members === 1 ? "person" : "people"}`;
  const zones = timezones > 1 ? ` across ${timezones} time zones` : "";
  const description = group
    ? `At least ${count} in the ${place} will be notified${zones}.`
    : kind === "here"
      ? `Up to ${count} who are online in the ${place} will be notified${zones}.`
      : `Everyone else in the ${place} will be notified. That’s ${count}${zones}.`;
  return {
    title: `${list} will notify ${title}`,
    description,
    confirm: "Send",
    cancel: "Cancel",
  };
}

export function DraftPostConfirmation(props: Props) {
  const id = useId();
  const send = useRef<HTMLButtonElement>(null);
  const text = describe(props);
  useLayoutEffect(() => {
    send.current?.focus({ preventScroll: true });
  }, []);
  return (
    <fieldset
      className="draft-mention"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        props.cancel();
      }}
    >
      <legend id={`${id}-title`}>{text.title}</legend>
      <p id={`${id}-description`}>{text.description}</p>
      <div className="draft-mention-actions">
        <button type="button" onClick={props.cancel}>
          {text.cancel}
        </button>
        <button type="button" ref={send} onClick={props.confirm}>
          {text.confirm}
        </button>
      </div>
    </fieldset>
  );
}
