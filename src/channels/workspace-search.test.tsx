import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { SearchAccount } from "./SearchDialog.tsx";
import { useWorkspaceSearch } from "./use-workspace-search.tsx";
import "./workspace-dom.test-utils.ts";

afterEach(cleanup);
const team = {
  id: "t".repeat(26),
  name: "north",
  displayName: "Север",
  preferenceRank: null,
};
const other = { ...team, id: "v".repeat(26), name: "south", displayName: "Юг" };
const channel = "c".repeat(26);
const post = "p".repeat(26);
function fixture() {
  let rows = ["from:anya выпуск", "ретро"];
  return {
    readJoinedTeams: vi.fn(async () => ({
      teams: [team, other],
      selectedTeam: team.id,
    })),
    readRecentTeamSearches: vi.fn(async (id: string) =>
      id === team.id ? rows : [],
    ),
    rememberTeamSearch: vi.fn(async () => true),
    forgetTeamSearch: vi.fn(async (_id: string, term: string) => {
      rows = rows.filter((t) => t !== term);
    }),
    readSearchTimezone: vi
      .fn<SearchAccount["readSearchTimezone"]>()
      .mockResolvedValue("Asia/Kathmandu"),
    readPostSearchPage: vi
      .fn<SearchAccount["readPostSearchPage"]>()
      .mockResolvedValue({
        items: [
          {
            id: post,
            channelId: channel,
            userId: "u".repeat(26),
            message: "Готово к выпуску",
          },
        ],
        isEnd: false,
        firstInaccessiblePostTime: 0,
        matches: null,
      }),
    readFileSearchPage: vi
      .fn<SearchAccount["readFileSearchPage"]>()
      .mockResolvedValue({
        items: [
          {
            id: "f".repeat(26),
            channelId: channel,
            postId: null,
            name: "release.pdf",
          },
        ],
        isEnd: true,
        firstInaccessibleFileTime: 0,
      }),
  } satisfies SearchAccount;
}
function Window({
  account,
  online = true,
  restricted = false,
}: {
  account: SearchAccount;
  online?: boolean;
  restricted?: boolean;
}) {
  const search = useWorkspaceSearch(
    {
      connection: account,
      team,
      online,
      sessionIssue: vi.fn(),
      policy: {
        server: {
          value: {
            search: {
              allTeams: !restricted,
              files: !restricted,
              archivedChannels: true,
            },
          },
        },
      },
    },
    "ru",
    () => "Релизы",
    () => "Анна",
  );
  return (
    <>
      {search.trigger}
      <textarea aria-label="Черновик" defaultValue="незаконченный текст" />
      {search.panel}
      {search.dialog}
    </>
  );
}
async function open() {
  fireEvent.click(screen.getByRole("button", { name: "Поиск" }));
  const form = await screen.findByRole("dialog");
  return { form, input: within(form).getByRole<HTMLInputElement>("searchbox") };
}
test("searches from the header, switches tabs without losing results and returns to the draft", async () => {
  const account = fixture();
  render(<Window account={account} />);
  const { form, input } = await open();
  fireEvent.click(
    await within(form).findByRole("button", { name: "from:anya выпуск" }),
  );
  expect(input.value).toBe("from:anya выпуск");
  expect(await screen.findByText("Готово к выпуску")).toBeTruthy();
  expect(account.rememberTeamSearch).toHaveBeenCalledWith(
    team.id,
    "from:anya выпуск",
  );
  expect(account.readPostSearchPage).toHaveBeenCalledWith(
    {
      teamId: team.id,
      terms: "from:anya выпуск",
      isOrSearch: false,
      includeDeletedChannels: true,
      timeZoneOffsetSeconds: 20700,
      page: 0,
    },
    expect.any(AbortSignal),
  );
  fireEvent.click(screen.getByRole("button", { name: "Файлы" }));
  expect(await screen.findByText("release.pdf")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Сообщения/ }));
  expect(screen.getByText("Готово к выпуску")).toBeTruthy();
  expect(account.readPostSearchPage).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Закрыть поиск" }));
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Черновик" })
      .value,
  ).toBe("незаконченный текст");
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Поиск" }),
  );
});
test.each(["field", "recent row"])(
  "Enter on the %s starts exactly one team search",
  async (origin) => {
    const account = fixture();
    const user = userEvent.setup();
    render(<Window account={account} />);
    const { form, input } = await open();
    const term = origin === "field" ? "план" : "from:anya выпуск";
    if (origin === "recent row") {
      const row = await within(form).findByRole("button", { name: term });
      await user.keyboard("{ArrowDown}");
      expect(document.activeElement).toBe(row);
    } else {
      await user.type(input, term);
    }
    await user.keyboard("{Enter}");
    await screen.findByText("Готово к выпуску");
    expect(account.rememberTeamSearch.mock.calls).toEqual([[team.id, term]]);
    expect(account.readPostSearchPage).toHaveBeenCalledOnce();
    expect(account.readPostSearchPage.mock.calls[0][0]).toMatchObject({
      teamId: team.id,
      terms: term,
      page: 0,
    });
    expect(account.readFileSearchPage).not.toHaveBeenCalled();
  },
);

