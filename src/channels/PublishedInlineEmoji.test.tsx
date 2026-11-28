import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { LocalPost } from "../mattermost/local-history.ts";
import { PublishedPostBody, PublishedPostCards } from "./PublishedPostBody.tsx";
import { PublishedLinkNavigation } from "./PublishedPostLink.tsx";
import { PublishedReaderWindow } from "./PublishedReaderWindow.tsx";
import { TimelinePost } from "./TimelinePost.tsx";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const author = () => ({ name: "Vera" });
const time = new Intl.DateTimeFormat("en", { timeZone: "UTC" });
const href = "https://example.test/releases/:tada:/";
const message = [
  ":TADA::wave: :+1: :thumbsup: мир:tada:мир",
  "qa:tada:, :wave:2, _:tada:, :Audit_PENDING: and :MATTERMOST:",
  "Emphasis: :tada:_after_, _before_:tada:, _:tada:_ and :tada:*next*.",
  `[Report :wave:](${href}) · ${href} · <${href}>`,
  "` :tada: ` · ![Plan :tada:](https://example.test/image)",
  "```txt\nstatus=:tada:\n```",
].join("\n\n");

function post(body: string): LocalPost {
  return {
    id: "post",
    channelId: "channel",
    rootId: null,
    userId: "vera",
    createAt: 1,
    updateAt: 1,
    editAt: 0,
    hashtags: "",
    isPinned: false,
    type: "",
    message: body,
    messageSource: body,
  };
}

test("renders named Unicode emoji in a published channel post and thread replies", async () => {
  const row = post(message);
  const { container } = render(
    <PublishedLinkNavigation value={{ serverUrl: href, open: vi.fn() }}>
      <PublishedReaderWindow value={{ limit: 3, open: vi.fn() }}>
        <TimelinePost post={row} locale="en" time={time} author={author} />
        <TimelinePost
          post={{ ...row, id: "reply", rootId: row.id }}
          locale="en"
          time={time}
          author={author}
          inThread
        />
      </PublishedReaderWindow>
    </PublishedLinkNavigation>,
  );
  await waitFor(() => {
    expect(container.querySelector(".published-post p")?.textContent).toBe(
      "🎉👋 👍 👍 мир🎉мир",
    );
  });
  const bodies = [...container.querySelectorAll(".published-post")];
  expect(bodies).toHaveLength(2);
  for (const body of bodies) {
    const [intro, scope, emphasis] = body.querySelectorAll("p");
    expect(intro.textContent).toBe("🎉👋 👍 👍 мир🎉мир");
    expect(scope.textContent).toBe(
      "qa:tada:, :wave:2, _:tada:, :Audit_PENDING: and :MATTERMOST:",
    );
    expect(emphasis.innerHTML).toBe(
      "Emphasis: 🎉<em>after</em>, <em>before</em>🎉, <em>🎉</em> and 🎉<em>next</em>.",
    );
    expect(
      [...body.querySelectorAll("a")].map((a) => [
        a.textContent,
        a.getAttribute("href"),
      ]),
    ).toEqual([
      ["Report 👋", href],
      [href, href],
      [href, href],
      ["Plan :tada:", "https://example.test/image"],
    ]);
    expect(body.querySelector("p code")?.textContent).toBe(":tada:");
    expect(
      body.querySelector("pre code, .post-code-preview code")?.textContent,
    ).toBe("status=:tada:");
  }
  expect(row.messageSource).toBe(message);
});

test("leaves the Markdown in channel details and integration cards literal", () => {
  const { container } = render(
    <>
      <PublishedPostBody message="About :tada:" locale="en" authorName="Vera" />
      <PublishedPostCards
        cards={[{ text: "Result :tada:", fields: [] }]}
        locale="en"
        authorName="Vera"
      />
    </>,
  );
  expect(
    [...container.querySelectorAll(".published-post p")].map(
      (p) => p.textContent,
    ),
  ).toEqual(["About :tada:", "Result :tada:"]);
});
