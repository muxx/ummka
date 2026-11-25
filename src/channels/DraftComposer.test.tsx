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
  return {
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
