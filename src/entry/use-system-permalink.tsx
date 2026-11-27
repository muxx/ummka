import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ChannelsTarget } from "../mattermost/channels-link.ts";
import { openExternalPostLink } from "../mattermost/external-post-link.ts";
import {
  connectInstallation,
  readInstallationSelection,
  selectInstallation,
} from "../mattermost/installation-registry.ts";
import {
  type AccountChannelsLink,
  routeChannelsLink,
} from "../mattermost/route-channels-link.ts";
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
  positioned: () => void;
  shown: (postId: string) => void;
  dismiss: () => void;
  stop: (reason: Stop, membership?: string) => void;
};
type State =
  | {
      kind: "switching" | "external" | Stop;
      serverUrl?: string;
      membership?: string;
    }
  | (RejectedLink & { id: string; close: () => void })
  | { kind: "target"; request: SystemPostRequest; installations: string[] }
  | { kind: "inbox"; id?: string };
type Gate = {
  deliveryId: string;
  route: AccountChannelsLink | null;
  source?: { href: string; origin: HTMLAnchorElement };
  positioned?: boolean;
  settled: Promise<void>;
  finish: () => void;
  finishing?: boolean;
  controller?: AbortController;
  selecting?: Promise<void>;
};

function makeGate(
  deliveryId: string,
  route: Gate["route"],
  source?: Gate["source"],
): Gate {
  let finish!: () => void;
  const settled = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { deliveryId, route, source, settled, finish };
}

function TableLinkNotice({
  label,
  dismiss,
  children,
}: {
  label: string;
  dismiss: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="system-post-notice"
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      {children}
    </dialog>
  );
}

function restoreLinkFocus(origin: HTMLAnchorElement) {
  if (!origin.isConnected || origin.closest("[inert], [hidden]")) return;
  const viewport = origin
    .closest(".timeline-scroll, .post-table-screen-content")
    ?.getBoundingClientRect();
  const link = origin.getBoundingClientRect();
  if (
    viewport &&
    (link.bottom <= viewport.top ||
      link.top >= viewport.bottom ||
      link.right <= viewport.left ||
      link.left >= viewport.right)
  )
    return;
  origin.focus({ preventScroll: true });
}

