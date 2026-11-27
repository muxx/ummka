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
import { isMobile } from "../build-platform";
import { atDirectoryStep } from "../mattermost/account-directory-error";
import { channelProfile } from "../mattermost/channel-profiles";
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
    readSavedProfiles: vi
      .fn()
      .mockResolvedValue({ profiles: {}, usernames: {} }),
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
function view(onSessionEnded = vi.fn(), account = user, siteName?: string) {
  return (
    <AccountTeamWindow
      language="ru"
      serverUrl={server}
      userId={account}
      siteName={siteName}
      onSessionEnded={onSessionEnded}
    >
      {({
        team,
        teamChoice,
        userId,
        directoryNotice,
        directoryCode,
      }: TeamWorkspace) => (
        <>
          <button
            type="button"
            data-user={userId}
            data-notice={directoryNotice ?? ""}
            data-code={directoryCode ?? ""}
          >
            Открыта {team.displayName}
          </button>
          {teamChoice.teams.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              onClick={() => void teamChoice.select(candidate)}
            >
              {candidate.displayName}
            </button>
          ))}
        </>
      )}
    </AccountTeamWindow>
  );
}

test("opens the saved team with ordered choices before the network replies", async () => {
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
  const [, firstChoice] = screen.getAllByRole("button");
  expect(firstChoice).toBe(screen.getByRole("button", { name: "Бета" }));
  connection.readJoinedTeams.mockResolvedValue({
    teams: [first, second],
    selectedTeam: second.id,
  });
  fireEvent.click(firstChoice);
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
  fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
  expect(
    await screen.findByRole("heading", { name: "Команд пока нет" }),
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

test("first choice stays on the same team through a refused write and retry", async () => {
  const teams = [first, second];
  const connection = fixture({
    teams,
    selectedTeam: null,
  });
  const write = deferred<boolean>();
  connection.selectJoinedTeam.mockReturnValueOnce(write.promise);
  const ended = vi.fn();
  render(view(ended));
  const beta = await screen.findByRole("button", { name: "Бета" });
  const alpha = screen.getByRole("button", { name: "Альфа" });
  expect(document.activeElement).toBe(
    isMobile ? screen.getByRole("heading") : beta,
  );
  fireEvent.click(beta);
  fireEvent.click(alpha);
  fireEvent.click(beta);
  expect(beta.getAttribute("aria-busy")).toBe("true");
  expect((alpha as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("status").textContent).toBe(
    "Сохраняем выбор команды «Бета»…",
  );
  expect(screen.getByText("Открываем…")).toBeTruthy();
  await waitFor(() =>
    expect(connection.selectJoinedTeam).toHaveBeenCalledExactlyOnceWith(
      second.id,
    ),
  );
  await act(async () => write.reject("history_storage_unavailable"));
  const banner = await screen.findByRole("alert");
  expect(banner.textContent).toContain("Не открыли «Бета»");
  expect(banner.textContent).toContain("select.history_storage_unavailable");
  expect(alpha.getAttribute("aria-disabled")).toBeNull();
  const retry = screen.getByRole("button", {
    name: "Повторить: открыть «Бета»",
  });
  expect(document.activeElement).toBe(retry);
  connection.readJoinedTeams.mockResolvedValue({
    teams,
    selectedTeam: second.id,
  });
  fireEvent.click(retry);
  await screen.findByRole("button", { name: "Открыта Бета" });
  expect(connection.selectJoinedTeam.mock.calls).toEqual([
    [second.id],
    [second.id],
  ]);
  expect(connection.refreshJoinedTeams).toHaveBeenCalledOnce();
  expect(connection.signOutOnDevice).not.toHaveBeenCalled();
  expect(ended).not.toHaveBeenCalled();
});

test.each(["write", "snapshot"] as const)(
  "retires the current account when the first choice loses its session during %s",
  async (step) => {
    const db = fixture({ teams: [first, second], selectedTeam: null });
    db.refreshJoinedTeams.mockReturnValue(new Promise(() => {}));
    const ended = vi.fn();
    render(view(ended));
    const beta = await screen.findByRole("button", { name: "Бета" });
    const rejected = deferred<never>();
    if (step === "write")
      db.selectJoinedTeam.mockReturnValueOnce(rejected.promise);
    else db.readJoinedTeams.mockReturnValueOnce(rejected.promise);
    fireEvent.click(beta);
    await waitFor(() => {
      expect(db.selectJoinedTeam).toHaveBeenCalledExactlyOnceWith(second.id);
      expect(db.readJoinedTeams).toHaveBeenCalledTimes(
        step === "write" ? 1 : 2,
      );
    });
    await act(async () => rejected.reject("session_unavailable"));
    expect(ended).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Бета" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Открыта Бета" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(db.signOutOnDevice).not.toHaveBeenCalled();
  },
);

test("a late first selection failure cannot withdraw the replacement account", async () => {
  const snapshot = { teams: [first, second], selectedTeam: null };
  const previous = fixture(snapshot);
  previous.refreshJoinedTeams.mockReturnValue(new Promise(() => {}));
  const paused = deferred<boolean>();
  previous.selectJoinedTeam.mockReturnValueOnce(paused.promise);
  const ended = vi.fn();
  const mounted = render(view(ended));
  fireEvent.click(await screen.findByRole("button", { name: "Бета" }));
  await waitFor(() => expect(previous.selectJoinedTeam).toHaveBeenCalledOnce());
  const replacement = fixture(snapshot);
  mounted.rerender(view(ended, "d".repeat(26)));
  await screen.findByRole("button", { name: "Бета" });
  await act(async () => paused.reject("session_unavailable"));
  expect(ended).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Бета" })).toBeTruthy();
  expect(replacement.signOutOnDevice).not.toHaveBeenCalled();
});

test.each(["session_unavailable", "history_storage_unavailable"] as const)(
  "checks the account scope when the optional profile read returns %s",
  async (cause) => {
    const db = fixture({ teams: [first, second], selectedTeam: null });
    db.refreshJoinedTeams.mockReturnValue(new Promise(() => {}));
    const profile = deferred<never>();
    db.readSavedProfiles.mockReturnValueOnce(profile.promise);
    const ended = vi.fn();
    render(view(ended));
    await screen.findByRole("button", { name: "Бета" });
    await act(async () => profile.reject(cause));
    const retired = cause === "session_unavailable";
    expect(ended).toHaveBeenCalledTimes(retired ? 1 : 0);
    expect(Boolean(screen.queryByRole("button", { name: "Бета" }))).toBe(
      !retired,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  },
);

test("an unavailable team cannot be retried from the failure banner", async () => {
  const connection = fixture({ teams: [first, second], selectedTeam: null });
  connection.refreshJoinedTeams.mockReturnValue(new Promise(() => {}));
  connection.selectJoinedTeam.mockResolvedValueOnce(false);
  render(view());
  await screen.findByRole("button", { name: "Бета" });
  connection.readJoinedTeams.mockResolvedValue({
    teams: [first],
    selectedTeam: null,
  });
  fireEvent.click(screen.getByRole("button", { name: "Бета" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Команда больше недоступна.",
  );
  expect(screen.queryByRole("button", { name: /Повторить/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Бета" })).toBeNull();
  expect(screen.getByRole("button", { name: "Альфа" })).toBeTruthy();
});

test("shows only the current account’s cached name without waiting or moving focus", async () => {
  const snapshot = { teams: [first, second], selectedTeam: null };
  const connection = fixture(snapshot);
  const identity = deferred<{
    profiles: Record<string, ReturnType<typeof channelProfile>>;
    usernames: Record<string, never>;
  }>();
  connection.readSavedProfiles.mockReturnValueOnce(identity.promise);
  const mounted = render(view(vi.fn(), user, "Наша установка"));
  const alpha = await screen.findByRole("button", { name: "Альфа" });
  expect(screen.getByText("Вход выполнен.")).toBeTruthy();
  expect(screen.getByTitle(server).textContent).toBe("work.example.test/Work");
  expect(screen.getAllByText("Наша установка")).toHaveLength(3);
  alpha.focus();
  const profile = channelProfile({
    id: user,
    username: "anna",
    firstName: "Анна",
    lastName: "Северова",
  });
  await act(async () =>
    identity.resolve({ profiles: { [user]: profile }, usernames: {} }),
  );
  expect(screen.getByText("Анна Северова")).toBeTruthy();
  expect(document.activeElement).toBe(alpha);
  expect(connection.readSavedProfiles).toHaveBeenCalledExactlyOnceWith({
    ids: [user],
    usernames: [],
  });
  const replacement = fixture(snapshot);
  const other = "d".repeat(26);
  replacement.readSavedProfiles.mockResolvedValue({
    profiles: { [other]: profile },
    usernames: {},
  });
  mounted.rerender(view(vi.fn(), other));
  await screen.findByRole("button", { name: "Альфа" });
  expect(screen.getByText("Вход выполнен.")).toBeTruthy();
  expect(screen.queryByText("Анна Северова")).toBeNull();
  expect(screen.queryByText("Наша установка")).toBeNull();
});

test("an empty directory can be checked again after an invitation", async () => {
  const connection = fixture({ teams: [], selectedTeam: null });
  render(view());
  await screen.findByRole("heading", { name: "Команд пока нет" });
  expect(screen.queryByRole("button", { name: "Другой сервер" })).toBeNull();
  connection.readJoinedTeams.mockResolvedValue({
    teams: [first, second],
    selectedTeam: null,
  });
  fireEvent.click(screen.getByRole("button", { name: "Проверить снова" }));
  await screen.findByRole("button", { name: "Бета" });
  expect(connection.refreshJoinedTeams).toHaveBeenCalledTimes(2);
  expect(connection.selectJoinedTeam).not.toHaveBeenCalled();
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
    await screen.findByRole("button", { name: "Открыта Альфа" });
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
  fireEvent.click(await screen.findByRole("button", { name: "Повторить" }));
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

test("shows a safe server error code and clears it when a retry opens the team", async () => {
  const db = fixture(null);
  db.refreshJoinedTeams.mockImplementationOnce(() =>
    atDirectoryStep("preferences", () => {
      throw new ResponseError(
        new Response("private response body", { status: 503 }),
        "private error message",
      );
    }),
  );
  render(view());
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("preferences.http-503");
  expect(alert.textContent).not.toContain("Проверьте соединение");
  expect(document.body.textContent).not.toContain("private");
  db.readJoinedTeams.mockResolvedValue({
    teams: [first],
    selectedTeam: first.id,
  });
  fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
  await screen.findByRole("button", { name: "Открыта Альфа" });
  expect(document.body.textContent).not.toContain("preferences.http-503");
  expect(db.signOutOnDevice).not.toHaveBeenCalled();
});

test("shows a local publication error separately from network failures", async () => {
  const db = fixture(null);
  db.refreshJoinedTeams.mockImplementationOnce(() =>
    atDirectoryStep("publish", () => {
      throw "history_storage_unavailable";
    }),
  );
  render(view());
  expect((await screen.findByRole("alert")).textContent).toContain(
    "publish.history_storage_unavailable",
  );
});

test.each(["older succeeds", "older fails"] as const)(
  "a superseded refresh cannot replace the latest notice (%s)",
  async (outcome) => {
    const db = fixture({ teams: [first], selectedTeam: first.id });
    const older = deferred<boolean>(),
      newer = deferred<boolean>();
    db.refreshJoinedTeams
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    render(view());
    const workspace = await screen.findByRole("button", {
      name: "Открыта Альфа",
    });
    await waitFor(() => expect(db.refreshJoinedTeams).toHaveBeenCalledTimes(1));
    fireEvent(window, new Event("online"));
    await waitFor(() => expect(db.refreshJoinedTeams).toHaveBeenCalledTimes(2));
    if (outcome === "older succeeds") {
      await act(async () =>
        newer.reject(new ResponseError(new Response(null, { status: 503 }))),
      );
      expect(workspace.getAttribute("data-code")).toBe("directory.http-503");
      await act(async () => older.resolve(false));
      expect(workspace.getAttribute("data-code")).toBe("directory.http-503");
    } else {
      await act(async () => newer.resolve(true));
      await act(async () =>
        older.reject(new ResponseError(new Response(null, { status: 403 }))),
      );
      expect(workspace.getAttribute("data-notice")).toBe("");
    }
  },
);
