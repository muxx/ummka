import { createContext, type ReactNode, useContext } from "react";
import type { publishedLinkTarget } from "./published-link-target.ts";
import type { PublishedReadingProposal } from "./published-reading-history.ts";

export const PublishedLinkNavigation = createContext<{
  serverUrl: string;
  open: (
    href: string,
    origin: HTMLAnchorElement,
    reading?: PublishedReadingProposal,
  ) => void;
} | null>(null);

export function PublishedPostLink({
  target,
  children,
}: {
  target: ReturnType<typeof publishedLinkTarget>;
  children: ReactNode;
}) {
  const navigation = useContext(PublishedLinkNavigation);
  if (!target || !navigation) return children;
  const href =
    target.kind === "sitePath"
      ? new URL(target.href, navigation.serverUrl).href
      : target.href;
  return (
    <a
      href={href}
      data-published-link=""
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        navigation.open(href, event.currentTarget);
      }}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        event.stopPropagation();
        navigation.open(href, event.currentTarget);
      }}
    >
      {children}
    </a>
  );
}
