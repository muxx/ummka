import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ResponseError } from "../../vendor/mattermost/index.js";
import { ComposerAccessNotice } from "./ComposerAccessNotice.tsx";
import { useTeamRoles } from "./use-workspace-read.ts";

afterEach(cleanup);

test("reads locally before directory publication and discards a late reply from another team", async () => {
  const first = {
    id: "one",
    name: "one",
    displayName: "One",
    roles: "",
    preferenceRank: null,
  };
  const second = { ...first, id: "two" };
  let finish!: (stored: boolean) => void;
  const connection = {
    rid: 1,
    readSavedTeamRoles: vi.fn(async (id: string) => ({
      systemRoles: id,
      definitions: [],
    })),
    refreshTeamRoles: vi.fn((id: string, _signal?: AbortSignal) =>
      id === first.id
        ? new Promise<boolean>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(true),
    ),
  };
  const view = renderHook(
    ({ team, published }) => useTeamRoles(connection, team, published),
    {
      initialProps: { team: first, published: false },
    },
  );
  await waitFor(() => expect(view.result.current.state.status).toBe("offline"));
  expect(view.result.current.state.value?.systemRoles).toBe("one");
  expect(connection.refreshTeamRoles).not.toHaveBeenCalled();
  view.rerender({ team: first, published: true });
  await waitFor(() =>
    expect(connection.refreshTeamRoles).toHaveBeenCalledTimes(1),
  );
  const signal = connection.refreshTeamRoles.mock.calls[0][1];
  view.rerender({ team: { ...first }, published: true });
  expect(connection.refreshTeamRoles).toHaveBeenCalledTimes(1);
  view.rerender({ team: second, published: true });
  expect(signal?.aborted).toBe(true);
  expect(view.result.current.state.value).toBeNull();
  await waitFor(() => expect(view.result.current.state.status).toBe("ready"));
  await act(async () => finish(true));
  expect(view.result.current.state.value?.systemRoles).toBe("two");
  expect(connection.refreshTeamRoles.mock.calls.map(([id]) => id)).toEqual([
    "one",
    "two",
  ]);
});

test("a role lookup refusal clears stale evidence, retries and propagates an expired session", async () => {
  const team = {
    id: "team",
    name: "team",
    displayName: "Team",
    preferenceRank: null,
  };
  const snapshot = {
    systemRoles: "writer",
    definitions: [{ name: "writer", permissions: ["create_post"] }],
  };
  const connection = {
    rid: 2,
    readSavedTeamRoles: vi.fn().mockResolvedValue(snapshot),
    refreshTeamRoles: vi
      .fn()
      .mockRejectedValueOnce(
        new ResponseError(new Response(null, { status: 403 })),
      )
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(
        new ResponseError(new Response(null, { status: 401 })),
      ),
  };
  const view = renderHook(() => useTeamRoles(connection, team, true));
  await waitFor(() =>
    expect(view.result.current.state).toEqual({
      value: null,
      status: "forbidden",
    }),
  );
  act(() => view.result.current.retry());
  await waitFor(() =>
    expect(view.result.current.state).toEqual({
      value: snapshot,
      status: "ready",
    }),
  );
  act(() => view.result.current.retry());
  await waitFor(() =>
    expect(view.result.current.state).toEqual({
      value: null,
      status: "unauthorized",
    }),
  );
});

test("distinguishes waiting, offline and failed permission checks without hiding the history", () => {
  const props = {
    access: "unknown",
    language: "ru",
    online: true,
    retry: vi.fn(),
    close: vi.fn(),
  } as const;
  const view = render(
    <ComposerAccessNotice {...props} statuses={["refreshing"]} />,
  );
  expect(screen.getByRole("status").textContent).toContain("Проверяем права");
  expect(screen.queryByRole("button")).toBeNull();
  view.rerender(
    <ComposerAccessNotice {...props} online={false} statuses={["offline"]} />,
  );
  expect(screen.getByRole("status").textContent).toContain(
    "Для проверки нужно подключение",
  );
  view.rerender(<ComposerAccessNotice {...props} statuses={["forbidden"]} />);
  fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
  expect(props.retry).toHaveBeenCalledOnce();
  view.rerender(
    <ComposerAccessNotice
      {...props}
      access="archived"
      statuses={["offline"]}
    />,
  );
  expect(screen.getByRole("note").textContent).toContain(
    "Вы просматриваете архивный канал.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Закрыть канал" }));
  expect(props.close).toHaveBeenCalledOnce();
  view.rerender(
    <ComposerAccessNotice
      {...props}
      access="writable"
      statuses={["offline"]}
    />,
  );
  expect(view.container.childElementCount).toBe(0);
});
