import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, test, vi } from "vitest";
import type {
  ComposerDraft,
  DraftLocation,
  DraftSave,
} from "../mattermost/native-rest.ts";
import { DraftComposer } from "./DraftComposer.tsx";

afterEach(cleanup);
function storage(rid = 1) {
  const rows = new Map<string, ComposerDraft>();
  const key = (place: DraftLocation) =>
    [place.channelId, place.rootId ?? ""].join("/");
  const empty = { message: "", revision: null };
  let revision = 0;
  const connection = {
    rid,
    readDraft: vi.fn(
      async (place: DraftLocation) => rows.get(key(place)) ?? empty,
    ),
    saveDraft: vi.fn(
      async (
        change: DraftLocation & {
          message: string;
          expectedRevision: string | null;
        },
      ): Promise<DraftSave> => {
        const latest = rows.get(key(change)) ?? empty;
        if (change.expectedRevision !== latest.revision)
          return { kind: "conflict", draft: latest };
        const draft = { message: change.message, revision: String(++revision) };
        rows.set(key(change), draft);
        return { kind: "saved", draft };
      },
    ),
    submitDraft: vi.fn(),
  };
  return { rows, connection };
}
function inputs(connection: ReturnType<typeof storage>["connection"]) {
  const directory = {
    readChannelMemberCount: vi.fn().mockResolvedValue(12),
    readChannelTimezoneCount: vi.fn().mockResolvedValue(2),
    readAssociatedMentionGroups: vi.fn(),
    searchMentionGroups: vi.fn(),
    readMentionGroupCounts: vi.fn(),
  };
  return {
    conversation: { name: "общий", direct: false },
    keys: { sendOnCtrlEnter: false, codeBlockOnCtrlEnter: false },
    sendContext: {
      post: {
        account: directory,
        channel: { id: "c".repeat(26) },
        team: null,
        settings: {
          maxNotificationsPerChannel: "100",
          confirmNotifications: true,
          ldapGroups: false,
          customGroups: false,
        },
        channelPermission: "allowed" as const,
        groupPermission: "allowed" as const,
      },
      route: vi.fn().mockResolvedValue({ kind: "post" }),
      performOther: vi.fn(),
    },
    connection,
    language: "ru" as const,
    online: false,
    label: "Написать сообщение…",
    channelId: "A",
    fieldRef: createRef<HTMLTextAreaElement>(),
    sessionIssue: vi.fn(),
  };
}
const field = () =>
  screen.findByRole<HTMLTextAreaElement>("textbox", {
    name: "Написать сообщение…",
  });

test("a late read cannot expose a previous room and an empty draft is editable only after reading", async () => {
  const { rows, connection } = storage();
  rows.set("B/root", { message: "ответ", revision: "thread" });
  let finish!: (value: ComposerDraft) => void;
  connection.readDraft.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const props = inputs(connection);
  const view = render(<DraftComposer {...props} />);
  expect(screen.queryByRole("textbox")).toBeNull();
  view.rerender(<DraftComposer {...props} channelId="B" rootId="root" />);
  expect((await field()).value).toBe("ответ");
  await act(async () =>
    finish({ message: "в другой беседе", revision: "late" }),
  );
  expect((await field()).value).toBe("ответ");
  expect(connection.submitDraft).not.toHaveBeenCalled();
});

test("immediate return during a save keeps exact Markdown and typing can continue offline", async () => {
  const { rows, connection } = storage();
  const props = inputs(connection);
  const save = connection.saveDraft.getMockImplementation();
  if (!save) throw Error("missing fixture writer");
  let complete!: () => void;
  connection.saveDraft.mockImplementationOnce(async (change) => {
    await new Promise<void>((resolve) => {
      complete = resolve;
    });
    return save(change);
  });
  const view = render(<DraftComposer {...props} />);
  fireEvent.change(await field(), { target: { value: "  **один**\n" } });
  view.rerender(<DraftComposer {...props} channelId="B" />);
  expect((await field()).value).toBe("");
  expect(connection.saveDraft).toHaveBeenCalledTimes(1);
  view.rerender(<DraftComposer {...props} />);
  expect((await field()).value).toBe("  **один**\n");
  fireEvent.change(await field(), { target: { value: "  **один**\nдва" } });
  await act(async () => {
    complete();
  });
  fireEvent(window, new Event("pagehide"));
  await waitFor(() => expect(rows.get("A/")?.message).toBe("  **один**\nдва"));
  expect(rows.has("B/")).toBe(false);
  expect(screen.getByText("Черновик · без сети")).toBeTruthy();
  expect(connection.submitDraft).not.toHaveBeenCalled();
});

