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
import type { openAccountRestConnection } from "../mattermost/native-rest.ts";
import { isSavedPostWriteRefused } from "../mattermost/post-collection-actions.ts";
import { canonicalServerUrl } from "../mattermost/server-url.ts";
import { workspaceFailure } from "./workspace-data.ts";

type SavingConnection = Pick<
  Awaited<ReturnType<typeof openAccountRestConnection>>,
  | "getSavedPostState"
  | "getSavedPostPresentation"
  | "isSavedPostPending"
  | "subscribeToSavedPostState"
  | "setPostSaved"
>;

const postActionText = {
  en: {
    actions: "Message actions",
    reply: "Reply in thread",
    openThread: "Open thread",
    copy: "Copy link",
    copied: "Message link copied.",
    failed: "Couldn’t copy the link.",
    close: "Close",
    save: "Save",
    unsave: "Remove from Saved",
    saving: "Saving…",
    removing: "Removing…",
    savedLoading: "Loading saved messages…",
    savedOffline: "Offline. Saved messages haven’t loaded.",
    savedReadFailed: "Couldn’t load saved messages.",
    savedReadRefused: "The server refused to load saved messages.",
    savedUnconfirmed: "Couldn’t confirm whether the message was saved.",
    savedConfirmed: "Saved. Only you can see your saved messages.",
    unsavedConfirmed: "Removed from Saved.",
    saveFailed: (save: boolean, reason: "offline" | "refused" | "network") =>
      (save
        ? "Couldn’t save the message. "
        : "Couldn’t remove it from Saved. ") +
      (reason === "refused"
        ? "The server refused the request."
        : reason === "offline"
          ? "You’re offline."
          : "Check your connection."),
  },
  ru: {
    actions: "Действия с сообщением",
    reply: "Ответить в треде",
    openThread: "Открыть тред",
    copy: "Скопировать ссылку",
    copied: "Ссылка на сообщение скопирована.",
    failed: "Не удалось скопировать ссылку.",
    close: "Закрыть",
    save: "Сохранить",
    unsave: "Убрать из сохранённых",
    saving: "Сохраняем…",
    removing: "Убираем…",
    savedLoading: "Загружаем сохранённые…",
    savedOffline: "Нет связи: сохранённые не загружены",
    savedReadFailed: "Не удалось загрузить сохранённые",
    savedReadRefused: "Не загрузились: сервер отказал",
    savedUnconfirmed: "Неизвестно, сохранилось ли",
    savedConfirmed: "Сохранено. «Сохранённые» видите только вы",
    unsavedConfirmed: "Убрано из сохранённых",
    saveFailed: (save: boolean, reason: "offline" | "refused" | "network") =>
      (save ? "Не сохранили: " : "Не убрали из сохранённых: ") +
      (reason === "refused"
        ? "сервер отказал. Сообщение не изменилось"
        : reason === "offline"
          ? "нет связи"
          : "не удалось связаться с сервером"),
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
  account: SavingConnection,
  online: boolean,
  sessionIssue: (issue: "session" | "unauthorized") => void,
) {
  const presentation = useMemo(() => ({ route }), [route]);
  const text = postActionText[locale];
  const [allowed, setAllowed] = useState(!isAndroid);
  const [menu, setMenu] = useState<{
    anchor: HTMLButtonElement;
    presentation: typeof presentation;
  } | null>(null);
  const [notice, setNotice] = useState<{
    presentation?: typeof presentation;
    message: string;
  } | null>(null);
  const active = useRef<typeof presentation | null>(null);
  const savingOwner = useRef<SavingConnection | null>(null);
  const clipboardGrant = useRef<symbol | null>(isAndroid ? null : Symbol());
  useLayoutEffect(() => {
    active.current = presentation;
    return () => {
      active.current = null;
    };
  }, [presentation]);
  useLayoutEffect(() => {
    savingOwner.current = account;
    return () => {
      savingOwner.current = null;
    };
  }, [account]);
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
  if (notice?.presentation && notice.presentation !== presentation)
    setNotice(null);
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
  async function changeSaved(postId: string, desired: boolean) {
    if (!online) {
      setNotice({ message: text.saveFailed(desired, "offline") });
      return;
    }
    let message: string;
    try {
      await account.setPostSaved(postId, desired);
      message = desired ? text.savedConfirmed : text.unsavedConfirmed;
    } catch (error) {
      if (savingOwner.current !== account) return;
      const failure = workspaceFailure(error, "network");
      if (failure === "session" || failure === "unauthorized") {
        sessionIssue(failure);
        return;
      }
      message =
        account.getSavedPostPresentation(postId) === "unconfirmed"
          ? text.savedUnconfirmed
          : text.saveFailed(
              desired,
              isSavedPostWriteRefused(error) ? "refused" : "network",
            );
    }
    if (savingOwner.current === account) setNotice({ message });
  }
  return {
    allowed,
    canReply,
    account,
    online,
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
    save(
      postId: string,
      desired: boolean,
      origin: HTMLElement,
      beforeSend?: () => void,
    ) {
      if (
        !isCurrent(origin) ||
        savingOwner.current !== account ||
        account.isSavedPostPending(postId) ||
        account.getSavedPostState(postId) !== !desired
      )
        return;
      beforeSend?.();
      void changeSaved(postId, desired);
    },
    prefix: `${canonicalServerUrl(serverUrl)}/${encodeURIComponent(teamName)}/pl/`,
    userId,
    text,
  };
}

export const PostActionScope = createContext<ReturnType<
  typeof usePostActionScope
> | null>(null);
