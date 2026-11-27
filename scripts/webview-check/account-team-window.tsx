import { fireEvent, waitFor, within } from "@testing-library/dom";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { App } from "../../src/App.tsx";
import { usesMacOSOverlay } from "../../src/build-platform.ts";
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
import { readRestoredOutgoing } from "./composer-drafts.ts";
import { checkRowPermalink } from "./published-post-actions.ts";

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
  const observer = await openAccountRestConnection(serverUrl, userId);
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  // The macOS test host retains loopback while exercising the application's offline route.
  const previous = Object.getOwnPropertyDescriptor(navigator, "onLine");
  const macOS = usesMacOSOverlay;
  if (macOS)
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
  try {
    if (navigator.onLine)
      throw Error("The offline system WebView reported an active network");
    await connectInstallation(serverUrl);
    if ((await getCurrentAccountId(serverUrl)) !== userId)
      throw Error("offline account changed");
    flushSync(() => root.render(<App language="ru" />));
    const ui = within(element);
    const nativeWait = { container: element, timeout: 7000 };
    const saved = () =>
      ui.findByText("Saved fixture room message", {}, nativeWait);
    const originalDraft = "  Черновик канала\n🐻‍❄️ ";
    const restoredDraft = (expected: string) =>
      waitFor(() => {
        const field = ui.getByRole<HTMLTextAreaElement>("textbox", {
          name: "Написать в #Town Square…",
        });
        if (field.value !== expected)
          throw Error(
            "The restored channel draft does not contain the saved text",
          );
        return field;
      }, nativeWait);
    const stored = await readRestoredOutgoing(observer);
    const [, outgoing] = await Promise.all([
      saved(),
      waitFor(() => {
        const row = ui.queryByText(stored.message)?.closest("article");
        if (!row || row.dataset.postId !== stored.pendingId)
          throw Error(
            "The restored post is in SQLite but its row is missing from the offline timeline",
          );
        return row;
      }, nativeWait),
    ]);
    if (!outgoing.textContent?.includes("Доставка не подтверждена"))
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
    const field = await restoredDraft(originalDraft);
    ui.getByText("Черновик · без сети");
    const searchTrigger = ui.getByRole("button", { name: "Поиск" });
    searchTrigger.focus();
    flushSync(() => fireEvent.click(searchTrigger));
    const search = within(
      await ui.findByRole("dialog", { name: "Что вы ищете?" }, nativeWait),
    );
    const terms = search.getByRole<HTMLInputElement>("searchbox");
    if (document.activeElement !== terms || search.queryByText("Файлы"))
      throw Error(
        "Restored search lost focus or ignored the saved file policy",
      );
    const savedTerm = "from:fixture Привет";
    const recent = await search.findByRole(
      "button",
      { name: savedTerm },
      nativeWait,
    );
    flushSync(() => fireEvent.keyDown(terms, { key: "ArrowDown" }));
    if (document.activeElement !== recent)
      throw Error("The search field did not focus the saved team query");
    flushSync(() => fireEvent.click(recent));
    // Selecting a recent term writes its new position to SQLite before reporting offline.
    await waitFor(() => {
      if (terms.readOnly)
        throw Error("The selected recent query is still being saved");
      if (search.getByRole("alert").textContent !== "Нет соединения.")
        throw Error("The saved recent query did not report the offline result");
      if (terms.value !== savedTerm || document.activeElement !== terms)
        throw Error(
          "The offline recent query did not leave the search text ready to edit",
        );
    }, nativeWait);
    flushSync(() =>
      fireEvent.click(search.getByRole("button", { name: "Закрыть поиск" })),
    );
    if (
      document.activeElement !== searchTrigger ||
      field.value !== originalDraft
    )
      throw Error(
        "Closing offline search lost the header focus or channel draft",
      );
    if (
      !ui.getByRole<HTMLButtonElement>("button", {
        name: "Отправить сообщение",
      }).disabled
    )
      throw Error("An offline draft offered sending");
    const edited = field.value + " Ещё строка.";
    flushSync(() => fireEvent.input(field, { target: { value: edited } }));
    if (usesMacOSOverlay && !removeOutgoing) {
      const post = (await saved()).closest("article");
      if (!post) throw Error("The saved post is outside its timeline row");
      await checkRowPermalink(
        post,
        `${serverUrl}/fixture/pl/${"v".repeat(26)}`,
        false,
        "ru",
      );
      const opener = within(post).getByRole("button", { name: "Открыть тред" });
      opener.focus();
      flushSync(() => fireEvent.click(opener));
      const thread = await ui.findByRole("complementary", {
        name: "Обсуждение",
      });
      await within(thread).findByText(
        "Saved fixture room message",
        {},
        nativeWait,
      );
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
      const current = ui.getByText(stored.message).closest("article");
      if (!current) throw Error("The saved outgoing row is missing");
      const remove = within(current).getByRole<HTMLButtonElement>("button", {
        name: "Удалить",
      });
      remove.focus();
      flushSync(() => fireEvent.click(remove));
      await waitFor(() => {
        ui.getByText("Строка удалена только с устройства.");
        if (ui.queryByText(stored.message))
          throw Error("Removed outgoing row is still visible");
        if (
          document.activeElement !==
            ui.getByRole("region", { name: "Сообщения канала" }) ||
          field.value !== edited
        )
          throw Error(
            "Removing a local post lost the conversation focus or draft",
          );
      }, nativeWait);
    }
    if (!ui.getByRole("heading", { name: "Town Square" }))
      throw Error("offline startup lost the selected room");
    flushSync(() =>
      fireEvent.click(ui.getByRole("button", { name: "Аккаунт" })),
    );
    const menu = ui.getByRole("dialog");
    within(menu).getByText(serverUrl.replace(/^https?:\/\//u, ""), {
      exact: true,
    });
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
    if (document.activeElement !== switcher || !field.isConnected)
      throw Error(
        "Closing the current team lost its button or detached the channel",
      );
    if (!field.getClientRects().length) {
      flushSync(() =>
        fireEvent.click(
          ui.getByRole("button", { name: /^Town Square\b/u, current: "page" }),
        ),
      );
    }
    await saved();
    const restored = await restoredDraft(edited);
    flushSync(() =>
      fireEvent.input(restored, { target: { value: originalDraft } }),
    );
    fireEvent.focusOut(restored);
    const pending = await observer.readPendingPosts({
      channelId: "c".repeat(26),
      limit: 50,
    });
    const remains = pending.some((post) => post.pendingId === stored.pendingId);
    if (remains === removeOutgoing)
      throw Error(
        "The saved outgoing row does not match the choice in the window",
      );
    await waitFor(async () => {
      const draft = await observer.readDraft({ channelId: "c".repeat(26) });
      if (draft.message !== originalDraft)
        throw Error("the offline edit was not saved");
    }, nativeWait);
  } finally {
    flushSync(() => root.unmount());
    element.remove();
    await observer.close();
    if (macOS) {
      if (previous) Object.defineProperty(navigator, "onLine", previous);
      else Reflect.deleteProperty(navigator, "onLine");
    }
    if (!original.installations.includes(serverUrl))
      await forgetInstallation(serverUrl);
    if (original.selected && original.selected !== serverUrl)
      await selectInstallation(original.selected);
  }
}