const copy = {
  en: {
    external: "Couldn’t open this link on your device.",
    publishedUnsupported: "This type of link is not supported yet.",
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
    external: "Не удалось открыть ссылку на устройстве.",
    publishedUnsupported: "Этот тип ссылки пока не поддерживается.",
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
  const [routeState, setState] = useState<Exclude<
    State,
    { kind: "inbox" }
  > | null>(null);
  const [inboxError, setInboxError] = useState<Extract<
    State,
    { kind: "inbox" }
  > | null>(null);
  const state = routeState ?? inboxError;
  const returnFocus = useRef<HTMLAnchorElement | null>(null);
  useLayoutEffect(() => {
    if (routeState || !returnFocus.current) return;
    restoreLinkFocus(returnFocus.current);
    returnFocus.current = null;
  }, [routeState]);
  const [waiting, setWaiting] = useState<{ id: string; count?: number }>();
  const subscribeAgain = useRef<(() => void) | null>(null);
  const current = useRef<Gate | null>(null);
  const observer = useRef<Awaited<
    ReturnType<typeof watchSystemChannelsLinks>
  > | null>(null);
  // The sign-in form and the link inbox both write the device's selected server.
  const lastSelection = useRef<Promise<unknown>>(Promise.resolve());
  const enqueueSelection = useCallback(<T,>(operation: () => Promise<T>) => {
    const next = lastSelection.current.then(operation, operation);
    lastSelection.current = next;
    return next;
  }, []);
  const pauseForServer = useCallback((serverUrl: string) => {
    const gate = current.current;
    const target = gate?.route?.target;
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
  const restoreSaved = useCallback(
    (serverUrl: string, signal: AbortSignal) =>
      enqueueSelection(async () => {
        signal.throwIfAborted();
        const selection = await readInstallationSelection();
        signal.throwIfAborted();
        if (selection.selected !== serverUrl) {
          await selectInstallation(serverUrl);
          pauseForServer(serverUrl);
        }
        return selection.installations;
      }),
    [enqueueSelection, pauseForServer],
  );
  const finish = useCallback(
    (gate: Gate, outcome: "shown" | "dismissed" | "superseded") => {
      if (current.current !== gate || gate.finishing) return;
      gate.finishing = true;
      const abort = outcome !== "shown";
      if (abort) {
        gate.controller?.abort();
        if (outcome === "dismissed" && gate.source?.origin.isConnected)
          returnFocus.current = gate.source.origin;
      }
      setState(null);
      setReady(true);
      // The host owns this write. A dismissed link must not race the next installation selection.
      const complete = () => {
        if (current.current === gate) current.current = null;
        gate.finish();
      };
      const selection = gate.selecting;
      if (abort && selection) {
        void selection
          .then(
            () => {
              if (lastSelection.current === selection) reopen();
            },
            () => {},
          )
          .then(complete);
      } else complete();
    },
    [reopen],
  );
  const start = useCallback(
    async (gate: Gate, reload = false) => {
      const first = !gate.controller;
      gate.controller?.abort();
      const controller = new AbortController();
      gate.controller = controller;
      const { signal } = controller;
      let launchingExternal = false;
      try {
        // A completed manual selection determines which account the next link sees.
        if (gate.source || gate.route?.target.kind === "permalink")
          await lastSelection.current.catch(() => {});
        signal.throwIfAborted();
        if (gate.source && !gate.route) {
          const { href, origin } = gate.source;
          gate.route = await routeChannelsLink(href);
          signal.throwIfAborted();
          if (!origin.isConnected) {
            finish(gate, "superseded");
            return;
          }
          if (!gate.route) {
            launchingExternal = true;
            await openExternalPostLink(href);
            if (!signal.aborted) finish(gate, "shown");
            return;
          }
        }
        let userId =
          (first || gate.source) && gate.route?.status === "ready"
            ? gate.route.userId
            : undefined;
        const target = gate.route?.target;
        if (target?.kind !== "permalink") {
          setState({
            ...describeRejectedLink(target),
            id: gate.deliveryId,
            close: () => finish(gate, "dismissed"),
          });
          return;
        }
        setState({ kind: "switching", serverUrl: target.serverUrl });
        const { installations, selected } = await readInstallationSelection();
        signal.throwIfAborted();
        if (!installations.includes(target.serverUrl)) {
          setState({ kind: "unavailable" });
          setReady(true);
          return;
        }
        if (gate.source && first && !gate.source.origin.isConnected) {
          finish(gate, "superseded");
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
          deliveryId: gate.deliveryId,
          target,
          signal,
          matchesUser: (id) => {
            userId ??= id;
            return userId === id;
          },
          positioned: () => {
            if (!signal.aborted) gate.positioned = true;
          },
          shown: (id) => {
            if (!signal.aborted && id === target.postId) finish(gate, "shown");
          },
          dismiss: () => {
            if (!signal.aborted) finish(gate, "dismissed");
          },
          stop: (kind, membership) => {
            if (signal.aborted || current.current !== gate) return;
            if (kind === "paused" && gate.source) {
              finish(gate, "dismissed");
              return;
            }
            controller.abort();
            setState({ kind, serverUrl: target.serverUrl, membership });
          },
        };
        setState({ kind: "target", request, installations });
      } catch {
        if (!signal.aborted) {
          if (gate.source && !gate.source.origin.isConnected) {
            finish(gate, "superseded");
          } else {
            setState({
              kind: launchingExternal ? "external" : "failed",
              serverUrl: gate.route?.target.serverUrl,
            });
          }
        }
      } finally {
        if (!signal.aborted) setReady(true);
      }
    },
    [enqueueSelection, finish, reopen],
  );
  const publishedSequence = useRef(0);
  const pendingPost = useRef<Gate | null>(null);
  const run = useCallback(
    async (gate: Gate, signal?: AbortSignal) => {
      while (current.current) {
        await current.current.settled;
        if (signal?.aborted || (gate.source && pendingPost.current !== gate))
          return;
      }
      if (gate.source && !gate.source.origin.isConnected) return;
      current.current = gate;
      void start(gate);
      await gate.settled;
    },
    [start],
  );
  const openPost = useCallback(
    (href: string, origin: HTMLAnchorElement) => {
      const previous = pendingPost.current;
      if (previous?.source?.origin === origin && previous.source.href === href)
        return;
      if (previous && current.current === previous)
        finish(previous, previous.positioned ? "shown" : "superseded");
      const gate = makeGate(`published-${++publishedSequence.current}`, null, {
        href,
        origin,
      });
      pendingPost.current = gate;
      void run(gate).finally(() => {
        if (pendingPost.current === gate) pendingPost.current = null;
      });
    },
    [finish, run],
  );
  useEffect(() => {
    const life = new AbortController();
    const { signal } = life;
    const begin = (link: SystemChannelsLink) =>
      run(makeGate(link.id, link.route), signal);
    function subscribe() {
      subscribeAgain.current = null;
      void watchSystemChannelsLinks(
        begin,
        (_error, id) => {
          if (!signal.aborted) {
            setInboxError({ kind: "inbox", id });
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
            setInboxError({ kind: "inbox" });
            setReady(true);
          }
        });
    }
    subscribe();
    return () => {
      life.abort();
      pendingPost.current = null;
      const gate = current.current;
      current.current = null;
      gate?.controller?.abort();
      gate?.finish();
      subscribeAgain.current = null;
      observer.current = null;
    };
  }, [run]);
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
    if (state?.kind === "inbox") {
      if (state.id) observer.current?.dismiss(state.id);
      setInboxError(null);
    } else if (current.current) finish(current.current, "dismissed");
  }
  function retry(reload: boolean) {
    if (state?.kind === "inbox") {
      setInboxError(null);
      if (observer.current) observer.current.retry();
      else subscribeAgain.current?.();
    } else if (current.current) void start(current.current, reload);
  }
  const text = copy[language];
  function notice(needsSignIn: boolean, otherServer: boolean) {
    if (!state) return null;
    const canRetry =
      state.kind === "failed" ||
      state.kind === "external" ||
      state.kind === "paused" ||
      state.kind === "inbox" ||
      otherServer;
    const address =
      state.kind === "target"
        ? state.request.target.serverUrl
        : "serverUrl" in state && state.kind !== "unsupported"
          ? state.serverUrl
          : undefined;
    const source = state.kind === "inbox" ? undefined : current.current?.source;
    const message =
      state.kind === "target" && needsSignIn
        ? text.wait
        : state.kind === "unsupported" && source
          ? text.publishedUnsupported
          : text[state.kind];
    const label = language === "ru" ? "Ссылка на сообщение" : "Message link";
    const content = (
      <>
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
      </>
    );
    const table = source?.origin.closest("dialog[open]");
    if (table && state.kind !== "switching" && state.kind !== "target")
      return (
        <TableLinkNotice label={label} dismiss={dismiss}>
          {content}
        </TableLinkNotice>
      );
    return (
      <aside className="system-post-notice" aria-label={label}>
        {content}
      </aside>
    );
  }
  return {
    ready,
    request,
    installations,
    openPost,
    entryResult,
    notice,
    connect,
    selectSaved,
    restoreSaved,
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
