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
  for (const node of content.querySelectorAll(`[${clipped}]`)) {
    const hidden = node.getAttribute(clipped);
    if (hidden) node.setAttribute("aria-hidden", hidden);
    else node.removeAttribute("aria-hidden");
    node.removeAttribute(clipped);
    node.removeAttribute("inert");
  }
}

function clipContent(content: HTMLElement, cutoff: number) {
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
      if (content && bounds?.width) {
        const limited =
          bounds.height > bodyLimit
            ? wholeLines(content, bounds.top)
            : undefined;
        const active = document.activeElement;
        exposeContent(content);
        if (limited !== undefined && !expanded)
          clipContent(content, bounds.top + limited);
        if (active?.closest(`[${clipped}]`))
          button.current?.focus({ preventScroll: true });
        setHeight(limited);
      }
      if (footerNode?.clientWidth)
        setFooterOverflows(
          expanded
            ? footerNode.scrollHeight >
                parseFloat(getComputedStyle(footerNode).lineHeight) + 1
            : footerNode.scrollWidth > footerNode.clientWidth + 1,
        );
    }
    measure();
    const observer = new ResizeObserver(measure);
    if (content) observer.observe(content);
    if (footerNode) observer.observe(footerNode);
    return () => observer.disconnect();
  }, [children, footer, expanded]);

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
