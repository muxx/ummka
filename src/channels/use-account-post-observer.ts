import {
  createContext,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
} from "react";
import type { ChannelEventNotice } from "../mattermost/account-channel-events.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import { workspaceFailure } from "./workspace-data.ts";

export type OpenEventTarget = {
  signal: AbortSignal;
  apply: (notice: ChannelEventNotice, signal: AbortSignal) => Promise<void>;
};
export const ChannelEventTargetContext = createContext<{
  active: RefObject<OpenEventTarget | null>;
  retry: () => void;
} | null>(null);

export function useAccountPostObserver(
  account: WorkspaceConnection | null,
  sessionIssue: (issue: "session" | "unauthorized") => void,
) {
  const active = useRef<OpenEventTarget | null>(null);
  const resume = useRef<(() => void) | null>(null);
  const retry = useCallback(() => resume.current?.(), []);
  useEffect(() => {
    if (!account) return;
    const owner = new AbortController();
    async function apply(notice: ChannelEventNotice, delivery: AbortSignal) {
      while (active.current) {
        delivery.throwIfAborted();
        const target = active.current;
        const signal = AbortSignal.any([owner.signal, delivery, target.signal]);
        try {
          await target.apply(notice, signal);
          signal.throwIfAborted();
          return;
        } catch (error) {
          owner.signal.throwIfAborted();
          delivery.throwIfAborted();
          if (!target.signal.aborted || active.current === target) throw error;
          // Selecting a different channel ends only this view. Recheck the
          // delivery against the replacement before acknowledging it.
        }
      }
    }
    const current = account;
    function start() {
      resume.current = null;
      void current.observeChannelEvents(apply, owner.signal).catch((error) => {
        if (owner.signal.aborted) return;
        const issue = workspaceFailure(error, "network");
        if (issue === "session" || issue === "unauthorized")
          sessionIssue(issue);
        else resume.current = start;
      });
    }
    window.addEventListener("online", retry);
    start();
    return () => {
      window.removeEventListener("online", retry);
      resume.current = null;
      owner.abort();
    };
  }, [account, sessionIssue, retry]);
  return { active, retry };
}
