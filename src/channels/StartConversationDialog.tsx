import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { EntryLanguage } from "../entry/language.ts";
import {
  type ChannelProfile,
  directPartnerId,
  type NameFormat,
  teammateName,
} from "../mattermost/channel-profiles.ts";
import type { TeamSidebar } from "../mattermost/team-sidebar.ts";
import { PanelRetry, PanelState } from "./PanelState.tsx";
import { initials } from "./profile-initials.ts";
import { startConversationCopy } from "./start-conversation-copy.ts";
import { useConversationRecipientPages } from "./use-conversation-recipient-pages.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import { type WorkspaceRead, workspaceFailure } from "./workspace-data.ts";
import "./start-conversation.css";

type Destination = { channelId: string; channelKind: "D" | "G" };
type Room = TeamSidebar["data"]["channels"][number];
type Opening =
  | { kind: "pick"; problem?: string }
  | { kind: "creating" }
  | {
      kind: "checking";
      target: Destination;
      before: WorkspaceRead<TeamSidebar>;
    }
  | { kind: "missing"; target: Destination };

export function StartConversationDialog({
  account,
  teamId,
  userId,
  language,
  format,
  online,
  directory,
  refresh,
  choose,
  dismiss,
  sessionIssue,
}: {
  account: Pick<
    WorkspaceConnection,
    "readConversationRecipients" | "openRecipientConversation"
  >;
  teamId: string;
  userId: string;
  language: EntryLanguage;
  format: NameFormat;
  online: boolean;
  directory: WorkspaceRead<TeamSidebar>;
  refresh: () => void;
  choose: (room: Room) => void;
  dismiss: () => void;
  sessionIssue: (issue: "session" | "unauthorized") => void;
}) {
  const text = startConversationCopy[language];
  const title = useId();
  const statusId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const scroll = useRef<HTMLElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const creating = useRef<AbortController | null>(null);
  const closed = useRef(false);
  const [rawTerm, setRawTerm] = useState("");
  const [selected, setSelected] = useState(
    () => new Map<string, ChannelProfile>(),
  );
  const [pinned, setPinned] = useState<string[]>([]);
  const [opening, setOpening] = useState<Opening>({ kind: "pick" });
  const pages = useConversationRecipientPages(
    account,
    teamId,
    online,
    sessionIssue,
  );
  const { state, page } = pages;
  const blocked =
    opening.kind !== "pick" ||
    state.status === "offline" ||
    state.status === "denied";
  const busy = opening.kind === "creating" || opening.kind === "checking";
  const canSubmit =
    online && state.status !== "denied" && selected.size > 0 && !busy;

  useLayoutEffect(() => {
    const modal = dialog.current;
    const viewport = window.visualViewport;
    function measure() {
      if (!viewport || !modal) return;
      modal.style.setProperty(
        "--recipient-viewport-height",
        `${viewport.height}px`,
      );
      modal.style.setProperty(
        "--recipient-viewport-top",
        `${viewport.offsetTop}px`,
      );
    }
    closed.current = false;
    measure();
    viewport?.addEventListener("resize", measure);
    viewport?.addEventListener("scroll", measure);
    modal?.showModal();
    field.current?.focus({ preventScroll: true });
    return () => {
      closed.current = true;
      creating.current?.abort();
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
      modal?.close();
    };
  }, []);

  useLayoutEffect(() => {
    if (!state.focus || blocked) return;
    if (state.focus === "retry") retry.current?.focus();
    else if (state.focus === "search") field.current?.focus();
    else
      scroll.current
        ?.querySelector<HTMLInputElement>(`[data-recipient="${state.focus}"]`)
        ?.focus();
  }, [state, blocked]);

  function close(room?: Room) {
    if (closed.current) return;
    closed.current = true;
    creating.current?.abort();
    dialog.current?.close();
    if (room) choose(room);
    else dismiss();
  }
  const navigate = useEffectEvent(close);
  useEffect(() => {
    if (
      opening.kind !== "checking" ||
      opening.before === directory ||
      directory.status === "loading" ||
      directory.status === "refreshing"
    )
      return;
    const { target } = opening;
    const room =
      directory.status === "ready" && confirmedRoom(directory, target);
    if (room) navigate(room);
    else setOpening({ kind: "missing", target });
  }, [directory, opening]);

  function check(target: Destination) {
    setOpening({ kind: "checking", target, before: directory });
    refresh();
  }

  function allowed(id: string, selection = selected) {
    return (
      !blocked &&
      (selection.has(id) ||
        (id === userId
          ? selection.size === 0
          : !selection.has(userId) && selection.size < 7))
    );
  }
  function toggle(person: ChannelProfile) {
    if (!allowed(person.id)) return;
    setOpening({ kind: "pick" });
    setSelected((selection) => {
      if (!allowed(person.id, selection)) return selection;
      const next = new Map(selection);
      if (!next.delete(person.id)) next.set(person.id, person);
      return next;
    });
  }
  async function open() {
    if (!canSubmit || closed.current || creating.current) return;
    if (opening.kind === "missing") {
      check(opening.target);
      return;
    }
    const ids = Array.from(selected.keys());
    const existing =
      ids.length === 1 &&
      directory.value?.data.channels.find(
        (room) =>
          room.kind === "D" &&
          room.deleteAt === 0 &&
          directPartnerId(room.name, userId) === ids[0],
      );
    if (existing) {
      close(existing);
      return;
    }
    const controller = new AbortController();
    creating.current = controller;
    setOpening({ kind: "creating" });
    try {
      const result = await account.openRecipientConversation(
        ids,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (result.kind === "applied") {
        const room = confirmedRoom(directory, result);
        if (room) close(room);
        else check(result);
      } else if (result.kind === "unauthorized") sessionIssue("unauthorized");
      else
        setOpening({
          kind: "pick",
          problem:
            result.kind === "refused"
              ? result.refusal.message || text.createFailed
              : text.unknown,
        });
    } catch (error) {
      if (controller.signal.aborted) return;
      const issue = workspaceFailure(error, "network");
      if (issue === "session" || issue === "unauthorized") sessionIssue(issue);
      else setOpening({ kind: "pick", problem: text.unknown });
    } finally {
      if (creating.current === controller) creating.current = null;
    }
  }

  const people = new Map<string, ChannelProfile>();
  if (state.status !== "denied" && state.status !== "offline")
    for (const id of pinned) {
      const person = selected.get(id);
      if (person) people.set(id, person);
    }
  for (const person of state.profiles) people.set(person.id, person);
  const note = selectionNotice(
    opening,
    selected.size,
    selected.has(userId),
    text,
  );
  const notice = readNotice(
    state.status,
    page,
    rawTerm.trim(),
    people.size,
    state.nextPage,
    text,
  );
  const pageAction =
    state.status === "failed" ||
    (state.status === "ready" && state.nextPage !== null);
  return (
    <dialog
      ref={dialog}
      className="modal-layout recipient-picker"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="recipient-picker__header">
        <button
          type="button"
          className="recipient-picker__back channels-icon-action"
          aria-label={text.back}
          onClick={() => close()}
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.65"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m13 6-6 6 6 6M7 12h13" />
          </svg>
        </button>
        <h2 id={title}>{text.title}</h2>
        <button
          type="button"
          className="recipient-picker__close channels-icon-action"
          aria-label={text.close}
          onClick={() => close()}
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.65"
            strokeLinecap="round"
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      <label className="recipient-picker__search">
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
        >
          <circle cx="10" cy="10" r="6.5" />
          <path d="m15 15 6 6" />
        </svg>
        <input
          ref={field}
          type="search"
          aria-label={text.field}
          placeholder={text.placeholder}
          readOnly={blocked}
          aria-disabled={blocked || undefined}
          value={rawTerm}
          onChange={(event) => {
            if (blocked) return;
            const raw = event.currentTarget.value;
            const term = raw.trim().replace(/^@/u, "").trim();
            setRawTerm(raw);
            if (pages.term === term) return;
            if (term) setPinned([]);
            else if (pages.term) setPinned(Array.from(selected.keys()));
            if (scroll.current) scroll.current.scrollTop = 0;
            pages.search(term);
          }}
        />
      </label>
      <section
        className="modal-scroll recipient-picker__results"
        ref={scroll}
        aria-label={text.recipients}
        tabIndex={-1}
      >
        <ul className="recipient-picker__rows">
          {Array.from(people.values(), (person) => {
            const self = person.id === userId;
            const name = teammateName(person, format);
            const available = allowed(person.id);
            return (
              <li key={person.id}>
                <label className="recipient-picker__row">
                  <input
                    type="checkbox"
                    data-recipient={person.id}
                    checked={selected.has(person.id)}
                    aria-label={self ? `${name} ${text.you}` : name}
                    aria-disabled={!available || undefined}
                    aria-describedby={!available ? statusId : undefined}
                    onClick={(event) => {
                      if (!available) event.preventDefault();
                    }}
                    onChange={() => toggle(person)}
                  />
                  <span className="recipient-picker__avatar" aria-hidden="true">
                    {Array.from(initials(name))[0]}
                  </span>
                  <span className="recipient-picker__person">
                    {name}
                    {self ? ` ${text.you}` : ""}
                    <small>
                      {self && selected.size && !selected.has(userId)
                        ? text.onlySelf
                        : `@${person.remoteUsername || person.username}`}
                    </small>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {(notice || pageAction) && (
          <div className="recipient-picker__page panel-state">
            {notice && <PanelState {...notice} />}
            {pageAction && (
              <PanelRetry
                ref={retry}
                aria-disabled={blocked || undefined}
                onClick={(event) => {
                  if (blocked) return;
                  if (state.status !== "failed") {
                    const touch =
                      event.detail > 0 &&
                      window.matchMedia("(max-width: 740px)").matches;
                    (touch ? scroll.current : field.current)?.focus({
                      preventScroll: true,
                    });
                  }
                  pages.next();
                }}
              >
                {state.status === "failed" ? text.retry : text.more}
              </PanelRetry>
            )}
          </div>
        )}
      </section>
      <span className="recipient-picker__announcement" role="status">
        {state.added ? text.added(state.added) : ""}
      </span>
      <footer className="recipient-picker__footer">
        <span
          id={statusId}
          role={
            opening.kind === "missing" ||
            (opening.kind === "pick" && opening.problem)
              ? "alert"
              : "status"
          }
        >
          {note}
        </span>
        <button
          type="button"
          className="recipient-picker__primary"
          aria-disabled={!canSubmit}
          aria-busy={busy}
          aria-describedby={statusId}
          onClick={() => void open()}
        >
          {opening.kind === "missing" ? text.reopen : text.open}
        </button>
      </footer>
    </dialog>
  );
}

function confirmedRoom(
  directory: WorkspaceRead<TeamSidebar>,
  target: Destination,
) {
  return directory.value?.data.channels.find(
    (room) =>
      room.id === target.channelId &&
      room.kind === target.channelKind &&
      room.deleteAt === 0,
  );
}

type Copy = (typeof startConversationCopy)[EntryLanguage];
function selectionNotice(
  opening: Opening,
  count: number,
  self: boolean,
  text: Copy,
) {
  switch (opening.kind) {
    case "creating":
      return text.creating;
    case "checking":
      return text.adding;
    case "missing":
      return text.refreshFailed;
    case "pick": {
      if (opening.problem) return opening.problem;
      if (self) return text.self;
      if (!count) return text.noSelection;
      if (count === 1) return text.direct;
      return count === 7 ? text.limit : text.group(count);
    }
  }
}

function readNotice(
  status: ReturnType<typeof useConversationRecipientPages>["state"]["status"],
  page: number,
  term: string,
  count: number,
  nextPage: number | null,
  text: Copy,
): Parameters<typeof PanelState>[0] | null {
  switch (status) {
    case "checking":
      return { variant: "pending", message: text.checking, role: "status" };
    case "loading":
      return {
        variant: "pending",
        message: page > 0 ? text.loadingMore : text.loading,
        role: "status",
      };
    case "offline":
      return {
        variant: "offline",
        title: text.offline,
        message: text.offlineHint,
        role: "status",
      };
    case "denied":
      return { variant: "error", title: text.denied, role: "alert" };
    case "failed":
      return {
        variant: "error",
        title: page > 0 ? undefined : text.loadFailed,
        message: page > 0 ? text.pageFailed : text.loadHint,
        role: "alert",
      };
    case "ready":
      return count || nextPage !== null
        ? null
        : {
            variant: "empty",
            title: term ? text.noMatch(term) : text.empty,
            message: term ? text.emptyHint : undefined,
            role: "status",
          };
  }
}
