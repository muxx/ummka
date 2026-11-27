import { useCallback, useEffect, useRef, useState } from "react";
import type { ChannelsTarget } from "../mattermost/channels-link.ts";
import {
  connectInstallation,
  readInstallationSelection,
  selectInstallation,
} from "../mattermost/installation-registry.ts";
import {
  type SystemChannelsLink,
  watchSystemChannelsLinks,
} from "../mattermost/system-channels-links.ts";
import type { EntryLanguage } from "./language.ts";

type Target = Extract<ChannelsTarget, { kind: "permalink" }>;
type RejectedTarget = Exclude<ChannelsTarget, Target>;
type RejectedLink =
  | { kind: "unknown" }
  | {
      kind: "unsupported";
      serverUrl: string;
      place: "threads" | "channels" | "messages";
    };
export type EntryLinkResult = RejectedLink & {
  waiting?: number;
  close: () => void;
};
type Stop = "paused" | "unavailable" | "archived" | "failed";
export type SystemPostRequest = {
  deliveryId: string;
  target: Target;
  signal: AbortSignal;
  matchesUser: (userId: string) => boolean;
  shown: (postId: string) => void;
  dismiss: () => void;
  stop: (reason: Stop, membership?: string) => void;
};
type State =
  | {
      kind: "switching" | Stop;
      serverUrl?: string;
      membership?: string;
    }
  | (RejectedLink & { id: string; close: () => void })
  | { kind: "target"; request: SystemPostRequest; installations: string[] }
  | { kind: "inbox"; id?: string };
