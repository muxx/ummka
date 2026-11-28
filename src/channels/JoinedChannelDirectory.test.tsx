import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { projectTeamSidebar } from "../mattermost/team-sidebar.ts";
import { JoinedChannelDirectory } from "./JoinedChannelDirectory.tsx";

afterEach(cleanup);
const teamId = "t".repeat(26);
const userId = "u".repeat(26);
const entries = [
  {
    id: "a".repeat(26),
    name: "trees",
    displayName: "Ёлки",
    type: "O",
    purpose: "Анонсы лесничества",
  },
  {
    id: "b".repeat(26),
    name: "trees-old",
    displayName: "Ёлки",
    type: "P",
    deleteAt: 42,
  },
  {
    id: "d".repeat(26),
    name: "direct",
    displayName: "Личная беседа",
    type: "D",
  },
  {
    id: "g".repeat(26),
    name: "group",
    displayName: "Групповой чат",
    type: "G",
  },
];
const data = projectTeamSidebar({
  teamId,
  categories: [],
  channels: entries.map((channel) => ({
    channel: { deleteAt: 0, ...channel },
    membership: { channelId: channel.id, userId },
  })),
});
const value = { selectedChannel: null, data };
test("the joined directory selects public and private memberships by ID and searches folded display names and handles offline", () => {
  const choose = vi.fn();
  render(
    <JoinedChannelDirectory
      state={{ value, status: "offline" }}
      language="ru"
      choose={choose}
      retry={vi.fn()}
    />,
  );
  const rows = within(screen.getByRole("list", { name: "Мои каналы" }));
  expect(rows.getAllByRole("button")).toHaveLength(2);
  const input = screen.getByRole("searchbox", { name: "Найти канал" });
  fireEvent.change(input, { target: { value: "  #еЛК  " } });
  expect(rows.getAllByRole("button")).toHaveLength(2);
  fireEvent.click(
    rows.getByRole("button", { name: /Ёлки, Закрытый канал, В архиве/ }),
  );
  expect(choose).toHaveBeenCalledExactlyOnceWith(entries[1].id);
  fireEvent.change(input, { target: { value: "trees-old" } });
  expect(rows.getAllByRole("button")).toHaveLength(1);
  fireEvent.change(input, { target: { value: "личная" } });
  expect(screen.getByRole("heading", { name: "Совпадений нет" })).toBeTruthy();
  expect(screen.getByText("Измените запрос.")).toBeTruthy();
  expect(screen.getByText("Без сети · Сохранено на устройстве")).toBeTruthy();
});
test("revoked access hides cached room names immediately, while retry and empty states are explicit", () => {
  const props = { language: "en" as const, choose: vi.fn(), retry: vi.fn() };
  const { rerender } = render(
    <JoinedChannelDirectory {...props} state={{ value, status: "network" }} />,
  );
  expect(screen.getByText("Анонсы лесничества")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(props.retry).toHaveBeenCalledOnce();
  rerender(
    <JoinedChannelDirectory
      {...props}
      state={{ value, status: "forbidden" }}
    />,
  );
  expect(screen.queryByRole("list")).toBeNull();
  expect(screen.queryByText("Анонсы лесничества")).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain(
    "no longer available",
  );
  rerender(
    <JoinedChannelDirectory
      {...props}
      state={{ value: null, status: "loading" }}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain("Loading");
  rerender(
    <JoinedChannelDirectory
      {...props}
      state={{
        value: { ...value, data: { categories: [], channels: [] } },
        status: "ready",
      }}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain("channels");
});

test("joined channels use lexical display names and keep both equal-name destinations in source order", () => {
  const choose = vi.fn();
  const channels = [
    {
      ...data.channels[0],
      id: "z".repeat(26),
      name: "z",
      displayName: "Room 2",
    },
    {
      ...data.channels[0],
      id: "b".repeat(26),
      name: "b",
      displayName: "Room 10",
    },
    {
      ...data.channels[0],
      id: "a".repeat(26),
      name: "a",
      displayName: "Room 2",
    },
  ];
  render(
    <JoinedChannelDirectory
      state={{
        status: "ready",
        value: { ...value, data: { ...data, channels } },
      }}
      language="en"
      choose={choose}
      retry={vi.fn()}
    />,
  );
  const list = within(screen.getByRole("list", { name: "My channels" }));
  for (const row of list.getAllByRole("button")) fireEvent.click(row);
  expect(choose.mock.calls.map(([id]) => id)).toEqual([
    channels[1].id,
    channels[0].id,
    channels[2].id,
  ]);
});