test.each([
  ["saved", "Нет соединения."],
  ["missing team", "Не удалось сохранить недавние запросы."],
  ["storage error", "Не удалось сохранить недавние запросы."],
])(
  "an offline recent query stays focused and editable after %s",
  async (outcome, message) => {
    const account = fixture();
    const saving = deferred<boolean>();
    account.rememberTeamSearch.mockReturnValueOnce(saving.promise);
    const user = userEvent.setup();
    render(<Window account={account} online={false} />);
    const { form, input } = await open();
    await within(form).findByRole("button", { name: "from:anya выпуск" });
    await user.keyboard("{ArrowDown}{Enter}");
    expect(account.rememberTeamSearch).toHaveBeenCalledOnce();
    expect(input.value).toBe("from:anya выпуск");
    expect(input.disabled).toBe(false);
    expect(document.activeElement).toBe(input);
    await user.keyboard("x{Enter}");
    expect(input.value).toBe("from:anya выпуск");
    expect(account.rememberTeamSearch).toHaveBeenCalledOnce();
    await act(async () => {
      if (outcome === "storage error")
        saving.reject(new Error("disk unavailable"));
      else saving.resolve(outcome === "saved");
    });
    expect((await within(form).findByRole("alert")).textContent).toBe(message);
    expect(input.readOnly).toBe(false);
    expect(document.activeElement).toBe(input);
    await user.keyboard("!");
    expect(input.value).toBe("from:anya выпуск!");
    expect(account.readSearchTimezone).not.toHaveBeenCalled();
    expect(account.readPostSearchPage).not.toHaveBeenCalled();
  },
);

test("a slow first team's history cannot populate the second team's list or take its focus", async () => {
  const account = fixture();
  const previous = deferred<string[]>();
  account.readRecentTeamSearches.mockImplementation((id) =>
    id === team.id ? previous.promise : Promise.resolve(["обсуждение юга"]),
  );
  render(<Window account={account} />);
  const { form, input } = await open();
  await within(form).findByRole("option", { name: other.displayName });
  fireEvent.change(within(form).getByRole("combobox"), {
    target: { value: other.id },
  });
  const current = await within(form).findByRole("button", {
    name: "обсуждение юга",
  });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(document.activeElement).toBe(current);
  await act(async () => previous.resolve(["только для севера"]));
  expect(within(form).queryByText("только для севера")).toBeNull();
  expect(current.isConnected).toBe(true);
  expect(document.activeElement).toBe(current);
  expect(account.readRecentTeamSearches.mock.calls).toEqual([
    [team.id],
    [other.id],
  ]);
});

