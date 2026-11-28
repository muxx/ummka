import {
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { EntryLanguage } from "../entry/language.ts";

const copy = {
  en: {
    open: "Show in full",
    close: "Collapse",
    openCard: "Show full card",
    closeCard: "Collapse card",
  },
  ru: {
    open: "Показать полностью",
    close: "Свернуть",
    openCard: "Показать карточку полностью",
    closeCard: "Свернуть карточку",
  },
};
const bodyLimit = 200;
const clipped = "data-card-disclosure-clipped";
const controls = "a[href], button, input, select, textarea, [tabindex]";
const textFragment = "data-card-text-fragment";
const textTail = "data-card-text-tail";

// This leaf owns its text node. Measuring the visual line and splitting its
// inaccessible tail never changes a React-managed child.
export function CardBodyText({ children }: { children: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (ref.current) ref.current.textContent = children;
  }, [children]);
  return <span ref={ref} data-card-text-fragment="" />;
}

function wholeLines(content: HTMLElement, top: number) {
  const range = document.createRange();
  range.selectNodeContents(content);
  let height = 0;
  for (const rect of range.getClientRects()) {
    const bottom = rect.bottom - top;
    if (rect.height > 0 && bottom <= bodyLimit)
      height = Math.max(height, bottom);
  }
  return height;
}

function exposeContent(content: HTMLElement) {
  for (const tail of content.querySelectorAll(`[${textTail}]`)) {
    const first = tail.previousSibling;
    if (first instanceof Text) first.appendData(tail.textContent ?? "");
    tail.remove();
  }
  for (const node of content.querySelectorAll(`[${clipped}]`)) {
    const hidden = node.getAttribute(clipped);
    if (hidden) node.setAttribute("aria-hidden", hidden);
    else node.removeAttribute("aria-hidden");
    node.removeAttribute(clipped);
    node.removeAttribute("inert");
  }
}

function clipContent(content: HTMLElement, cutoff: number) {
  const range = document.createRange();
  function split(node: Element) {
    const text = node.firstChild;
    if (!(text instanceof Text) || !text.length) return;
    range.selectNodeContents(text);
    const below = () =>
      Array.from(range.getClientRects()).some(
        (rect) => rect.height > 0 && rect.bottom > cutoff + 0.02,
      );
    if (!below()) return;
    let lower = 0;
    let upper = text.length;
    while (lower < upper) {
      const end = Math.ceil((lower + upper) / 2);
      range.setEnd(text, end);
      if (below()) upper = end - 1;
      else lower = end;
    }
    const tail = document.createElement("span");
    tail.setAttribute(textTail, "");
    tail.setAttribute("inert", "");
    tail.setAttribute("aria-hidden", "true");
    tail.append(text.splitText(lower));
    node.append(tail);
  }
  function clip(node: Element) {
    const rect = node.getBoundingClientRect();
    if (
      rect.height > 0 &&
      (rect.top >= cutoff || (rect.bottom > cutoff && node.matches(controls)))
    ) {
      if (!node.hasAttribute("inert")) {
        node.setAttribute(clipped, node.getAttribute("aria-hidden") ?? "");
        node.setAttribute("inert", "");
        node.setAttribute("aria-hidden", "true");
      }
    } else if (node.hasAttribute(textFragment)) {
      split(node);
    } else {
      for (const child of node.children) clip(child);
    }
  }
  for (const child of content.children) clip(child);
}

