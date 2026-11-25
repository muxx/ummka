import { fireEvent, within } from "@testing-library/dom";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { AccountTeamWindow } from "../../src/entry/AccountTeamWindow.tsx";

export async function checkSavedTeamWindow(serverUrl: string, userId: string) {
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  // The macOS test host can still reach its loopback fixture while testing offline restoration.
  const previous = Object.getOwnPropertyDescriptor(navigator, "onLine");
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  try {
    flushSync(() =>
      root.render(
        <AccountTeamWindow
          language="ru"
          serverUrl={serverUrl}
          userId={userId}
          onSessionEnded={() => {
            throw Error("offline account unexpectedly ended");
          }}
        >
          {({ team, chooseAnotherTeam }) => (
            <button type="button" onClick={chooseAnotherTeam}>
              {team.displayName}
            </button>
          )}
        </AccountTeamWindow>,
      ),
    );
    const ui = within(element);
    const workspace = await ui.findByRole(
      "button",
      { name: "Fixture Team" },
      { timeout: 5000 },
    );
    flushSync(() => fireEvent.click(workspace));
    const pick = ui.getByRole<HTMLButtonElement>("button", {
      name: "Fixture Team",
      description: "/fixture",
    });
    if (
      document.activeElement !== pick ||
      pick.getAttribute("aria-current") !== "true"
    ) {
      throw Error("returning to the picker did not focus the current team");
    }
    if (
      pick.getBoundingClientRect().height < 44 ||
      pick.getBoundingClientRect().right > innerWidth
    ) {
      throw Error("team selection does not fit its target window");
    }
    flushSync(() => fireEvent.click(pick));
    await ui.findByRole("button", { name: "Fixture Team" }, { timeout: 5000 });
  } finally {
    flushSync(() => root.unmount());
    element.remove();
    if (previous) Object.defineProperty(navigator, "onLine", previous);
    else Reflect.deleteProperty(navigator, "onLine");
  }
}