type Gate = {
  link: SystemChannelsLink;
  finish: () => void;
  controller?: AbortController;
  selecting?: Promise<void>;
};
const copy = {
  en: {
    unknown: "This link does not match a supported address on a saved server.",
    unsupported: "This type of system link is not supported yet.",
    switching: "Opening the linked server…",
    target: "This link opens a message on",
    wait: "Sign in to open the linked message on",
    paused: "The linked message is waiting.",
    failed: "Couldn’t open the linked message.",
    unavailable: "This message is unavailable.",
    archived: "This message is outside the available history.",
    inbox: "Couldn’t process the incoming link.",
    retry: "Try again",
    close: "Don’t open this link",
  },
  ru: {
    unknown: "Не удалось распознать адрес среди сохранённых серверов.",
    unsupported: "Этот тип системной ссылки пока не поддерживается.",
    switching: "Открываем сервер из ссылки…",
    target: "Ссылка ведёт к сообщению на",
    wait: "Войдите, чтобы открыть сообщение на",
    paused: "Ссылка на сообщение ожидает продолжения.",
    failed: "Не удалось открыть сообщение по ссылке.",
    unavailable: "Сообщение недоступно.",
    archived: "Сообщение за границей доступной истории.",
    inbox: "Не удалось обработать входящую ссылку.",
    retry: "Повторить",
    close: "Не открывать ссылку",
  },
};
export function useSystemPermalink(
  language: EntryLanguage,
  reopen: () => void,
) {
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<State | null>(null);
  const [waiting, setWaiting] = useState<{ id: string; count?: number }>();
  const subscribeAgain = useRef<(() => void) | null>(null);
  const current = useRef<Gate | null>(null);
  const observer = useRef<Awaited<
    ReturnType<typeof watchSystemChannelsLinks>
  > | null>(null);
  // The sign-in form and the link inbox both write the device's selected server.
  const lastSelection = useRef(Promise.resolve());
  const enqueueSelection = useCallback((operation: () => Promise<void>) => {
    const next = lastSelection.current.then(operation, operation);
    lastSelection.current = next;
    return next;
  }, []);
  const pauseForServer = useCallback((serverUrl: string) => {
    const gate = current.current;
    const target = gate?.link.route?.target;
    if (
      gate &&
      target?.kind === "permalink" &&
      target.serverUrl !== serverUrl
    ) {
      gate.controller?.abort();
      setState({ kind: "paused", serverUrl: target.serverUrl });
    }
  }, []);
  const connect = useCallback(
    (serverUrl: string, signal: AbortSignal) => {
      pauseForServer(serverUrl);
      return enqueueSelection(() => {
        signal.throwIfAborted();
        return connectInstallation(serverUrl);
      });
    },
    [enqueueSelection, pauseForServer],
  );
  const selectSaved = useCallback(
    (serverUrl: string) =>
      enqueueSelection(async () => {
        await selectInstallation(serverUrl);
        pauseForServer(serverUrl);
        reopen();
      }),
    [enqueueSelection, pauseForServer, reopen],
  );
  const finish = useCallback(
    (gate: Gate, abort: boolean) => {
      if (current.current !== gate) return;
      current.current = null;
      if (abort) gate.controller?.abort();
      setState(null);
      setReady(true);
      // The host owns this write. A dismissed delivery must not race the next installation selection.
      const selection = gate.selecting;
      if (abort && selection) {
        void selection
          .then(
            () => {
              if (lastSelection.current === selection) reopen();
            },
            () => {},
          )
          .then(gate.finish);
      } else gate.finish();
    },
    [reopen],
  );
  const start = useCallback(
    async (gate: Gate, reload = false) => {
      let userId =
        !gate.controller && gate.link.route?.status === "ready"
          ? gate.link.route.userId
          : undefined;
      gate.controller?.abort();
      const controller = new AbortController();
      gate.controller = controller;
      const { signal } = controller;
      const target = gate.link.route?.target;
      if (target?.kind !== "permalink") {
        const rejected = describeRejectedLink(target);
        setState({
          ...rejected,
          id: gate.link.id,
          close: () => finish(gate, true),
        });
        setReady(true);
        return;
      }
      setState({ kind: "switching", serverUrl: target.serverUrl });
      try {
        // A completed manual selection determines which account the next link sees.
        await lastSelection.current.catch(() => {});
        signal.throwIfAborted();
        const { installations, selected } = await readInstallationSelection();
        signal.throwIfAborted();
        if (!installations.includes(target.serverUrl)) {
          setState({ kind: "unavailable" });
          setReady(true);
          return;
        }
        if (selected !== target.serverUrl) {
          const selection = enqueueSelection(() => {
            signal.throwIfAborted();
            return selectInstallation(target.serverUrl);
          });
          gate.selecting = selection;
          try {
            await selection;
          } finally {
            if (gate.selecting === selection) gate.selecting = undefined;
          }
          signal.throwIfAborted();
        }
        if (selected !== target.serverUrl || reload) reopen();
        const request: SystemPostRequest = {
          deliveryId: gate.link.id,
          target,
          signal,
          matchesUser: (id) => {
            userId ??= id;
            return userId === id;
          },
          shown: (id) => {
            if (!signal.aborted && id === target.postId) finish(gate, false);
          },
          dismiss: () => {
            if (!signal.aborted) finish(gate, true);
          },
          stop: (kind, membership) => {
            if (signal.aborted || current.current !== gate) return;
            controller.abort();
            setState({ kind, serverUrl: target.serverUrl, membership });
          },
        };
        setState({ kind: "target", request, installations });
      } catch {
        if (!signal.aborted)
          setState({ kind: "failed", serverUrl: target.serverUrl });
      } finally {
        if (!signal.aborted) setReady(true);
      }
    },
    [enqueueSelection, finish, reopen],
  );
  useEffect(() => {
    const life = new AbortController();
    const { signal } = life;
    const begin = (link: SystemChannelsLink) =>
      new Promise<void>((resolve, reject) => {
        const gone = () => {
          current.current?.controller?.abort();
          current.current = null;
          reject(signal.reason);
        };
        signal.addEventListener("abort", gone, { once: true });
        const gate: Gate = {
          link,
          finish: () => {
            signal.removeEventListener("abort", gone);
            resolve();
          },
        };
        current.current = gate;
        void start(gate);
      });
    function subscribe() {
      subscribeAgain.current = null;
      void watchSystemChannelsLinks(
        begin,
        (_error, id) => {
          if (!signal.aborted) {
            setState({ kind: "inbox", id });
            setReady(true);
          }
        },
        signal,
        {
          onEmpty: () => setReady(true),
          onWaiting: (id, count) => setWaiting({ id, count }),
        },
      )
        .then((active) => {
          if (!signal.aborted) observer.current = active;
        })
        .catch(() => {
          if (!signal.aborted) {
            subscribeAgain.current = subscribe;
            setState({ kind: "inbox" });
            setReady(true);
          }
        });
    }
    subscribe();
    return () => {
      life.abort();
      subscribeAgain.current = null;
      observer.current = null;
    };
  }, [start]);
  const request = state?.kind === "target" ? state.request : undefined;
  const installations =
    state?.kind === "target" ? state.installations : undefined;
  const entryResult: EntryLinkResult | undefined =
    state?.kind === "unknown" || state?.kind === "unsupported"
      ? {
          ...state,
          waiting: waiting?.id === state.id ? waiting.count : undefined,
        }
      : undefined;
  function dismiss() {
    if (current.current) finish(current.current, true);
    else if (state?.kind === "inbox" && state.id) {
      observer.current?.dismiss(state.id);
      setState(null);
    }
  }
  function retry(reload: boolean) {
    if (current.current) void start(current.current, reload);
    else if (observer.current) {
      setState(null);
      observer.current.retry();
    } else {
      setState(null);
      subscribeAgain.current?.();
    }
  }
  const text = copy[language];
  function notice(needsSignIn: boolean, otherServer: boolean) {
    if (!state) return null;
    const canRetry =
      state.kind === "failed" ||
      state.kind === "paused" ||
      state.kind === "inbox" ||
      otherServer;
    const address =
      state.kind === "target"
        ? state.request.target.serverUrl
        : "serverUrl" in state && state.kind !== "unsupported"
          ? state.serverUrl
          : undefined;
    const message =
      state.kind === "target" && needsSignIn ? text.wait : text[state.kind];
    return (
      <aside
        className="system-post-notice"
        aria-label={language === "ru" ? "Ссылка на сообщение" : "Message link"}
      >
        <p role="status">
          {"membership" in state && state.membership && state.membership + " "}
          {message} {address && <bdi>{address}</bdi>}
        </p>
        {canRetry && (
          <button type="button" onClick={() => retry(otherServer)}>
            {text.retry}
          </button>
        )}
        {(state.kind !== "inbox" || state.id) && (
          <button type="button" onClick={dismiss}>
            {text.close}
          </button>
        )}
      </aside>
    );
  }
  return {
    ready,
    request,
    installations,
    entryResult,
    notice,
    connect,
    selectSaved,
  };
}

function describeRejectedLink(
  target: RejectedTarget | undefined,
): RejectedLink {
  return target
    ? {
        kind: "unsupported",
        serverUrl: target.serverUrl,
        place: target.kind === "threads" ? "threads" : target.route,
      }
    : { kind: "unknown" };
}
