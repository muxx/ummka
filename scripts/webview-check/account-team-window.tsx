import { fireEvent, waitFor, within } from "@testing-library/dom";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { App } from "../../src/App.tsx";
import {
  connectInstallation,
  forgetInstallation,
  readInstallationSelection,
  selectInstallation,
} from "../../src/mattermost/installation-registry.ts";
import {
  getCurrentAccountId,
  openAccountRestConnection,
} from "../../src/mattermost/native-rest.ts";

export function openChannelNavigation(element: HTMLElement, label: string) {
  const back = within(element).queryByRole("button", {
    name: label,
  });
  if (back) flushSync(() => fireEvent.click(back));
}

export async function checkSavedTeamWindow(serverUrl: string, userId: string) {
  const original = await readInstallationSelection();
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  // The macOS test host retains loopback while exercising the application's offline route.
  const previous = Object.getOwnPropertyDescriptor(navigator, "onLine");
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  try {
    await connectInstallation(serverUrl);
    if ((await getCurrentAccountId(serverUrl)) !== userId)
      throw Error("offline account changed");
    flushSync(() => root.render(<App language="ru" />));
    const ui = within(element);
    const saved = () =>
      ui.findByText("Saved fixture room message", {}, { timeout: 7000 });
    await saved();
    const field = await ui.findByRole<HTMLTextAreaElement>("textbox", {
      name: "Написать в #Town Square…",
    });
    if (
      field.value !== "  Черновик канала\n🐻‍❄️ " ||
      !ui.getByText("Черновик · без сети")
    )
      throw Error("offline startup lost the exact channel draft");
    const edited = field.value + " Ещё строка.";
    flushSync(() => fireEvent.input(field, { target: { value: edited } }));
    if (!ui.getByRole("heading", { name: "Town Square" }))
      throw Error("offline startup lost the selected room");
    flushSync(() =>
      fireEvent.click(ui.getByRole("button", { name: "Аккаунт" })),
    );
    const menu = await ui.findByRole("dialog");
    flushSync(() =>
      fireEvent.click(
        within(menu).getByRole("button", { name: "Закрыть меню аккаунта" }),
      ),
    );
    if (document.activeElement !== ui.getByRole("button", { name: "Аккаунт" }))
      throw Error("offline account menu lost its trigger");
    openChannelNavigation(element, "Каналы");
    const switcher = ui.getByRole("button", {
      name: "Сменить команду, Fixture Team",
    });
    flushSync(() => fireEvent.click(switcher));
    const pick = await ui.findByRole<HTMLButtonElement>("button", {
      name: "Fixture Team",
      current: true,
    });
    if (document.activeElement !== pick)
      throw Error("returning to the picker lost the current team focus");
    if (
      pick.getBoundingClientRect().height < 44 ||
      pick.getBoundingClientRect().right > innerWidth
    )
      throw Error("team selection does not fit its target window");
    flushSync(() => fireEvent.click(pick));
    await saved();
    const restored = await ui.findByRole<HTMLTextAreaElement>("textbox", {
      name: "Написать в #Town Square…",
    });
    if (restored.value !== edited)
      throw Error("returning to the team lost in-progress offline text");
    flushSync(() =>
      fireEvent.input(restored, {
        target: { value: "  Черновик канала\n🐻‍❄️ " },
      }),
    );
    fireEvent.focusOut(restored);
    const observer = await openAccountRestConnection(serverUrl, userId);
    try {
      await waitFor(async () => {
        const stored = await observer.readDraft({ channelId: "c".repeat(26) });
        if (stored.message !== restored.value)
          throw Error("the offline edit was not saved");
      });
    } finally {
      await observer.close();
    }
  } finally {
    flushSync(() => root.unmount());
    element.remove();
    if (previous) Object.defineProperty(navigator, "onLine", previous);
    else Reflect.deleteProperty(navigator, "onLine");
    if (!original.installations.includes(serverUrl))
      await forgetInstallation(serverUrl);
    if (original.selected && original.selected !== serverUrl)
      await selectInstallation(original.selected);
  }
}