export function IntegrationCardDisclosure({
  children,
  fields,
  footer,
  label,
  locale,
}: {
  children?: ReactNode;
  fields?: ReactNode;
  footer?: string;
  label: string;
  locale: EntryLanguage;
}) {
  const id = useId();
  const body = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const focusAfterTrim = useRef(false);
  const next = useRef<HTMLElement | undefined>(undefined);
  const scrollAfterTransition = useRef<boolean | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  const [height, setHeight] = useState<number>();
  const [footerOverflows, setFooterOverflows] = useState(false);
  const folded = height !== undefined && !expanded;

  useLayoutEffect(() => {
    const content = children ? body.current : null;
    const footerNode = footer ? foot.current : null;
    if (!content && !footerNode) {
      setHeight(undefined);
      setFooterOverflows(false);
      return;
    }
    if (!content) setHeight(undefined);
    if (!footerNode) setFooterOverflows(false);
    function measure() {
      const bounds = content?.getBoundingClientRect();
      let limited: number | undefined;
      if (content && bounds?.width) {
        const active = document.activeElement;
        exposeContent(content);
        limited =
          bounds.height > bodyLimit
            ? wholeLines(content, bounds.top)
            : undefined;
        if (limited !== undefined && !expanded)
          clipContent(content, bounds.top + limited);
        if (active?.closest(`[${clipped}]`)) {
          if (button.current) button.current.focus({ preventScroll: true });
          else focusAfterTrim.current = true;
        }
        setHeight(limited);
      }
      const footerOverflow = footerNode?.clientWidth
        ? expanded
          ? footerNode.scrollHeight >
            parseFloat(getComputedStyle(footerNode).lineHeight) + 1
          : footerNode.scrollWidth > footerNode.clientWidth + 1
        : undefined;
      if (footerOverflow !== undefined) setFooterOverflows(footerOverflow);
      if (
        limited === undefined &&
        !footerOverflow &&
        (bounds?.width || footerNode?.clientWidth) &&
        button.current === document.activeElement
      ) {
        // The control is about to leave the DOM. Keep keyboard focus on the
        // nearest meaningful text instead of leaving the reading position.
        const card = button.current?.closest<HTMLElement>(
          "[data-published-card]",
        );
        const destination =
          card?.querySelector<HTMLElement>(
            ".published-integration-card-title",
          ) ?? card;
        if (destination) {
          destination.tabIndex = -1;
          destination.focus({ preventScroll: true });
        }
      }
    }
    measure();
    const observer = new ResizeObserver(measure);
    if (content) observer.observe(content);
    if (footerNode) observer.observe(footerNode);
    return () => observer.disconnect();
  }, [children, footer, expanded]);

  useLayoutEffect(() => {
    if (height !== undefined && focusAfterTrim.current && button.current) {
      focusAfterTrim.current = false;
      button.current.focus({ preventScroll: true });
    }
  }, [height]);

  useLayoutEffect(() => {
    if (expanded !== scrollAfterTransition.current) return;
    scrollAfterTransition.current = undefined;
    button.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [expanded]);

  const text = copy[locale];
  return (
    <>
      {children && (
        <div
          className="published-card-viewport"
          id={`${id}-body`}
          data-published-card-part="body"
          data-folded={folded || undefined}
          style={folded ? { maxBlockSize: height } : undefined}
        >
          <div className="published-card-body" ref={body}>
            {children}
          </div>
        </div>
      )}
      {(height !== undefined || footerOverflows) && (
        <button
          className="published-card-action"
          type="button"
          ref={button}
          data-published-disclosure-action=""
          aria-label={`${expanded ? text.closeCard : text.openCard}: ${label}`}
          aria-expanded={expanded}
          aria-controls={[children && `${id}-body`, footer && `${id}-footer`]
            .filter(Boolean)
            .join(" ")}
          onClick={(event) => {
            event.stopPropagation();
            next.current = expanded
              ? undefined
              : Array.from(
                  body.current?.querySelectorAll<HTMLElement>(controls) ?? [],
                ).find(
                  (control) =>
                    control.closest(`[${clipped}]`) &&
                    !control.matches(":disabled"),
                );
            event.currentTarget.focus({ preventScroll: true });
            scrollAfterTransition.current = !expanded;
            setExpanded(!expanded);
          }}
          onBlur={() => {
            next.current = undefined;
          }}
          onKeyDown={(event) => {
            if (event.key !== "Tab" || event.shiftKey) return;
            const target = next.current;
            next.current = undefined;
            if (!target?.isConnected || target.closest("[inert], [hidden]"))
              return;
            event.preventDefault();
            target.focus();
          }}
        >
          {expanded ? text.close : text.open}
        </button>
      )}
      {fields}
      {footer && (
        <div
          className="published-card-footer"
          id={`${id}-footer`}
          ref={foot}
          data-expanded={expanded || undefined}
        >
          {footer}
        </div>
      )}
    </>
  );
}
