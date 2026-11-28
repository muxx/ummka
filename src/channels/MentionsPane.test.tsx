import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { ResponseError } from "../../vendor/mattermost/index.js";
import { MentionsPane } from "./MentionsPane.tsx";
import { openMentionList } from "./mention-list.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function MentionWindow({
  model,
}: {
  model: ReturnType<typeof openMentionList>;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  return (
    <MentionsPane
      compact={false}
      state={state}
      model={model}
      language="en"
      team="Team"
      online
      standalone={false}
      authorName={() => undefined}
      channelName={() => undefined}
      openRow={() => {}}
      restore={null}
      close={() => {}}
    />
  );
}

test("a hidden window keeps both edges explicit and preserves keyboard focus through a retry and a terminal older page", async () => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const rows = Array.from({ length: 9 }, (_, page) => ({
    id: String(page),
    channelId: "a".repeat(26),
    message: `Window mention ${page}`,
    cards: [],
  }));
  let hidden = false;
  let failed = false;
  let denied = false;
  const readPage = vi.fn(async (page: number) => {
    if (denied) throw new ResponseError(new Response(null, { status: 403 }));
    if (hidden && page === 7 && !failed) {
      failed = true;
      throw new TypeError("offline");
    }
    return {
      page,
      items: hidden && page >= 4 ? [] : [rows[page]],
      nextPage: page >= 8 ? null : page + 1,
      firstInaccessiblePostTime: 0,
    };
  });
  const model = openMentionList(
    { openRecentMentions: async () => ({ readPage, filterKey: "mentions" }) },
    false,
  );
  await model.revalidate();
  for (let i = 1; i <= 6; i++) await model.load();
  model.suspend();
  model.retainReading(rows[5].id);
  render(<MentionWindow model={model} />);
  screen.getByRole("button", { name: /Window mention 5/ }).focus();
  hidden = true;
  readPage.mockClear();
  await act(async () => model.revalidate("5"));
  const upper = screen.getByRole("button", { name: "Load newer mentions" });
  expect(document.activeElement).toBe(upper);
  expect(readPage.mock.calls.map(([raw]) => raw)).toEqual([4, 5, 6]);
  fireEvent.click(
    screen.getByRole("button", { name: "Load earlier mentions" }),
  );
  const retry = await screen.findByRole("button", {
    name: "Retry loading earlier mentions",
  });
  expect(document.activeElement).toBe(retry);
  fireEvent.click(retry);
  const older = await screen.findByRole("button", {
    name: "Load earlier mentions",
  });
  expect(document.activeElement).toBe(older);
  expect(readPage.mock.calls.map(([raw]) => raw)).toEqual([4, 5, 6, 7, 7]);
  fireEvent.click(older);
  await act(async () => {});
  expect(screen.queryByText("No mentions yet")).toBeNull();
  expect(document.activeElement).toBe(upper);
  expect(readPage.mock.calls.map(([raw]) => raw)).toEqual([4, 5, 6, 7, 7, 8]);
  fireEvent.click(upper);
  const opened = await screen.findByRole("button", {
    name: /Window mention 3/,
  });
  expect(document.activeElement).toBe(opened);
  denied = true;
  await act(async () => model.revalidate("3"));
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "No access to mentions" }),
  );
  expect(screen.queryByRole("button", { name: /Window mention/ })).toBeNull();
  model.close();
});