test("conflict shows both versions and resolves the revision the user saw", async () => {
  const { rows, connection } = storage();
  const props = inputs(connection);
  const local = "мой текст";
  const remote = "сохранённый текст из другого окна";
  render(<DraftComposer {...props} />);
  fireEvent.change(await field(), { target: { value: local } });
  rows.set("A/", { message: remote, revision: "other" });
  fireEvent(window, new Event("focus"));
  await screen.findByRole("group", {
    name: "Черновик изменился в другом окне",
  });
  expect((await field()).value).toBe(local);
  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Сейчас на устройстве",
    }).value,
  ).toBe(remote);
  fireEvent.click(screen.getByRole("button", { name: "Взять с устройства" }));
  await waitFor(() => expect(props.fieldRef.current?.value).toBe(remote));
  expect(document.activeElement).toBe(props.fieldRef.current);
  expect(props.fieldRef.current?.selectionStart).toBe(remote.length);
  fireEvent.change(await field(), { target: { value: local } });
  rows.set("A/", { message: "", revision: "sent", clearedBySubmission: true });
  fireEvent(window, new Event("focus"));
  await screen.findByRole("group", {
    name: "Черновик отправлен из другого окна",
  });
  fireEvent.click(screen.getByRole("button", { name: "Оставить черновиком" }));
  await waitFor(() => expect(rows.get("A/")?.message).toBe(local));
  expect(connection.saveDraft).toHaveBeenLastCalledWith({
    channelId: "A",
    expectedRevision: "sent",
    message: local,
  });
  expect(screen.queryByRole("group")).toBeNull();
});

test("read and write errors can be retried without sending or clearing the input", async () => {
  const { rows, connection } = storage();
  const props = inputs(connection);
  connection.readDraft.mockRejectedValueOnce("history_storage_unavailable");
  connection.saveDraft.mockRejectedValueOnce("history_storage_unavailable");
  render(<DraftComposer {...props} />);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "открыть черновик",
  );
  const reopen = screen.getByRole("button", { name: "Повторить" });
  reopen.focus();
  fireEvent.click(reopen);
  const opened = await field();
  expect(document.activeElement).toBe(opened);
  fireEvent.change(opened, { target: { value: "написано" } });
  act(() => opened.blur());
  expect((await screen.findByRole("alert")).textContent).toContain(
    "обновить черновик",
  );
  expect((await field()).value).toBe("написано");
  const writeAgain = screen.getByRole("button", { name: "Повторить" });
  writeAgain.focus();
  fireEvent.click(writeAgain);
  await waitFor(() => expect(rows.get("A/")?.message).toBe("написано"));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(document.activeElement).toBe(await field());
});

test("keeps keyboard focus in the conflict when another window changes the chosen revision again", async () => {
  const { rows, connection } = storage();
  render(<DraftComposer {...inputs(connection)} />);
  fireEvent.change(await field(), { target: { value: "новый черновик" } });
  rows.set("A/", { message: "первая правка", revision: "2" });
  fireEvent(window, new Event("focus"));
  const keep = await screen.findByRole("button", {
    name: "Сохранить набранное здесь",
  });
  keep.focus();
  rows.set("A/", { message: "вторая правка", revision: "3" });
  fireEvent.click(keep);
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLTextAreaElement>("textbox", {
        name: "Сейчас на устройстве",
      }).value,
    ).toBe("вторая правка"),
  );
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Сохранить набранное здесь" }),
  );
  expect((await field()).value).toBe("новый черновик");
});

test.each([true, false])(
  "taking the device draft after an unacknowledged write keeps keyboard focus (committed: %s)",
  async (committed) => {
    const { rows, connection } = storage();
    const props = inputs(connection);
    render(<DraftComposer {...props} />);
    const input = await field();
    // Keep the independent 600 ms autosave out of this lost-acknowledgement scenario.
    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.change(input, { target: { value: "набранный текст" } });
        rows.set("A/", { message: "увиденная версия", revision: "other" });
        fireEvent(window, new Event("focus"));
      });
      connection.saveDraft.mockImplementationOnce(async ({ message }) => {
        if (committed) rows.set("A/", { message, revision: "written" });
        throw new Error("acknowledgement lost");
      });
      const keep = screen.getByRole("button", {
        name: "Сохранить набранное здесь",
      });
      await act(async () => {
        fireEvent.click(keep);
      });
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(connection.saveDraft).toHaveBeenCalledExactlyOnceWith({
        channelId: "A",
        expectedRevision: "other",
        message: "набранный текст",
      });
      const take = screen.getByRole("button", { name: "Взять с устройства" });
      await act(async () => {
        take.focus();
        fireEvent.click(take);
      });
      expect(input.value).toBe("увиденная версия");
      if (committed) {
        expect(
          screen.getByRole<HTMLTextAreaElement>("textbox", {
            name: "Сейчас на устройстве",
          }).value,
        ).toBe("набранный текст");
        expect(document.activeElement).toBe(
          screen.getByRole("button", { name: "Взять с устройства" }),
        );
      } else {
        expect(screen.queryByRole("group")).toBeNull();
        expect(document.activeElement).toBe(input);
      }
      expect(connection.saveDraft).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  },
);