test("keyboard navigation removes the selected recent term and restores focus after the last deletion", async () => {
  const account = fixture();
  render(<Window account={account} />);
  const { form, input } = await open();
  const first = await within(form).findByRole("button", {
    name: "from:anya выпуск",
  });
  const second = within(form).getByRole("button", { name: "ретро" });
  fireEvent.keyDown(input, { key: "ArrowDown", isComposing: true });
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: "ArrowUp" });
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(document.activeElement).toBe(second);
  fireEvent.keyDown(second, { key: "Delete" });
  await waitFor(() => expect(document.activeElement).toBe(first));
  expect(
    await within(form).findByText("Убрали «ретро» из недавних."),
  ).toBeTruthy();
  fireEvent.keyDown(first, { key: "Delete" });
  await waitFor(() => expect(document.activeElement).toBe(input));
  expect(
    await within(form).findByText("Убрали «from:anya выпуск» из недавних."),
  ).toBeTruthy();
  expect(account.readPostSearchPage).not.toHaveBeenCalled();
});

test("typing hides past terms and a late deletion does not take focus from another scope", async () => {
  const account = fixture();
  account.readRecentTeamSearches.mockImplementation(async (id) =>
    id === team.id ? ["from:anya выпуск", "ретро"] : ["южная история"],
  );
  let finish!: () => void;
  account.forgetTeamSearch.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(<Window account={account} />);
  const { form, input } = await open();
  const first = await within(form).findByRole("button", {
    name: "from:anya выпуск",
  });
  fireEvent.change(input, { target: { value: "новый запрос" } });
  expect(first.isConnected).toBe(false);
  fireEvent.change(input, { target: { value: "" } });
  const control = await within(form).findByRole("button", {
    name: "Удалить запрос, ретро",
  });
  control.focus();
  fireEvent.click(control);
  fireEvent.change(within(form).getByRole("combobox"), {
    target: { value: other.id },
  });
  const south = await within(form).findByRole("button", {
    name: "южная история",
  });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(document.activeElement).toBe(south);
  await act(async () => finish());
  expect(document.activeElement).toBe(south);
  expect(within(form).queryByText("ретро")).toBeNull();
  expect(account.forgetTeamSearch.mock.calls).toEqual([[team.id, "ретро"]]);
  expect(account.readRecentTeamSearches.mock.calls).toEqual([
    [team.id],
    [other.id],
  ]);
  expect(within(form).queryByText("Убрали «ретро» из недавних.")).toBeNull();
});

test("all-team search removes scoped filters, retains the date and skips recent history", async () => {
  const account = fixture();
  render(<Window account={account} />);
  const { form, input } = await open();
  fireEvent.change(input, {
    target: { value: "from:anya план in:dev after:2026-01-01" },
  });
  fireEvent.change(await within(form).findByRole("combobox"), {
    target: { value: "" },
  });
  expect(input.value).toBe("план after:2026-01-01");
  fireEvent.click(within(form).getByRole("button", { name: "Найти" }));
  await screen.findByText("Готово к выпуску");
  expect(account.rememberTeamSearch).not.toHaveBeenCalled();
  expect(account.readPostSearchPage.mock.calls[0]?.[0].teamId).toBeNull();
});
test("the offline team can remove a recent query, save another and leave the network idle", async () => {
  const account = fixture();
  render(<Window account={account} online={false} restricted />);
  const { form, input } = await open();
  expect(within(form).queryByRole("combobox")).toBeNull();
  expect(within(form).queryByRole("button", { name: "Файлы" })).toBeNull();
  const remove = await within(form).findByRole("button", {
    name: "Удалить запрос, from:anya выпуск",
  });
  remove.focus();
  fireEvent.click(remove);
  await waitFor(() =>
    expect(document.activeElement).toBe(
      within(form).getByRole("button", { name: "ретро" }),
    ),
  );
  fireEvent.change(input, { target: { value: "выпуск" } });
  fireEvent.click(within(form).getByRole("button", { name: "Найти" }));
  expect(await within(form).findByRole("alert")).toHaveProperty(
    "textContent",
    "Нет соединения.",
  );
  expect(account.rememberTeamSearch).toHaveBeenCalledWith(team.id, "выпуск");
  expect(account.readSearchTimezone).not.toHaveBeenCalled();
});
test("closing the form while its timezone is pending cannot start a result session", async () => {
  const account = fixture();
  let finish!: (s: string) => void;
  account.readSearchTimezone.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<Window account={account} />);
  const { form, input } = await open();
  fireEvent.change(input, { target: { value: "план" } });
  fireEvent.click(within(form).getByRole("button", { name: "Найти" }));
  await waitFor(() =>
    expect(account.readSearchTimezone).toHaveBeenCalledOnce(),
  );
  fireEvent.click(within(form).getByRole("button", { name: "Закрыть поиск" }));
  await act(async () => finish("UTC"));
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(account.readPostSearchPage).not.toHaveBeenCalled();
});

