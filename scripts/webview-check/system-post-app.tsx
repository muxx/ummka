import { invoke } from "@tauri-apps/api/core";
import { waitFor, within } from "@testing-library/dom";
import { createRoot } from "react-dom/client";
import { App } from "../../src/App.tsx";
import {
  forgetInstallation,
  selectInstallation,
} from "../../src/mattermost/installation-registry.ts";
import {
  openAccountRestConnection,
  openNativeRestConnection,
} from "../../src/mattermost/native-rest.ts";
import { systemReply, systemRoot } from "./link-examples.ts";

const originalChannel = { channelId: "d".repeat(26) };
const draft = "Draft in the original installation";
export async function preserveSourceDraft(source: string, seed: boolean) {
  const account = await openAccountRestConnection(
    source,
    "Abc01234567890123456789012",
  );
  try {
    if (seed) {
      const result = await account.saveDraft({
        ...originalChannel,
        expectedRevision: null,
        message: draft,
      });
      if (result.kind !== "saved")
        throw Error("Could not seed the original installation's draft");
    } else if ((await account.readDraft(originalChannel)).message !== draft) {
      throw Error(
        "Opening system permalinks changed the original installation's draft",
      );
    }
  } finally {
    await account.close();
  }
}
export async function checkSystemPostApp(
  server: string,
  source: string,
  restore: string,
) {
  const host = document.createElement("div");
  host.id = "root";
  document.body.append(host);
  const root = createRoot(host);
  const seen: string[] = [];
  function diagnostic() {
    const expected = seen.length ? systemReply : systemRoot;
    const post = host.querySelector<HTMLElement>(
      `[data-post-id="${expected}"]`,
    );
    const active = document.activeElement;
    function bounds(element: Element | null | undefined) {
      if (!element) return "missing";
      const { x, y, width, height } = element.getBoundingClientRect();
      return [x, y, width, height].map(Math.round).join(",");
    }
    return Error(
      `system-post-flow expected=${seen.length === 0 ? "root" : "reply"} seen=${seen.length} focused=${active === post} active=${active?.tagName} workspace=${Boolean(host.querySelector(".workspace-window"))} pane=${host.querySelector<HTMLElement>(".channels-panes")?.dataset.page} notice=${Boolean(host.querySelector(".system-post-notice"))} page=${document.visibilityState} windowFocus=${document.hasFocus()} row=${bounds(post)} feed=${bounds(post?.closest(".timeline-scroll"))}`,
    );
  }
  function inspect() {
    if (document.visibilityState !== "visible" || !document.hasFocus()) return;
    const row = document.activeElement;
    if (!(row instanceof HTMLElement) || !host.contains(row)) return;
    const id = row.dataset.postId;
    const expected = seen.length === 0 ? systemRoot : systemReply;
    if (
      id !== expected ||
      Boolean(row.closest(".thread-feed")) !== (id === systemReply)
    )
      return;
    const box = row.getBoundingClientRect(),
      feed = row.closest(".timeline-scroll")?.getBoundingClientRect();
    if (
      feed?.height &&
      feed.width &&
      box.height &&
      box.width &&
      feed.right > box.left &&
      box.right > feed.left &&
      box.bottom > feed.top &&
      box.top < feed.bottom &&
      seen.at(-1) !== id
    )
      seen.push(id);
  }
  host.addEventListener("focusin", inspect);
  host.addEventListener("scroll", inspect, true);
  try {
    root.render(<App language="en" />);
    await waitFor(
      () => {
        inspect();
        if (seen.length !== 2)
          throw Error(
            "The two visible, focused system-link destinations did not arrive in order",
          );
      },
      { timeout: 40_000, interval: 25, onTimeout: diagnostic },
    );
    if (navigator.userAgent.includes("Android")) {
      const dialog = within(
        await within(host).findByRole("dialog", {}, { timeout: 10_000 }),
      );
      await dialog.findByRole("button", { name: "OK" });
      const head = await invoke<{ id: string } | null>("pending_channels_link");
      if (head?.id !== "3")
        throw Error("Denied system link was acknowledged before dismissal");
      const control = await openNativeRestConnection(server);
      try {
        const response = await control.fetchApi(
          `${control.basePath}/api/v4/system/ping?step=system-dialog-back`,
        );
        if (response.status !== 204)
          throw Error("System dialog Back did not reach the driver");
      } finally {
        await control.close();
      }
    }
    await waitFor(async () => {
      if (await invoke("pending_channels_link"))
        throw Error("The reply is still pending in the native queue");
    });
    await preserveSourceDraft(source, false);
    await selectInstallation(restore);
    await forgetInstallation(server);
    location.replace("/ipc-result.html?system-posts-shown");
  } finally {
    root.unmount();
    host.removeEventListener("focusin", inspect);
    host.removeEventListener("scroll", inspect, true);
    host.remove();
  }
}