test("retry after a failed choice saves only against the revision the user accepted", async () => {
  const { rows, connection } = storage();
  const props = inputs(connection);
  render(<DraftComposer {...props} />);
  fireEvent.change(await field(), { target: { value: "мой текст" } });
  rows.set("A/", { message: "чужая правка", revision: "other" });
  fireEvent(window, new Event("focus"));
  const keep = await screen.findByRole("button", {
    name: "Сохранить набранное здесь",
  });
  connection.saveDraft.mockRejectedValueOnce("history_storage_unavailable");
  keep.focus();
  fireEvent.click(keep);
  await screen.findByRole("alert");
  expect(document.activeElement).toBe(keep);
  rows.set("A/", { message: "более новая правка", revision: "newer" });
  fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
  await waitFor(() => expect(connection.saveDraft).toHaveBeenCalledTimes(2));
  expect(connection.saveDraft).toHaveBeenLastCalledWith({
    channelId: "A",
    expectedRevision: "other",
    message: "мой текст",
  });
  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Сейчас на устройстве",
    }).value,
  ).toBe("более новая правка");
  expect((await field()).value).toBe("мой текст");
  expect(rows.get("A/")?.message).toBe("более новая правка");
  connection.saveDraft.mockRejectedValueOnce("history_storage_unavailable");
  fireEvent.click(
    screen.getByRole("button", { name: "Сохранить набранное здесь" }),
  );
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
  await waitFor(() => expect(rows.get("A/")?.message).toBe("мой текст"));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("group")).toBeNull();
  expect(document.activeElement).toBe(await field());
  expect(connection.submitDraft).not.toHaveBeenCalled();
});

test("retrying a failed refresh keeps an unresolved draft choice", async () => {
  const { rows, connection } = storage();
  render(<DraftComposer {...inputs(connection)} />);
  fireEvent.change(await field(), { target: { value: "локальный вариант" } });
  rows.set("A/", { message: "на устройстве", revision: "remote" });
  fireEvent(window, new Event("focus"));
  await screen.findByRole("group");
  connection.readDraft.mockRejectedValueOnce("history_storage_unavailable");
  fireEvent(window, new Event("focus"));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(screen.getByRole("group")).toBeTruthy();
  expect((await field()).value).toBe("локальный вариант");
  expect(connection.saveDraft).not.toHaveBeenCalled();
});

test.each(["button", "enter"])(
  "submits the visible draft once using %s and clears it after staging",
  async (action) => {
    const { connection, rows } = storage();
    const props = { ...inputs(connection), online: true };
    connection.submitDraft.mockImplementation(
      async (place: DraftLocation & { revision: string }) => {
        const saved = rows.get("A/root");
        expect(saved).toEqual({
          message: "Первая строка\nВторая",
          revision: place.revision,
        });
        const draft = {
          message: "",
          revision: "sent",
          clearedBySubmission: true,
        };
        rows.set("A/root", draft);
        return {
          kind: "sending",
          draft,
          completion: Promise.resolve({ kind: "unconfirmed" }),
        };
      },
    );
    render(<DraftComposer {...props} rootId="root" />);
    const input = await field();
    fireEvent.change(input, { target: { value: "Первая строка\nВторая" } });
    if (action === "button")
      fireEvent.click(
        screen.getByRole("button", { name: "Отправить сообщение" }),
      );
    else fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(input.value).toBe(""));
    expect(connection.submitDraft).toHaveBeenCalledExactlyOnceWith({
      channelId: "A",
      rootId: "root",
      revision: "1",
    });
    expect(
      props.sendContext.post.account.readChannelMemberCount,
    ).not.toHaveBeenCalled();
  },
);

