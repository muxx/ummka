import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ResponseError } from "../../vendor/mattermost/index.js";
import type { JoinedTeams } from "../mattermost/joined-teams";
import { openAccountRestConnection } from "../mattermost/native-rest";
import { AccountTeamWindow, type TeamWorkspace } from "./AccountTeamWindow";

vi.mock("../mattermost/native-rest", () => ({
  openAccountRestConnection: vi.fn(),
}));
const open = vi.mocked(openAccountRestConnection);
const server = "https://work.example.test/Work";
const user = "a".repeat(26);
const first = {
  id: "b".repeat(26),
  name: "alfa",
  displayName: "Альфа",
  preferenceRank: null,
};
const second = {
  id: "c".repeat(26),
  name: "beta",
  displayName: "Бета",
  preferenceRank: 0,
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  open.mockReset();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(snapshot: JoinedTeams | null) {
  const fake = {
    readWorkspaceSettings: vi
      .fn()
      .mockResolvedValue({ server: null, preferences: null }),
    refreshWorkspaceServerPolicy: vi.fn().mockResolvedValue(true),
    readJoinedTeams: vi
      .fn<() => Promise<JoinedTeams | null>>()
      .mockResolvedValue(snapshot),
    selectJoinedTeam: vi
      .fn<(id: string) => Promise<boolean>>()
      .mockResolvedValue(true),
    refreshJoinedTeams: vi
      .fn<(signal?: AbortSignal) => Promise<boolean>>()
      .mockResolvedValue(true),
    signOutOnDevice: vi.fn().mockResolvedValue("removed"),
    close: vi.fn().mockResolvedValue(undefined),
  };
  open.mockResolvedValue(
    fake as unknown as Awaited<ReturnType<typeof openAccountRestConnection>>,
  );
  return fake;
}
function view(onSessionEnded = vi.fn(), account = user) {
  return (
    <AccountTeamWindow
      language="ru"
      serverUrl={server}
      userId={account}
      onSessionEnded={onSessionEnded}
    >
      {({
        team,
        chooseAnotherTeam,
        userId,
        directoryNotice,
      }: TeamWorkspace) => (
        <button
          type="button"
          data-user={userId}
          data-notice={directoryNotice ?? ""}
          onClick={chooseAnotherTeam}
        >
          Открыта {team.displayName}
        </button>
      )}
    </AccountTeamWindow>
  );
}

test("opens the saved team before the network replies and restores focus when returning to the picker", async () => {
  const connection = fixture({
    teams: [first, second],
    selectedTeam: first.id,
  });
  connection.refreshJoinedTeams.mockReturnValue(new Promise(() => {}));
  const mounted = render(view());
  const workspace = await screen.findByRole("button", {
    name: "Открыта Альфа",
  });
  expect(workspace.getAttribute("data-user")).toBe(user);
  fireEvent.click(workspace);
  expect(screen.getByRole("button", { name: "Альфа", current: true })).toBe(
    document.activeElement,
  );
  const buttons = screen.getAllByRole("button");
  expect(buttons[0]).toBe(screen.getByRole("button", { name: "Бета" }));
  connection.readJoinedTeams.mockResolvedValue({
    teams: [first, second],
    selectedTeam: second.id,
  });
  fireEvent.click(buttons[0]);
  await screen.findByRole("button", { name: "Открыта Бета" });
  expect(connection.selectJoinedTeam).toHaveBeenCalledExactlyOnceWith(
    second.id,
  );
  mounted.unmount();
  expect(connection.close).toHaveBeenCalledTimes(1);
});

test("explains an offline cold cache and retries the same account", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const connection = fixture(null);
  render(view());
  expect((await screen.findByRole("alert")).textContent).toContain(
    "пока нет списка команд",
  );
  expect(connection.refreshJoinedTeams).not.toHaveBeenCalled();
  connection.readJoinedTeams.mockResolvedValue({
    teams: [],
    selectedTeam: null,
  });
  fireEvent.click(screen.getByRole("button", { name: "Попробовать снова" }));
  expect(
    await screen.findByText("У вас пока нет команд на этом сервере."),
  ).toBeTruthy();
  expect(open).toHaveBeenCalledTimes(2);
});

