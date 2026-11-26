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

export async function checkSavedTeamWindow(
  serverUrl: string,
  userId: string,
  removeOutgoing: boolean,
) {
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
    const outgoingText = "Исходящее после перезапуска";
    const outgoing = (await ui.findByText(outgoingText)).closest("article");
    if (!outgoing?.textContent?.includes("Доставка не подтверждена"))
      throw Error(
        "Offline startup lost the saved outgoing row or suggested an active send",
      );
    const repeat = within(outgoing).getByRole("button", {
      name: "Отправить ещё раз",
    });
    fireEvent.click(repeat);
    if (
      repeat.getAttribute("aria-disabled") !== "true" ||
      within(outgoing).queryByText("Всё равно отправить")
    )
      throw Error("Offline outgoing retry opened its confirmation");
    const field = await ui.findByRole<HTMLTextAreaElement>("textbox", {
      name: "Написать в #Town Square…",
    });
    if (
      field.value !== "  Черновик канала\n🐻‍❄️ " ||
      !ui.getByText("Черновик · без сети")
    )
      throw Error("offline startup lost the exact channel draft");
    if (
      !ui.getByRole<HTMLButtonElement>("button", {
        name: "Отправить сообщение",
      }).disabled
    )
      throw Error("An offline draft offered sending");
    const edited = field.value + " Ещё строка.";
    flushSync(() => fireEvent.input(field, { target: { value: edited } }));
    if (import.meta.env.UMMKA_MACOS_OVERLAY && !removeOutgoing) {
      const post = (await saved()).closest("article");
      if (!post) throw Error("The saved post is outside its timeline row");
      const opener = within(post).getByRole("button", { name: "Открыть тред" });
      opener.focus();
      flushSync(() => fireEvent.click(opener));
      const thread = await ui.findByRole("complementary", {
        name: "Обсуждение",
      });
      await within(thread).findByText("Saved fixture room message");
      const conversation = ui.getByRole("main", { name: "Town Square" });
      const channelBox = conversation.getBoundingClientRect();
      const threadBox = thread.getBoundingClientRect();
      if (
        !channelBox.width ||
        threadBox.width < 300 ||
        threadBox.left < channelBox.right - 1 ||
        threadBox.right > innerWidth + 1
      )
        throw Error(
          "The desktop thread panel overlaps or displaces the channel",
        );
      flushSync(() =>
        fireEvent.click(
          within(thread).getByRole("button", { name: "Закрыть тред" }),
        ),
      );
      if (
        thread.isConnected ||
        document.activeElement !== opener ||
        ui.getByRole("textbox", { name: "Написать в #Town Square…" }) !==
          field ||
        field.value !== edited
      )
        throw Error(
          "Closing the desktop thread lost the saved channel row or its draft",
        );
    }
    if (typeof navigator.clipboard?.writeText !== "function")
      throw Error("The packaged WebView cannot copy text");
    if (removeOutgoing) {
      const current = ui.getByText(outgoingText).closest("article");
      if (!current) throw Error("The saved outgoing row is missing");
      const remove = within(current).getByRole<HTMLButtonElement>("button", {
        name: "Удалить",
      });
      remove.focus();
      flushSync(() => fireEvent.click(remove));
      await waitFor(
        () => {
          ui.getByText("Строка удалена только с устройства.");
          if (ui.queryByText(outgoingText))
            throw Error("Removed outgoing row is still visible");
          if (
            document.activeElement !==
              ui.getByRole("region", { name: "Сообщения канала" }) ||
            field.value !== edited
          )
            throw Error(
              "Removing a local post lost the conversation focus or draft",
            );
        },
        { container: element, timeout: 7000 },
      );
    }
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
      const pending = await observer.readPendingPosts({
        channelId: "c".repeat(26),
        limit: 50,
      });
      const remains = pending.some(
        (post) => post.pendingId === outgoing.dataset.postId,
      );
      if (remains === removeOutgoing)
        throw Error(
          "The saved outgoing row does not match the choice in the window",
        );
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