test("a changed server policy discards results and keeps the next search within the current team", async () => {
  const account = fixture();
  const window = render(<Window account={account} />);
  const { form, input } = await open();
  fireEvent.change(within(form).getByRole("combobox"), {
    target: { value: "" },
  });
  fireEvent.change(input, { target: { value: "выпуск" } });
  fireEvent.click(within(form).getByRole("button", { name: "Файлы" }));
  fireEvent.click(within(form).getByRole("button", { name: "Найти" }));
  await screen.findByText("release.pdf");
  window.rerender(<Window account={account} restricted />);
  expect(screen.queryByText("release.pdf")).toBeNull();
  const next = await open();
  expect(within(next.form).queryByRole("combobox")).toBeNull();
  expect(within(next.form).queryByRole("button", { name: "Файлы" })).toBeNull();
  fireEvent.change(next.input, { target: { value: "повтор" } });
  fireEvent.click(within(next.form).getByRole("button", { name: "Найти" }));
  await screen.findByText("Готово к выпуску");
  expect(account.readPostSearchPage.mock.calls[0]?.[0].teamId).toBe(team.id);
});

test("retains existing results through a page error and retries the same page", async () => {
  const account = fixture();
  render(<Window account={account} />);
  const { form, input } = await open();
  fireEvent.change(input, { target: { value: "релиз" } });
  expect(fireEvent.keyDown(input, { key: "Enter", isComposing: true })).toBe(
    false,
  );
  expect(account.rememberTeamSearch).not.toHaveBeenCalled();
  fireEvent.click(within(form).getByRole("button", { name: "Найти" }));
  await screen.findByText("Готово к выпуску");
  account.readPostSearchPage.mockRejectedValueOnce(new TypeError("network"));
  fireEvent.click(screen.getByRole("button", { name: "Показать ещё" }));
  await screen.findByText("Не удалось загрузить результаты.");
  expect(screen.getByText("Готово к выпуску")).toBeTruthy();
  account.readPostSearchPage.mockResolvedValueOnce({
    items: [],
    isEnd: true,
    firstInaccessiblePostTime: 101,
    matches: {},
  });
  fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
  await screen.findByText("Часть старых результатов недоступна.");
  expect(screen.getByText("Готово к выпуску")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Показать ещё" })).toBeNull();
  expect(account.readPostSearchPage.mock.calls.map(([q]) => q.page)).toEqual([
    0, 1, 1,
  ]);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test("editing a file search keeps the displayed team and submitted scope while the directory is pending", async () => {
  const account = fixture();
  render(<Window account={account} />);
  const { form, input } = await open();
  await within(form).findByRole("option", { name: other.displayName });
  fireEvent.change(within(form).getByRole("combobox"), {
    target: { value: other.id },
  });
  fireEvent.change(input, { target: { value: "release" } });
  fireEvent.click(within(form).getByRole("button", { name: "Файлы" }));
  fireEvent.click(within(form).getByRole("button", { name: "Найти" }));
  await screen.findByText("release.pdf");
  const directory =
    deferred<Awaited<ReturnType<typeof account.readJoinedTeams>>>();
  account.readJoinedTeams.mockReturnValueOnce(directory.promise);
  fireEvent.click(
    screen.getByRole("button", { name: "Изменить запрос, release" }),
  );
  const edit = await screen.findByRole("dialog");
  const select = within(edit).getByRole<HTMLSelectElement>("combobox");
  expect(select.selectedOptions[0]?.textContent).toBe(other.displayName);
  expect(select.value).toBe(other.id);
  const terms = within(edit).getByRole("searchbox");
  fireEvent.change(terms, { target: { value: "release 2" } });
  const editedForm = terms.closest("form");
  if (!editedForm) throw Error("Missing search form");
  fireEvent.submit(editedForm);
  await screen.findByRole("button", { name: "Изменить запрос, release 2" });
  expect(
    account.readFileSearchPage.mock.calls.map(([q]) => [q.teamId, q.terms]),
  ).toEqual([
    [other.id, "release"],
    [other.id, "release 2"],
  ]);
  expect(account.rememberTeamSearch).toHaveBeenLastCalledWith(
    other.id,
    "release 2",
  );
  await act(async () =>
    directory.resolve({ teams: [team, other], selectedTeam: team.id }),
  );
});

test("each edited query reads the current profile timezone; both tabs and pagination keep its offset", async () => {
  const account = fixture();
  account.readSearchTimezone
    .mockResolvedValueOnce("Asia/Kathmandu")
    .mockResolvedValueOnce("UTC");
  render(<Window account={account} />);
  const { form, input } = await open();
  fireEvent.change(input, { target: { value: "on:2026-01-01" } });
  fireEvent.click(within(form).getByRole("button", { name: "Найти" }));
  await screen.findByText("Готово к выпуску");
  fireEvent.click(screen.getByRole("button", { name: "Файлы" }));
  await screen.findByText("release.pdf");
  expect(
    account.readFileSearchPage.mock.calls[0]?.[0].timeZoneOffsetSeconds,
  ).toBe(20700);
  fireEvent.click(
    screen.getByRole("button", { name: "Изменить запрос, on:2026-01-01" }),
  );
  const edit = await screen.findByRole("dialog");
  fireEvent.change(within(edit).getByRole("searchbox"), {
    target: { value: "after:2026-01-02" },
  });
  fireEvent.click(within(edit).getByRole("button", { name: "Найти" }));
  await screen.findByRole("button", {
    name: "Изменить запрос, after:2026-01-02",
  });
  await screen.findByText("release.pdf");
  expect(
    account.readFileSearchPage.mock.calls.map(([q]) => [
      q.terms,
      q.timeZoneOffsetSeconds,
    ]),
  ).toEqual([
    ["on:2026-01-01", 20700],
    ["after:2026-01-02", 0],
  ]);
  fireEvent.click(screen.getByRole("button", { name: /Сообщения/ }));
  await screen.findByText("Готово к выпуску");
  fireEvent.click(screen.getByRole("button", { name: "Показать ещё" }));
  await waitFor(() =>
    expect(account.readPostSearchPage).toHaveBeenCalledTimes(3),
  );
  expect(
    account.readPostSearchPage.mock.calls.map(([q]) => [
      q.terms,
      q.page,
      q.timeZoneOffsetSeconds,
    ]),
  ).toEqual([
    ["on:2026-01-01", 0, 20700],
    ["after:2026-01-02", 0, 0],
    ["after:2026-01-02", 1, 0],
  ]);
  expect(account.readSearchTimezone).toHaveBeenCalledTimes(2);
});

test("removing two recent queries remains correct when the second deletion completes first", async () => {
  const account = fixture();
  const a = "from:anya выпуск",
    b = "ретро";
  const first = deferred<void>(),
    second = deferred<void>();
  let stored = [a, b];
  account.readRecentTeamSearches.mockImplementation(async () => [...stored]);
  account.forgetTeamSearch.mockImplementation(async (_id, term) => {
    await (term === a ? first : second).promise;
    stored = stored.filter((row) => row !== term);
  });
  render(<Window account={account} />);
  const { form, input } = await open();
  const removeA = await within(form).findByRole("button", {
    name: `Удалить запрос, ${a}`,
  });
  const removeB = within(form).getByRole("button", {
    name: `Удалить запрос, ${b}`,
  });
  removeA.focus();
  fireEvent.click(removeA);
  removeB.focus();
  fireEvent.click(removeB);
  await act(async () => second.resolve());
  expect(within(form).queryByRole("button", { name: b })).toBeNull();
  expect(within(form).getByRole("button", { name: a })).toBeTruthy();
  await act(async () => first.resolve());
  expect(within(form).queryByRole("button", { name: a })).toBeNull();
  expect(document.activeElement).toBe(input);
});

test("a team removed from the refreshed directory cannot submit an edited query until the user selects another scope", async () => {
  const account = fixture();
  render(<Window account={account} />);
  const { form, input } = await open();
  await within(form).findByRole("option", { name: other.displayName });
  fireEvent.change(within(form).getByRole("combobox"), {
    target: { value: other.id },
  });
  fireEvent.change(input, { target: { value: "выпуск" } });
  fireEvent.click(within(form).getByRole("button", { name: "Найти" }));
  await screen.findByText("Готово к выпуску");
  account.readJoinedTeams.mockResolvedValueOnce({
    teams: [team],
    selectedTeam: team.id,
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Изменить запрос, выпуск" }),
  );
  const edit = await screen.findByRole("dialog");
  const select = within(edit).getByRole<HTMLSelectElement>("combobox");
  await within(edit).findByRole("option", { name: "Юг · Команда недоступна" });
  expect(select.value).toBe(other.id);
  const run = within(edit).getByRole<HTMLButtonElement>("button", {
    name: "Найти",
  });
  expect(run.disabled).toBe(true);
  if (!run.form) throw Error("Missing search form");
  fireEvent.submit(run.form);
  expect(account.rememberTeamSearch).toHaveBeenCalledTimes(1);
  fireEvent.change(select, { target: { value: team.id } });
  fireEvent.click(run);
  await waitFor(() =>
    expect(account.readPostSearchPage).toHaveBeenCalledTimes(2),
  );
  expect(account.readPostSearchPage.mock.calls.map(([q]) => q.teamId)).toEqual([
    other.id,
    team.id,
  ]);
});

test("a delayed snapshot of recent terms cannot restore a later deletion", async () => {
  const account = fixture();
  const a = "from:anya выпуск",
    b = "ретро";
  const late = deferred<string[]>();
  account.readRecentTeamSearches
    .mockResolvedValueOnce([a, b])
    .mockReturnValueOnce(late.promise)
    .mockResolvedValueOnce([]);
  render(<Window account={account} />);
  const { form, input } = await open();
  fireEvent.click(
    await within(form).findByRole("button", { name: `Удалить запрос, ${a}` }),
  );
  await waitFor(() =>
    expect(account.readRecentTeamSearches).toHaveBeenCalledTimes(2),
  );
  const removeB = within(form).getByRole("button", {
    name: `Удалить запрос, ${b}`,
  });
  removeB.focus();
  fireEvent.click(removeB);
  await waitFor(() => expect(within(form).queryByRole("list")).toBeNull());
  await act(async () => late.resolve([b]));
  expect(within(form).queryByRole("list")).toBeNull();
  expect(document.activeElement).toBe(input);
});
