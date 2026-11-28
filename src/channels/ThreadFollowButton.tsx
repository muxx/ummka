import { useId, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { EntryLanguage } from "../entry/language.ts";
import type { openThreadFollowControl } from "./thread-follow-control.ts";

const copy = {
  en: {
    follow: "Follow",
    following: "Following",
    checking: "Checking…",
    starting: "Following…",
    stopping: "Unfollowing…",
    check: "Check",
    on: "Follow this thread and receive notifications about replies",
    off: "You receive notifications about replies. Stop following",
    unknown: "The subscription status is unknown.",
    offline: "The subscription status is unknown: you’re offline.",
    lostOn: "It’s unclear whether you’re following this thread.",
    lostOff: "It’s unclear whether you stopped following this thread.",
    refusedOn: "The server refused to follow this thread.",
    refusedOff: "The server refused to unfollow this thread.",
  },
  ru: {
    follow: "Отслеживать",
    following: "Отслеживается",
    checking: "Проверяем…",
    starting: "Включаем…",
    stopping: "Выключаем…",
    check: "Проверить",
    on: "Отслеживать обсуждение и получать уведомления об ответах",
    off: "Вы получаете уведомления об ответах. Нажмите, чтобы не отслеживать",
    unknown: "Статус подписки неизвестен.",
    offline: "Статус подписки неизвестен: нет связи.",
    lostOn: "Неизвестно, включилось ли отслеживание.",
    lostOff: "Неизвестно, выключилось ли отслеживание.",
    refusedOn: "Не включили отслеживание: сервер отказал.",
    refusedOff: "Не выключили отслеживание: сервер отказал.",
  },
} as const;

export function ThreadFollowButton({
  control,
  host,
  locale,
  online,
}: {
  control: ReturnType<typeof openThreadFollowControl>;
  host: HTMLSpanElement;
  locale: EntryLanguage;
  online: boolean;
}) {
  const state = useSyncExternalStore(control.subscribe, control.getSnapshot);
  const { value, phase, wanted } = state;
  const button = useRef<HTMLButtonElement>(null);
  const previous = useRef(state);
  useLayoutEffect(() => {
    const old = previous.current;
    previous.current = state;
    if (old.phase !== "saving" || phase !== "ready" || value === old.value)
      return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const motion = button.current?.animate?.(
      [
        { transform: "scale(1)" },
        { transform: "scale(1.05)" },
        { transform: "scale(1)" },
      ],
      { duration: 180, easing: "ease-out" },
    );
    return () => motion?.cancel();
  }, [state, phase, value]);

  const id = useId();
  const text = copy[locale];
  const check = phase === "unknown" || (!online && value === undefined);
  const reading = phase === "checking" || (!check && value === undefined);
  const busy = reading || phase === "saving";
  const label =
    phase === "saving"
      ? wanted
        ? text.starting
        : text.stopping
      : reading
        ? text.checking
        : check
          ? text.check
          : value
            ? text.following
            : text.follow;
  const detail = check
    ? !online
      ? text.offline
      : wanted === undefined
        ? text.unknown
        : wanted
          ? text.lostOn
          : text.lostOff
    : phase === "refused"
      ? wanted
        ? text.refusedOn
        : text.refusedOff
      : null;
  return createPortal(
    <>
      <button
        ref={button}
        type="button"
        className="thread-follow-toggle"
        aria-pressed={check || reading ? undefined : value}
        aria-disabled={!online || busy}
        aria-busy={busy || undefined}
        aria-describedby={detail ? id : undefined}
        title={
          phase === "ready" && value !== undefined
            ? value
              ? text.off
              : text.on
            : label
        }
        onClick={() => {
          if (!online || busy) return;
          if (check) void control.check();
          else void control.toggle();
        }}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {check || reading ? (
            <path d="M20 5v5h-5m4.6-.3A8 8 0 1 0 20 15" />
          ) : value ? (
            <path d="m5 12 4 4 10-10" />
          ) : (
            <>
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9Z" />
              <path d="M10 20a2 2 0 0 0 4 0" />
            </>
          )}
        </svg>
        <span>{label}</span>
      </button>
      {detail && (
        <p
          id={id}
          role="status"
          className="thread-heading-context thread-follow-status"
        >
          {detail}
        </p>
      )}
    </>,
    host,
  );
}
