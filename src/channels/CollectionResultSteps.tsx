import { type ReactNode, useEffect, useEffectEvent } from "react";
import { usesMacOSOverlay } from "../build-platform.ts";
import type { EntryLanguage } from "../entry/language.ts";
import { collectionCopy } from "./collection-copy.ts";
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
  steps,
  sourceTeam,
  remind,
  blocked,
  back,
  end,
  children,
}: {
  name: string;
  icon: ReactNode;
  backLabel: string;
  language: EntryLanguage;
  blocked: boolean;
  back: () => void;
  end: (control: HTMLButtonElement) => void;
  children?: ReactNode;
} & (
  | {
      steps: {
        index: number;
        count: number;
        partial: boolean;
        open: (delta: -1 | 1, control: HTMLElement) => void;
      };
      sourceTeam?: never;
      remind?: never;
    }
  | { steps?: never; sourceTeam: string; remind: () => void }
)) {
  const text = copy[language];
  const saved = collectionCopy[language];
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
    if (!steps) {
      remind();
      return;
    }
    const delta = event.shiftKey ? -1 : 1;
    if (steps.index + delta >= 0 && steps.index + delta < steps.count)
      steps.open(
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
    <fieldset
      className="collection-result-steps"
      aria-label={name}
      data-cross-team={Boolean(sourceTeam) || undefined}
    >
      <span className="collection-step-source" aria-hidden="true">
        {icon}
        <span>{name}</span>
      </span>
      {steps ? (
        <>
          <span
            className="collection-step-count"
            role="status"
            title={steps.partial ? text.partial : undefined}
          >
            {text.position(steps.index + 1, steps.count)}
            {steps.partial ? "+" : ""}
          </span>
          <button
            type="button"
            className="channels-icon-action"
            aria-label={text.previous}
            title={text.previous}
            aria-keyshortcuts={`Shift+${shortcut}`}
            disabled={blocked || steps.index === 0}
            onClick={(event) => steps.open(-1, event.currentTarget)}
          >
            <StepIcon path="m14 5-7 7 7 7" />
          </button>
          <button
            type="button"
            className="channels-icon-action"
            aria-label={text.next}
            title={text.next}
            aria-keyshortcuts={shortcut}
            disabled={blocked || steps.index === steps.count - 1}
            onClick={(event) => steps.open(1, event.currentTarget)}
          >
            <StepIcon path="m10 5 7 7-7 7" />
          </button>
        </>
      ) : (
        <span className="collection-step-count">
          {saved.sourceTeam(sourceTeam)}
        </span>
      )}
      <button
        type="button"
        className="collection-step-back"
        aria-label={sourceTeam && saved.savedBackIn(sourceTeam)}
        disabled={Boolean(sourceTeam) && blocked}
        onClick={back}
      >
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
      {children}
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
