import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ResponseError } from "../../vendor/mattermost/index.js";
import type { LocalPost } from "../mattermost/local-history.ts";
import type { AccountThreadReads } from "../mattermost/thread-read-coordination.ts";
import { inspectPostTarget } from "./inspect-post-target.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import {
  type ThreadInboxRow,
  useWorkspaceThreadInbox,
} from "./use-workspace-thread-inbox.ts";

vi.mock("./inspect-post-target.ts");

const team = "t".repeat(26);
const root: LocalPost = {
  id: "r".repeat(26),
  channelId: "c".repeat(26),
  userId: "u".repeat(26),
  rootId: null,
  message: "Previously readable root",
  messageSource: null,
  createAt: 1,
  updateAt: 1,
  editAt: 0,
  type: "",
  hashtags: "",
  isPinned: false,
};
const row: ThreadInboxRow = {
  id: root.id,
  post: root,
  participantIds: [],
  replyCount: 1,
  lastReplyAt: 2,
  lastViewedAt: 0,
  unreadReplies: 1,
  unreadMentions: 0,
  isUrgent: false,
};

test.each(["request", "list"])(
  "a warm thread loses its retained data and registration when %s revokes access",
  async (source) => {
    const visit = { revoke: vi.fn(), detach: vi.fn() };
    const reads = { visit: () => visit } as unknown as AccountThreadReads;
    const account = {
      readFollowedThreads: async () => ({ items: [row], nextBefore: null }),
      readFollowedThreadTotals: async () => ({
        total: 1,
        totalUnreadThreads: 1,
        totalUnreadMentions: 0,
        totalUnreadUrgentMentions: 0,
      }),
      subscribeToChannelHistory: () => () => {},
    } as unknown as WorkspaceConnection;
    type Target = Awaited<ReturnType<typeof inspectPostTarget>>;
    let resolve!: (target: Target) => void;
    let reject!: (error: unknown) => void;
    const pending = new Promise<Target>((accept, cancel) => {
      resolve = accept;
      reject = cancel;
    });
    const inspect = vi.mocked(inspectPostTarget).mockReturnValueOnce(pending);
    const onSessionIssue = vi.fn();
    const capture = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceThreadInbox(account, reads, team, true, true, onSessionIssue),
    );
    act(() => result.current.show());
    await waitFor(() =>
      expect(result.current.state?.page.status).toBe("ready"),
    );
    const model = result.current.model;
    if (!model) throw Error("The thread inbox did not open.");
    const reply = {
      ...root,
      id: "p".repeat(26),
      rootId: root.id,
      message: "Read in the former window",
    };
    act(() => {
      model.parkWindow({
        place: { top: 15, atEnd: false },
        replies: {
          root,
          replies: [reply],
          up: { status: "end" },
          down: { status: "end" },
          cardRevisions: new Map(),
        },
      });
      void result.current.choose(row);
      result.current.registerWindow(root.id, capture);
    });
    expect(result.current.selection?.parked?.replies.replies).toEqual([reply]);
    expect(result.current.selection?.visit).toBe(visit);
    const signal = inspect.mock.lastCall?.[3];
    expect(signal?.aborted).toBe(false);

    if (source === "request") {
      await act(async () =>
        reject(new ResponseError(new Response(null, { status: 403 }))),
      );
    } else act(() => model.revokeRoot(root.id));

    const denial = {
      id: root.id,
      issue: "forbidden",
      retainedAccessRevoked: true,
    };
    expect(result.current.selection).toEqual(denial);
    expect(model.takeWindow(root.channelId, root.id)).toBeUndefined();
    expect(visit.revoke).toHaveBeenCalledOnce();
    expect(visit.detach).toHaveBeenCalledOnce();
    expect(signal?.aborted).toBe(true);
    expect(onSessionIssue).not.toHaveBeenCalled();
    if (source === "list") {
      await act(async () =>
        resolve({
          kind: "ready",
          teamId: team,
          channelId: root.channelId,
          postId: root.id,
          rootId: null,
          post: root,
        }),
      );
      expect(result.current.selection).toEqual(denial);
    }
    act(() => result.current.closeThread());
    expect(capture).not.toHaveBeenCalled();
  },
);
