import { getCurrentWindow } from "@tauri-apps/api/window";
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
import { openAccountRestConnection } from "../../src/mattermost/native-rest.ts";
import { openThreadFromMessageMenu } from "./published-post-actions.ts";
import { withVisibleTestWindow } from "./visible-window.ts";

export async function checkOpenChannelEvents(
  base: string,
  observe: (step: string, name: string) => Promise<void>,
) {
  const control = (step: string) => observe(`event-window-${step}`, "");
  const previous = await readInstallationSelection();
  await connectInstallation(base);
  try {
    await withVisibleTestWindow(async () => {
      for (const mode of ["begin", "flat"]) {
        await control(mode);
        const host = document.createElement("div");
        host.style.cssText =
          "position:fixed;inset:0;background:white;z-index:10000";
        document.body.append(host);
        const root = createRoot(host),
          room = within(host);
        const options = { container: host, timeout: 5000, interval: 15 };
        const item = (id: string) =>
          host.querySelector<HTMLElement>(
            `.channels-conversation .timeline-scroll [data-post-id='${id.repeat(26)}']`,
          );
        const expectEdit = (step: string) =>
          waitFor(() => {
            if (
              !item("a")?.textContent?.includes(`First event message (${step})`)
            )
              throw Error("The edit did not reach the open channel");
          }, options);
        function openThread(row: HTMLElement) {
          const message = within(row);
          if (import.meta.env.UMMKA_PLATFORM === "android") {
            openThreadFromMessageMenu(
              message.getByRole("button", {
                name: /^Message actions(?: · .+)?$/,
              }),
            );
          } else {
            fireEvent.click(
              message.getByRole("button", { name: /Open thread/ }),
            );
          }
        }
        try {
          flushSync(() => root.render(<App language="en" />));
          const draft = await room.findByRole<HTMLTextAreaElement>(
            "textbox",
            { name: "Message #Live room…" },
            options,
          );
          await control("ready");
          if (item("a") || item("z"))
            throw Error("Event fixture should start with an empty channel.");
          fireEvent.input(draft, {
            target: { value: "Keep this channel draft" },
          });
          await control("first");
          await control("during");
          await waitFor(() => {
            if (
              item("a")?.textContent?.includes("First event message") !==
                true ||
              item("z")?.textContent?.includes("Second event message") !== true
            )
              throw Error("Both events did not appear");
          }, options);
          await control("counts");
          if (mode === "begin") {
            const original = Object.getOwnPropertyDescriptor(
              navigator,
              "onLine",
            );
            function online(value: boolean) {
              Object.defineProperty(navigator, "onLine", {
                configurable: true,
                value,
              });
              window.dispatchEvent(new Event(value ? "online" : "offline"));
            }
            try {
              online(false);
              await control("paused");
              await control("offline-edit");
              if (item("a")?.textContent?.includes("offline-edit"))
                throw Error("An offline view showed the unreceived edit");
              online(true);
              await expectEdit("offline-edit");
              await control("resumed-edit");
            } finally {
              if (original)
                Object.defineProperty(navigator, "onLine", original);
              else Reflect.deleteProperty(navigator, "onLine");
            }
            if (import.meta.env.UMMKA_PLATFORM === "darwin") {
              const window = getCurrentWindow();
              await window.hide();
              try {
                await waitFor(() => {
                  if (document.visibilityState !== "hidden")
                    throw Error("The native window did not become hidden");
                }, options);
                await control("paused");
                await control("hidden-edit");
              } finally {
                await window.show();
              }
              await expectEdit("hidden-edit");
              await control("resumed-edit");
            }
          }
          if (draft.value !== "Keep this channel draft")
            throw Error("The live update replaced the channel draft");
          const first = item("a");
          if (!first) throw Error("Published root missing");
          openThread(first);
          const pane = await room.findByRole(
              "complementary",
              { name: "Thread" },
              options,
            ),
            thread = within(pane);
          const reply = await thread.findByRole<HTMLTextAreaElement>(
            "textbox",
            { name: "Reply in thread…" },
            options,
          );
          fireEvent.input(reply, {
            target: { value: "Keep this thread draft" },
          });
          await control("reply");
          await thread.findByText("Live event reply", {}, options);
          await control("edit");
          await thread.findByText("Edited event reply", {}, options);
          if (reply.value !== "Keep this thread draft")
            throw Error("The live edit replaced the thread draft");
          fireEvent.click(thread.getByRole("button", { name: "Close thread" }));
          await waitFor(() => {
            if (
              mode === "flat" &&
              !item("q")?.textContent?.includes("Edited event reply")
            )
              throw Error("Flat timeline did not show the edited reply");
            if (
              mode === "begin" &&
              (item("q") ||
                !within(first).queryByRole("button", { name: /1 reply/ }))
            )
              throw Error("CRT did not update its root summary");
          }, options);
          openThread(first);
          const reopened = within(
            await room.findByRole("complementary", { name: "Thread" }, options),
          );
          const restored = await reopened.findByRole<HTMLTextAreaElement>(
            "textbox",
            { name: "Reply in thread…" },
            options,
          );
          await waitFor(() => {
            if (restored.value !== "Keep this thread draft")
              throw Error("Returning to the thread lost the draft");
          }, options);
          await reopened.findByText("Edited event reply", {}, options);
          if (mode === "begin") {
            await control("delete-reply");
            await waitFor(() => {
              if (reopened.queryByText("Edited event reply"))
                throw Error("Deleted reply still visible");
            }, options);
          }
          const channelId = "c".repeat(26);
          const saved = await openAccountRestConnection(base, "b".repeat(26));
          try {
            if (
              mode === "flat" &&
              (await saved.readSavedPost(channelId, "q".repeat(26)))?.rootId !==
                "a".repeat(26)
            )
              throw Error("The flat reply was never saved in SQLite");
            await control("delete-root");
            await reopened.findByText(
              "This thread is no longer available.",
              {},
              options,
            );
            if (
              reopened.queryByRole("textbox", { name: "Reply in thread…" }) ||
              reopened.queryByText("Edited event reply")
            )
              throw Error("Deleted thread content is still visible");
            if (
              (await saved.readSavedPost(channelId, "a".repeat(26))) ||
              (await saved.readSavedPost(channelId, "q".repeat(26)))
            )
              throw Error("SQLite kept the deleted root or its reply");
            const close = reopened.getByRole("button", {
              name: "Close thread",
            });
            flushSync(() => fireEvent.click(close));
            if (mode === "flat")
              await new Promise<void>((resolve, reject) => {
                requestAnimationFrame(() => {
                  const pane = host.querySelector<HTMLElement>(
                    ".channels-conversation .timeline-scroll",
                  );
                  if (!pane?.clientHeight)
                    reject(Error("The channel did not return"));
                  else if (item("q") || item("a"))
                    reject(
                      Error(
                        `The first visible flat frame kept deleted content (root=${Boolean(item("a"))}, reply=${Boolean(item("q"))})`,
                      ),
                    );
                  else resolve();
                });
              });
          } finally {
            await saved.close();
          }
          await control("delete-second");
          await waitFor(() => {
            if (item("a") || item("z"))
              throw Error("Deleted roots still visible");
          }, options);
          if (mode === "flat") {
            await control("history");
            const row = (n: number) =>
              host.querySelector<HTMLElement>(
                `.channels-conversation [data-post-id="h${n.toString(36).padStart(25, "0")}"]`,
              );
            const pane = host.querySelector<HTMLElement>(
              ".channels-conversation .timeline-scroll",
            );
            if (!pane) throw Error("Missing open channel timeline");
            await waitFor(() => {
              if (!row(32) || !row(16))
                throw Error("The signed latest page did not reach the channel");
            }, options);
            const offset = () => {
              const anchor = row(16);
              if (!anchor) throw Error("Lost the visible reading anchor");
              return (
                anchor.getBoundingClientRect().top -
                pane.getBoundingClientRect().top
              );
            };
            pane.scrollTop += offset() + 3;
            pane.focus();
            const initial = offset();
            if (
              Math.abs(initial + 3) > 1 ||
              pane.scrollHeight - pane.clientHeight - pane.scrollTop < 20
            )
              throw Error("Could not establish an older reading position");
            await control("history-edit");
            await waitFor(() => {
              if (!row(15)?.textContent?.includes("Expanded older passage"))
                throw Error(
                  "Signed edit to the previous message was not rendered",
                );
            }, options);
            if (
              Math.abs(offset() - initial) > 1 ||
              document.activeElement !== pane
            )
              throw Error(
                "The signed edit displaced the older reading position or keyboard focus",
              );
            await control("navigate-begin");
            if (import.meta.env.UMMKA_PLATFORM === "android")
              fireEvent.click(room.getByRole("button", { name: "Channels" }));
            fireEvent.click(
              await room.findByRole("button", { name: "Other room" }, options),
            );
            await room.findByText("Independent channel position", {}, options);
            await control("navigate-cancelled");
            if (item("x"))
              throw Error("The old HTTP page reached the selected channel");
            if (import.meta.env.UMMKA_PLATFORM === "android")
              fireEvent.click(room.getByRole("button", { name: "Channels" }));
            fireEvent.click(
              await room.findByRole("button", { name: "Live room" }, options),
            );
            await waitFor(() => {
              if (!row(32) || item("a") || item("q"))
                throw Error(
                  "Reopening the channel restored the deleted thread",
                );
            }, options);
          }
          await control("complete");
        } finally {
          flushSync(() => root.unmount());
          host.remove();
          await control("end");
        }
      }
    });
  } finally {
    await forgetInstallation(base);
    if (previous.selected) await selectInstallation(previous.selected);
  }
}