test.each([false, true])(
  "an unauthorized first delivery reports only to its original room (switched %s)",
  async (switched) => {
    const { connection, rows } = storage();
    const props = { ...inputs(connection), online: true };
    let unauthorized!: () => void;
    const completion = new Promise<{ kind: "unauthorized" }>((resolve) => {
      unauthorized = () => resolve({ kind: "unauthorized" });
    });
    connection.submitDraft.mockImplementation(async () => {
      const draft = {
        message: "",
        revision: "sent",
        clearedBySubmission: true,
      };
      rows.set("A/", draft);
      return { kind: "sending", draft, completion };
    });
    const view = render(<DraftComposer {...props} />);
    const input = await field();
    fireEvent.change(input, { target: { value: "ready to send" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Отправить сообщение" }),
    );
    await waitFor(() => expect(input.value).toBe(""));
    if (switched) {
      view.rerender(<DraftComposer {...props} channelId="B" />);
      await waitFor(() => expect(input.isConnected).toBe(false));
    }
    await act(async () => unauthorized());
    if (switched) expect(props.sessionIssue).not.toHaveBeenCalled();
    else
      expect(props.sessionIssue).toHaveBeenCalledExactlyOnceWith(
        "unauthorized",
      );
    expect(connection.submitDraft).toHaveBeenCalledTimes(1);
  },
);

test("Escape restores focus and text, and a later confirmed mention can send", async () => {
  const { connection } = storage();
  const props = { ...inputs(connection), online: true };
  connection.submitDraft.mockResolvedValue({
    kind: "sending",
    draft: { message: "", revision: "sent", clearedBySubmission: true },
    completion: Promise.resolve({ kind: "unconfirmed" }),
  });
  render(<DraftComposer {...props} />);
  const input = await field();
  fireEvent.change(input, { target: { value: "@here встречаемся" } });
  const sendButton = screen.getByRole("button", {
    name: "Отправить сообщение",
  });
  fireEvent.click(sendButton);
  const confirm = await screen.findByRole("button", { name: "Отправить" });
  expect(document.activeElement).toBe(confirm);
  fireEvent.keyDown(confirm, { key: "Escape" });
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe("@here встречаемся");
  expect(connection.submitDraft).not.toHaveBeenCalled();
  fireEvent.click(sendButton);
  fireEvent.click(await screen.findByRole("button", { name: "Отправить" }));
  await waitFor(() => expect(input.value).toBe(""));
  expect(connection.submitDraft).toHaveBeenCalledTimes(1);
});

test("switching rooms while the audience is loading never submits the other room's draft", async () => {
  const { connection, rows } = storage();
  const props = { ...inputs(connection), online: true };
  let finish!: (count: number) => void;
  props.sendContext.post.account.readChannelMemberCount.mockImplementationOnce(
    () =>
      new Promise<number>((r) => {
        finish = r;
      }),
  );
  const view = render(<DraftComposer {...props} />);
  fireEvent.change(await field(), { target: { value: "@all проверьте" } });
  fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
  await waitFor(() =>
    expect(
      props.sendContext.post.account.readChannelMemberCount,
    ).toHaveBeenCalledOnce(),
  );
  view.rerender(<DraftComposer {...props} channelId="B" />);
  expect((await field()).value).toBe("");
  await act(async () => finish(21));
  expect(screen.queryByRole("group")).toBeNull();
  expect(rows.get("A/")?.message).toBe("@all проверьте");
  expect(connection.submitDraft).not.toHaveBeenCalled();
});

test("only an explicit send-as-text sends an unknown command, and its released revision still requires mention confirmation", async () => {
  const { connection, rows } = storage();
  const props = { ...inputs(connection), online: true };
  props.sendContext.route.mockResolvedValue({ kind: "command" });
  props.sendContext.performOther.mockImplementationOnce(async () => {
    const draft = { message: "/xyz @all", revision: "released" };
    rows.set("A/", draft);
    return {
      kind: "command",
      answer: {
        kind: "answered",
        result: {
          kind: "unknownCommand",
          refusal: { status: 404, code: "missing", message: null },
        },
        settlement: "saved",
        draft,
      },
    };
  });
  connection.submitDraft.mockResolvedValue({
    kind: "sending",
    draft: { message: "", revision: "sent" },
    completion: Promise.resolve({ kind: "unconfirmed" }),
  });
  render(<DraftComposer {...props} />);
  const input = await field();
  fireEvent.change(input, { target: { value: "/xyz @all" } });
  fireEvent.click(screen.getByRole("button", { name: "Выполнить команду" }));
  const asText = await screen.findByRole("button", {
    name: "Отправить текстом",
  });
  expect(
    props.sendContext.post.account.readChannelMemberCount,
  ).not.toHaveBeenCalled();
  expect(connection.submitDraft).not.toHaveBeenCalled();
  fireEvent.click(asText);
  fireEvent.click(await screen.findByRole("button", { name: "Отправить" }));
  await waitFor(() => expect(input.value).toBe(""));
  expect(connection.submitDraft).toHaveBeenCalledExactlyOnceWith({
    channelId: "A",
    revision: "released",
  });
  expect(props.sendContext.performOther).toHaveBeenCalledOnce();
});
test("a saved command with an uncertain result cannot execute again simply by reopening its editor", async () => {
  const { connection, rows } = storage();
  rows.set("A/", {
    message: "/me test",
    revision: "pending",
    commandPending: true,
  });
  const props = { ...inputs(connection), online: true };
  render(<DraftComposer {...props} />);
  await field();
  expect(screen.getByText(/Сервер мог выполнить команду/)).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Выполнить команду" })
      .disabled,
  ).toBe(true);
  expect(props.sendContext.performOther).not.toHaveBeenCalled();
});
