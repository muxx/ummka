import {
  createContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isAndroid } from "../build-platform.ts";
import {
  observeClipboardAllowed,
  readClipboardAllowed,
} from "../device/clipboard-policy.ts";
import type { EntryLanguage } from "../entry/language.ts";
import { canonicalServerUrl } from "../mattermost/server-url.ts";

const postActionText = {
  en: {
    actions: "Message actions",
    reply: "Reply in thread",
    openThread: "Open thread",
    copy: "Copy link",
    copied: "Message link copied.",
    failed: "Couldn’t copy the link.",
    close: "Close",
  },
  ru: {
    actions: "Действия с сообщением",
    reply: "Ответить в треде",
    openThread: "Открыть тред",
    copy: "Скопировать ссылку",
    copied: "Ссылка на сообщение скопирована.",
    failed: "Не удалось скопировать ссылку.",
    close: "Закрыть",
  },
};

export async function copyToClipboard(value: string, isCurrent: () => boolean) {
  if (!isCurrent()) return false;
  const allowed = !isAndroid || (await readClipboardAllowed());
  if (!isCurrent()) return false;
  if (!allowed) throw Error("Clipboard restricted");
  await navigator.clipboard.writeText(value);
  return true;
}

export function usePostActionScope(
  route: string,
  serverUrl: string,
  teamName: string,
  userId: string,
  locale: EntryLanguage,
  canReply: boolean,
) {
  const presentation = useMemo(() => ({ route }), [route]);
  const [allowed, setAllowed] = useState(!isAndroid);
  const [menu, setMenu] = useState<{
    anchor: HTMLButtonElement;
    presentation: typeof presentation;
  } | null>(null);
  const [notice, setNotice] = useState<{
    presentation: typeof presentation;
    message: string;
  } | null>(null);
  const active = useRef<typeof presentation | null>(null);
  const clipboardGrant = useRef<symbol | null>(isAndroid ? null : Symbol());
  useLayoutEffect(() => {
    active.current = presentation;
    return () => {
      active.current = null;
    };
  }, [presentation]);
  useEffect(
    () =>
      observeClipboardAllowed((next) => {
        // A re-grant in the same render batch cannot authorize an earlier click.
        clipboardGrant.current = next
          ? (clipboardGrant.current ?? Symbol())
          : null;
        setAllowed(next);
      }),
    [],
  );
  if (menu && menu.presentation !== presentation) setMenu(null);
  if (notice && notice.presentation !== presentation) setNotice(null);
  const ownsRoute = useCallback(
    () => active.current === presentation,
    [presentation],
  );
  const isCurrent = useCallback(
    (origin: HTMLElement) => ownsRoute() && origin.isConnected,
    [ownsRoute],
  );
  const close = useCallback((origin: HTMLButtonElement) => {
    setMenu((current) => (current?.anchor === origin ? null : current));
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  return {
    allowed,
    canReply,
    anchor: menu?.anchor,
    open: (anchor: HTMLButtonElement) => setMenu({ anchor, presentation }),
    close,
    notice,
    ownsRoute,
    isCurrent,
    copyGuard(origin: HTMLElement) {
      const grant = clipboardGrant.current;
      return () =>
        grant !== null && clipboardGrant.current === grant && isCurrent(origin);
    },
    notify(origin: HTMLElement, message: string) {
      if (isCurrent(origin)) setNotice({ presentation, message });
    },
    prefix: `${canonicalServerUrl(serverUrl)}/${encodeURIComponent(teamName)}/pl/`,
    userId,
    text: postActionText[locale],
  };
}

export const PostActionScope = createContext<ReturnType<
  typeof usePostActionScope
> | null>(null);