test("withdraws the old workspace on a server-confirmed 401 and retires only that connection", async () => {
  const ended = vi.fn();
  const connection = fixture({ teams: [first], selectedTeam: first.id });
  const pending = deferred<boolean>();
  connection.refreshJoinedTeams.mockReturnValue(pending.promise);
  render(view(ended));
  await screen.findByRole("button", { name: "Открыта Альфа" });
  await act(async () =>
    pending.reject(new ResponseError(new Response(null, { status: 401 }))),
  );
  expect(screen.queryByRole("button", { name: "Открыта Альфа" })).toBeNull();
  expect(connection.signOutOnDevice).toHaveBeenCalledOnce();
  expect(ended).toHaveBeenCalledOnce();
});

test("a transport failure retains the saved selection and a failed choice leaves its picker open", async () => {
  const connection = fixture({
    teams: [first, second],
    selectedTeam: first.id,
  });
  connection.refreshJoinedTeams.mockRejectedValue("network");
  render(view());
  fireEvent.click(await screen.findByRole("button", { name: "Открыта Альфа" }));
  connection.selectJoinedTeam.mockRejectedValue("history_storage_unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Бета" }));
  expect(
    await screen.findByText("Не удалось сохранить выбор команды."),
  ).toBeTruthy();
  expect(connection.signOutOnDevice).not.toHaveBeenCalled();
});

test("replacing the account before open completes releases the old handle without rendering it", async () => {
  const connection = fixture({ teams: [first], selectedTeam: first.id });
  const opening =
    deferred<Awaited<ReturnType<typeof openAccountRestConnection>>>();
  open.mockImplementationOnce(() => opening.promise);
  const mounted = render(view());
  mounted.rerender(view(vi.fn(), "d".repeat(26)));
  const workspace = await screen.findByRole("button", {
    name: "Открыта Альфа",
  });
  expect(workspace.getAttribute("data-user")).toBe("d".repeat(26));
  const close = vi.fn().mockResolvedValue(undefined);
  await act(async () =>
    opening.resolve({ ...connection, close } as unknown as Awaited<
      ReturnType<typeof openAccountRestConnection>
    >),
  );
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
});

test.each(["old value", "late rejection", "early rejection"] as const)(
  "the latest published directory completes a pending switch despite an older read: %s",
  async (outcome) => {
    const saved = { teams: [first, second], selectedTeam: first.id };
    const switched = { ...saved, selectedTeam: second.id };
    const connection = fixture(saved);
    const refresh = deferred<boolean>();
    const selection = deferred<JoinedTeams | null>();
    const background = deferred<JoinedTeams | null>();
    connection.refreshJoinedTeams.mockReturnValue(refresh.promise);
    render(view());
    fireEvent.click(
      await screen.findByRole("button", { name: "Открыта Альфа" }),
    );
    connection.readJoinedTeams
      .mockReturnValueOnce(selection.promise)
      .mockReturnValueOnce(background.promise);
    fireEvent.click(screen.getByRole("button", { name: "Бета" }));
    await waitFor(() =>
      expect(connection.readJoinedTeams).toHaveBeenCalledTimes(2),
    );
    await act(async () => refresh.resolve(true));
    expect(connection.readJoinedTeams).toHaveBeenCalledTimes(3);
    if (outcome === "early rejection")
      await act(async () => selection.reject("history_storage_unavailable"));
    await act(async () => background.resolve(switched));
    if (outcome === "late rejection")
      await act(async () => selection.reject("history_storage_unavailable"));
    if (outcome === "old value")
      await act(async () => selection.resolve(saved));
    expect(
      screen
        .getByRole("button", { name: "Открыта Бета" })
        .getAttribute("data-notice"),
    ).toBe("");
  },
);

