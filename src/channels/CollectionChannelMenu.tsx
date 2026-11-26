import {
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
import type { EntryLanguage } from "../entry/language.ts";
import { collectionCopy } from "./collection-copy.ts";

export function CollectionChannelMenu({
  headingId,
  headingRef,
  title,
  language,
  trigger,
  open,
  setOpen,
  onPins,
}: {
  headingId: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  title: string;
  language: EntryLanguage;
  trigger: RefObject<HTMLButtonElement | null>;
  open: boolean;
  setOpen: (value: boolean) => void;
  onPins: (trigger: HTMLButtonElement) => void;
}) {
  const text = collectionCopy[language],
    id = useId();
  const wrapper = useRef<HTMLDivElement>(null),
    action = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (open) action.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    function outside(event: Event) {
      if (
        event.target instanceof Node &&
        !wrapper.current?.contains(event.target)
      )
        setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open, setOpen]);
  return (
    <div ref={wrapper} className="collection-channel-menu">
      <h1 id={headingId} ref={headingRef} tabIndex={-1} aria-label={title}>
        <button
          type="button"
          ref={trigger}
          className="collection-channel-trigger"
          aria-label={`${text.menu}, ${title}`}
          aria-controls={open ? id : undefined}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span>{title}</span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </h1>
      {open && (
        <button
          id={id}
          type="button"
          className="collection-channel-action"
          ref={action}
          onClick={() => {
            if (trigger.current) onPins(trigger.current);
          }}
        >
          {text.pins}
        </button>
      )}
    </div>
  );
}
