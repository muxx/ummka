import { type ReactNode, useEffect, useEffectEvent } from "react";
import { usesMacOSOverlay } from "../build-platform.ts";
import type { EntryLanguage } from "../entry/language.ts";
import "./collection-result-steps.css";

const copy = {
  en: {
    previous: "Previous in list",
    next: "Next in list",
    end: "Finish browsing the list",
    position: (index: number, total: number) => `${index} of ${total}`,
    partial: "The rest of the list hasn’t loaded yet.",
  },
  ru: {
    previous: "Предыдущее в списке",
    next: "Следующее в списке",
    end: "Закончить просмотр списка",
    position: (index: number, total: number) => `${index} из ${total}`,
    partial: "Список загружен не до конца",
  },
};

export function CollectionResultSteps({
  name,
  icon,
  backLabel,
  language,
  index,
  count,
  partial,
  blocked,
  step,
  back,
  end,
}: {
  name: string;
  icon: ReactNode;
  backLabel: string;
  language: EntryLanguage;
  index: number;
  count: number;
  partial: boolean;
  blocked: boolean;
  step: (delta: -1 | 1, control: HTMLElement) => void;
  back: () => void;
  end: (control: HTMLButtonElement) => void;
}) {
  const text = copy[language];
  const onStepKey = useEffectEvent((event: KeyboardEvent) => {
    if (
      blocked ||
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.code !== "KeyG" ||
      !(usesMacOSOverlay
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey) ||
      document.querySelector("dialog[open]")
    )
      return;
    event.preventDefault();
    const delta = event.shiftKey ? -1 : 1;
    if (index + delta >= 0 && index + delta < count)
      step(
        delta,
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : document.body,
      );
  });
  useEffect(() => {
    const handle = (event: KeyboardEvent) => onStepKey(event);
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);
  const shortcut = usesMacOSOverlay ? "Meta+G" : "Control+G";
  return (
    <fieldset className="collection-result-steps" aria-label={name}>
      <span className="collection-step-source" aria-hidden="true">
        {icon}
        <span>{name}</span>
      </span>
      <span
        className="collection-step-count"
        role="status"
        title={partial ? text.partial : undefined}
      >
        {text.position(index + 1, count)}
        {partial ? "+" : ""}
      </span>
      <button
        type="button"
        className="channels-icon-action"
        aria-label={text.previous}
        title={text.previous}
        aria-keyshortcuts={`Shift+${shortcut}`}
        disabled={blocked || index === 0}
        onClick={(event) => step(-1, event.currentTarget)}
      >
        <StepIcon path="m14 5-7 7 7 7" />
      </button>
      <button
        type="button"
        className="channels-icon-action"
        aria-label={text.next}
        title={text.next}
        aria-keyshortcuts={shortcut}
        disabled={blocked || index === count - 1}
        onClick={(event) => step(1, event.currentTarget)}
      >
        <StepIcon path="m10 5 7 7-7 7" />
      </button>
      <button type="button" className="collection-step-back" onClick={back}>
        {backLabel}
      </button>
      <button
        type="button"
        className="channels-icon-action"
        aria-label={text.end}
        title={text.end}
        onClick={(event) => end(event.currentTarget)}
      >
        <StepIcon path="m6 6 12 12M18 6 6 18" />
      </button>
    </fieldset>
  );
}

function StepIcon({ path }: { path: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}