test("an outdated background read cannot report a storage failure after the new choice", async () => {
  const saved = { teams: [first, second], selectedTeam: first.id };
  const connection = fixture(saved);
  const background = deferred<JoinedTeams | null>();
  connection.readJoinedTeams
    .mockResolvedValueOnce(saved)
    .mockReturnValueOnce(background.promise)
    .mockResolvedValue({ ...saved, selectedTeam: second.id });
  render(view());
  fireEvent.click(await screen.findByRole("button", { name: "Открыта Альфа" }));
  fireEvent.click(screen.getByRole("button", { name: "Бета" }));
  await screen.findByRole("button", { name: "Открыта Бета" });
  await act(async () => background.reject("history_storage_unavailable"));
  expect(
    screen
      .getByRole("button", { name: "Открыта Бета" })
      .getAttribute("data-notice"),
  ).toBe("");
});

test("a delayed choice cannot redisplay the old team during 401 removal or a retry after storage failure", async () => {
  const connection = fixture({
    teams: [first, second],
    selectedTeam: first.id,
  });
  const refresh = deferred<boolean>();
  const choose = deferred<boolean>();
  const remove = deferred<string>();
  connection.refreshJoinedTeams.mockReturnValue(refresh.promise);
  connection.selectJoinedTeam.mockReturnValue(choose.promise);
  connection.signOutOnDevice
    .mockReturnValueOnce(remove.promise)
    .mockResolvedValue("removed");
  const ended = vi.fn();
  render(view(ended));
  fireEvent.click(await screen.findByRole("button", { name: "Открыта Альфа" }));
  fireEvent.click(screen.getByRole("button", { name: "Бета" }));
  await act(async () =>
    refresh.reject(new ResponseError(new Response(null, { status: 401 }))),
  );
  await act(async () => choose.resolve(true));
  expect(screen.queryByRole("button", { name: /Открыта/ })).toBeNull();
  expect(connection.readJoinedTeams).toHaveBeenCalledTimes(1);
  await act(async () => remove.reject("credential_storage_unavailable"));
  fireEvent.click(
    await screen.findByRole("button", { name: "Попробовать снова" }),
  );
  await waitFor(() => expect(ended).toHaveBeenCalledOnce());
  expect(connection.signOutOnDevice).toHaveBeenCalledTimes(2);
  expect(open).toHaveBeenCalledTimes(1);
});
test("an account retired by another process is resolved again at launch", async () => {
  open.mockRejectedValue("session_unavailable");
  const ended = vi.fn();
  render(view(ended));
  await waitFor(() => expect(ended).toHaveBeenCalledOnce());
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a successful SQLite selection survives a read failure before any new refresh begins", async () => {
  const old = { teams: [first, second], selectedTeam: first.id };
  const db = fixture(old);
  const refresh = deferred<boolean>();
  db.refreshJoinedTeams.mockReturnValue(refresh.promise);
  render(view());
  fireEvent.click(await screen.findByRole("button", { name: "Открыта Альфа" }));
  const read = deferred<JoinedTeams | null>();
  db.readJoinedTeams
    .mockReturnValueOnce(read.promise)
    .mockResolvedValue({ ...old, selectedTeam: second.id });
  fireEvent.click(screen.getByRole("button", { name: "Бета" }));
  await screen.findByRole("button", { name: "Открыта Бета" });
  await act(async () => read.reject("history_storage_unavailable"));
  expect(
    screen
      .getByRole("button", { name: "Открыта Бета" })
      .getAttribute("data-notice"),
  ).toBe("storage");
  await act(async () => refresh.resolve(true));
  expect(
    screen
      .getByRole("button", { name: "Открыта Бета" })
      .getAttribute("data-notice"),
  ).toBe("");
  expect(db.selectJoinedTeam).toHaveBeenCalledOnce();
});
