import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { isAndroid } from "../build-platform.ts";
import "../empty-link-inbox.test-utils.ts";
import { fixture, summer } from "./navigation-app.test-utils.tsx";

vi.mock("../mattermost/device-launch.ts", () => ({
  getDeviceLaunchContext: vi.fn(),
}));
vi.mock("../mattermost/native-rest.ts", () => ({
  openAccountRestConnection: vi.fn(),
}));
let nativeBack: (() => void) | undefined;
vi.mock("@tauri-apps/api/app", () => ({
  onBackButtonPress: vi.fn(async (pressed: () => void) => {
    nativeBack = pressed;
    return {
      unregister() {
        if (nativeBack === pressed) nativeBack = undefined;
      },
    };
  }),
}));

function back() {
  if (isAndroid) {
    expect(nativeBack).toBeTypeOf("function");
    act(() => nativeBack?.());
  } else fireEvent.keyDown(document.body, { key: "Escape" });
}

const dialog = () => screen.getByRole("dialog", { name: "Teams and servers" });
const teamTrigger = (team: string) =>
  screen.getByRole("button", { name: `Switch team, ${team}` });
const row = (team: string) =>
  within(dialog()).getByRole("button", { name: team });
const close = () =>
  within(dialog()).getByRole("button", { name: "Close team picker" });

test("direct Back, current team and the account menu close paths preserve the focused origin, live timeline and saved draft", async () => {
  const { account } = fixture();
  const field = await screen.findByRole<HTMLTextAreaElement>("textbox", {
    name: "Message #Home…",
  });
  const viewport = screen.getByRole("region", { name: "Channel messages" });
  viewport.scrollTop = 137;
  const trigger = teamTrigger("Winter");

  fireEvent.click(trigger);
  expect(
    within(dialog()).getByRole("heading", { name: "example.test" }),
  ).toBeTruthy();
  expect(document.activeElement).toBe(row("Winter"));
  back();
  expect(document.activeElement).toBe(trigger);

  fireEvent.click(trigger);
  expect(row("Winter").getAttribute("aria-current")).toBe("true");
  fireEvent.click(row("Winter"));
  expect(document.activeElement).toBe(trigger);

  const avatar = screen.getByRole("button", { name: "Account" });
  expect(avatar.textContent).toBe("");
  expect(avatar.getAttribute("aria-description")).toBe(
    "My profile · Loading profile",
  );
  fireEvent.click(avatar);
  const menu = screen.getByRole("dialog", { name: "example.test" });
  const action = within(menu).getByRole("button", {
    name: "Teams and servers",
  });
  fireEvent.click(action);
  back();
  expect(dialogOrNull()).toBeNull();
  expect(menu.isConnected).toBe(false);
  const resumed = screen.getByRole("dialog", { name: "example.test" });
  const choice = within(resumed).getByRole("button", {
    name: "Teams and servers",
  });
  expect(document.activeElement).toBe(choice);
  fireEvent.click(choice);
  fireEvent.click(close());
  expect(dialogOrNull()).toBeNull();
  expect(document.activeElement).toBe(avatar);
  expect(field.isConnected && field.value).toBe("Original unfinished draft");
  expect(viewport.isConnected && viewport.scrollTop).toBe(137);
  expect(account.selectJoinedTeam).not.toHaveBeenCalled();
});

const dialogOrNull = () =>
  screen.queryByRole("dialog", { name: "Teams and servers" });

test("a delayed team write blocks dismissal and duplicates, restores the failed row, and opens the saved channel on retry", async () => {
  const { account } = fixture();
  const field = await screen.findByRole<HTMLTextAreaElement>("textbox", {
    name: "Message #Home…",
  });
  let refuse!: (accepted: boolean) => void;
  account.selectJoinedTeam.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        refuse = resolve;
      }),
  );

  fireEvent.click(screen.getByRole("button", { name: "Account" }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Teams and servers",
    }),
  );
  const target = row("Summer");
  fireEvent.click(target);
  await within(dialog()).findByText("Saving the selection of “Summer”…");
  expect(close().hasAttribute("disabled")).toBe(true);
  expect(
    within(dialog())
      .getByRole("button", { name: "Back" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(row("Winter").getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(target);
  back();
  expect(dialog().isConnected).toBe(true);
  await waitFor(() =>
    expect(account.selectJoinedTeam).toHaveBeenCalledExactlyOnceWith(summer),
  );
  expect(field.isConnected && field.value).toBe("Original unfinished draft");

  await act(async () => refuse(false));
  expect(within(dialog()).getByRole("alert").textContent).toContain(
    "still in “Winter”",
  );
  expect(document.activeElement).toBe(target);
  fireEvent.click(target);
  await screen.findByRole("heading", { name: "Other" });
  expect(dialogOrNull()).toBeNull();
  expect(account.selectJoinedTeam).toHaveBeenCalledTimes(2);

  fireEvent.click(teamTrigger("Summer"));
  fireEvent.click(row("Winter"));
  expect(
    (
      await screen.findByRole<HTMLTextAreaElement>("textbox", {
        name: "Message #Home…",
      })
    ).value,
  ).toBe("Original unfinished draft");
  expect(account.selectSidebarChannel).not.toHaveBeenCalled();
});

test("the saved team choices open while the current team's channels are still loading", async () => {
  const { account } = fixture();
  account.readTeamSidebar.mockReturnValue(new Promise(() => {}));
  fireEvent.click(
    await screen.findByRole("button", { name: "Switch team, Winter" }),
  );
  expect(
    within(dialog())
      .getAllByRole("button")
      .slice(1)
      .map((button) => button.getAttribute("aria-label")),
  ).toEqual(["Summer", "Winter"]);
  fireEvent.click(close());
  expect(document.activeElement).toBe(teamTrigger("Winter"));
  expect(account.selectJoinedTeam).not.toHaveBeenCalled();
});
