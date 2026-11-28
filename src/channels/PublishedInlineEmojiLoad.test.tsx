import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PublishedPostBody } from "./PublishedPostBody.tsx";

vi.mock("../mattermost/standard-emoji.ts", () => {
  throw Error("Local catalog unavailable");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("reports one rejected catalog import while subsequent posts remain readable", async () => {
  const report = vi.spyOn(console, "error").mockImplementation(() => {});
  const first = render(
    <PublishedPostBody
      inlineEmoji
      message={"Published :tada: &amp;#58;"}
      locale="en"
      authorName="Vera"
    />,
  );
  await waitFor(() => {
    expect(report).toHaveBeenCalledExactlyOnceWith(
      "Could not load the bundled standard emoji catalog",
      expect.objectContaining({
        cause: expect.objectContaining({
          message: "Local catalog unavailable",
        }),
      }),
    );
  });
  expect(screen.getByText("Published :tada: &#58;")).toBeTruthy();
  first.unmount();

  render(
    <PublishedPostBody
      inlineEmoji
      message="Reply :wave:"
      locale="en"
      authorName="Anna"
      inThread
    />,
  );
  expect(screen.getByText("Reply :wave:")).toBeTruthy();
  expect(report).toHaveBeenCalledTimes(1);
});
