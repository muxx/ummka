import { expect, test } from "vitest";
import type { PendingPost, PostRefusal } from "./account-delivery.ts";
import { outgoingRowState } from "./outgoing-row-state.ts";

const pending: PendingPost = {
  sequence: 1,
  pendingId: "pending",
  attempt: 1,
  channelId: "channel",
  rootId: null,
  message: "Original",
  createdAt: 1,
  previousLogin: false,
  confirmedPostId: null,
  refusal: null,
};
const refusal: PostRefusal = {
  status: 403,
  code: "forbidden",
  message: "This channel is read only",
};

test("only an observed request is sending, even when a neighboring view has the same row", () => {
  expect(outgoingRowState(pending, true, true)).toEqual({
    kind: "sending",
    actions: {},
  });
  expect(outgoingRowState(pending, true, false)).toEqual({
    kind: "sending",
    actions: {},
  });
  expect(outgoingRowState(pending, false, true)).toEqual({
    kind: "unconfirmed",
    retryRefusal: null,
    actions: { checkDelivery: true, retry: true, dismiss: true },
  });
  expect(outgoingRowState(pending, false, false).actions).toEqual({
    checkDelivery: false,
    retry: false,
    dismiss: true,
  });
});

test.each([true, false])(
  "a durable denial controls editing and retry actions with online=%s",
  (online) => {
    expect(outgoingRowState({ ...pending, refusal }, true, online)).toEqual({
      kind: "refused",
      refusal,
      actions: { edit: true, sendEdited: online, dismiss: true },
    });
    expect(
      outgoingRowState(
        { ...pending, attempt: 2, retryRefusal: refusal },
        true,
        online,
      ),
    ).toEqual({
      kind: "unconfirmed",
      retryRefusal: refusal,
      actions: {
        checkDelivery: online,
        retry: online,
        copy: true,
        dismiss: true,
      },
    });
  },
);

test("a change of login preserves the known outcome and permits only local actions", () => {
  const old = { ...pending, previousLogin: true };
  const actions = { copy: true, dismiss: true };
  expect(outgoingRowState(old, true, true)).toEqual({
    kind: "previousLogin",
    outcome: { kind: "unconfirmed", retryRefusal: null },
    actions,
  });
  expect(outgoingRowState({ ...old, refusal }, true, false)).toEqual({
    kind: "previousLogin",
    outcome: { kind: "refused", refusal },
    actions,
  });
  expect(
    outgoingRowState({ ...old, retryRefusal: refusal }, true, true),
  ).toEqual({
    kind: "previousLogin",
    outcome: { kind: "unconfirmed", retryRefusal: refusal },
    actions,
  });
});

test("the server ID supersedes a cached attempt, its last refusal and a change of login", () => {
  const confirmed = {
    ...pending,
    confirmedPostId: "server-post",
    previousLogin: true,
    retryRefusal: refusal,
  };
  expect(outgoingRowState(confirmed, true, false)).toEqual({
    kind: "delivered",
    postId: "server-post",
    actions: {},
  });
});
