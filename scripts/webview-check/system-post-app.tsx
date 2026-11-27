import { invoke } from "@tauri-apps/api/core";
import { waitFor, within } from "@testing-library/dom";
import { createRoot } from "react-dom/client";
import { App } from "../../src/App.tsx";
import { isAndroid } from "../../src/build-platform.ts";
import {
  forgetInstallation,
  selectInstallation,
} from "../../src/mattermost/installation-registry.ts";
import {
  openAccountRestConnection,
  openNativeRestConnection,
} from "../../src/mattermost/native-rest.ts";
import {
  type SystemPostWindowMode,
  systemReply,
  systemRoot,
} from "./link-examples.ts";

const originalChannel = { channelId: "d".repeat(26) };
const draft = "Draft in the original installation";
type LinkWindowObservation = {
  number: number;
  active: boolean;
  hidden: boolean;
  minimized: boolean;
  visible: boolean;
  onscreen: boolean;
  key: boolean;
};
const observeWindow = (prepare: boolean) =>
  invoke<LinkWindowObservation>("check_system_post_window", { prepare });

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
  windowMode?: SystemPostWindowMode,
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
  function focusedTarget(id: string) {
    if (document.visibilityState !== "visible" || !document.hasFocus())
      return false;
    const row = document.activeElement;
    if (
      !(row instanceof HTMLElement) ||
      !host.contains(row) ||
      row.dataset.postId !== id ||
      Boolean(row.closest(".thread-feed")) !== (id === systemReply)
    )
      return false;
    const box = row.getBoundingClientRect(),
      feed = row.closest(".timeline-scroll")?.getBoundingClientRect();
    return (
      !!feed &&
      Math.min(feed.right, box.right, window.innerWidth) >
        Math.max(feed.left, box.left, 0) &&
      Math.min(feed.bottom, box.bottom, window.innerHeight) >
        Math.max(feed.top, box.top, 0)
    );
  }
  function inspect() {
    const expected = seen.length === 0 ? systemRoot : systemReply;
    if (seen.at(-1) !== expected && focusedTarget(expected))
      seen.push(expected);
  }
  host.addEventListener("focusin", inspect);
  host.addEventListener("scroll", inspect, true);
  try {
    root.render(<App language="en" />);
    let initialWindow: LinkWindowObservation | undefined;
    if (windowMode) {
      await preserveSourceDraft(source, false);
      await waitFor(
        async () => {
          if (
            (await invoke("pending_channels_link")) ||
            !focusedTarget(systemRoot)
          )
            throw diagnostic();
        },
        { timeout: 40_000, interval: 25, onTimeout: diagnostic },
      );
      inspect();
      initialWindow = await observeWindow(true);
    }
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
    if (!windowMode) {
      try {
        await checkPublishedLinks(host, server);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw Error(`system-post-flow published links: ${detail}`, {
          cause: error,
        });
      }
    }
    await preserveSourceDraft(source, false);
    if (initialWindow) {
      const finalWindow = await observeWindow(false);
      if (
        !focusedTarget(systemReply) ||
        finalWindow.number !== initialWindow.number ||
        !finalWindow.active ||
        finalWindow.hidden ||
        finalWindow.minimized ||
        !finalWindow.visible ||
        !finalWindow.onscreen ||
        !finalWindow.key
      )
        throw Error(
          `reply or window changed after arrival, AppKit=${JSON.stringify(finalWindow)}`,
        );
    }
    await selectInstallation(restore);
    await forgetInstallation(server);
    location.replace("/ipc-result.html?system-posts-shown");
  } catch (error) {
    if (!windowMode) throw error;
    const native = await observeWindow(false).catch((reason: unknown) =>
      String(reason),
    );
    const detail = error instanceof Error ? error.message : String(error);
    throw Error(
      `system-post-flow ${windowMode} ${detail} AppKit=${JSON.stringify(native)}`,
      {
        cause: error,
      },
    );
  } finally {
    root.unmount();
    host.removeEventListener("focusin", inspect);
    host.removeEventListener("scroll", inspect, true);
    host.remove();
  }
}

async function checkPublishedLinks(host: HTMLElement, server: string) {
  const page = within(host);
  const reply = host.querySelector<HTMLElement>(
    `[data-post-id="${systemReply}"]`,
  );
  const thread = reply?.closest(".thread-feed");
  if (!reply || !thread) throw Error("Missing the published source reply");
  const insideReply = within(reply);
  const threadOffset = thread.scrollTop;
  const opener = isAndroid
    ? insideReply.getByRole("button", { name: /^Open table:/ })
    : undefined;
  if (opener) {
    if (insideReply.queryByRole("link", { name: "Open published root" }))
      throw Error("The clipped table preview exposed a link");
    opener.click();
  } else {
    (
      await insideReply.findByRole("button", { name: "Show full message" })
    ).click();
    await insideReply.findByRole("button", { name: "Collapse message" });
  }
  let table = opener
    ? await page.findByRole("dialog", { name: "Table" })
    : reply;
  const body = within(table);
  async function nativeBack(screen: "notice" | "denied" | "table") {
    const control = await openNativeRestConnection(server);
    try {
      const result = await control.fetchApi(
        `${control.basePath}/api/v4/system/ping?step=published-link-${screen}-back`,
      );
      if (result.status !== 204)
        throw Error(`Published link Back did not close the ${screen}`);
    } finally {
      await control.close();
    }
  }
  const refusal = body.getByRole("link", { name: "Unsupported conversation" });
  const scroll = isAndroid
    ? body.getByRole("region", { name: "Table" })
    : thread;
  function checkRestored(link: HTMLElement, offset: number) {
    if (
      !table.isConnected ||
      scroll.scrollTop !== offset ||
      document.activeElement !== link
    ) {
      const viewport = scroll.getBoundingClientRect();
      const bounds = link.getBoundingClientRect();
      const active = document.activeElement;
      throw Error(
        `${link.textContent} was not restored: source=${table.isConnected} scroll=${scroll.scrollTop}/${offset} focus=${active === link} active=${active?.tagName}.${active?.className} linkY=${bounds.top}:${bounds.bottom} feedY=${viewport.top}:${viewport.bottom} inert=${Boolean(link.closest("[inert]"))}`,
      );
    }
  }
  refusal.scrollIntoView({ block: "center" });
  refusal.focus({ preventScroll: true });
  if (scroll.scrollTop <= 0)
    throw Error("The refusal link was not below the fold");
  const offset = scroll.scrollTop;
  refusal.click();
  await page.findByText("This type of link is not supported yet.");
  if (opener) {
    page.getByRole("dialog", { name: "Message link" });
    await nativeBack("notice");
  } else {
    page.getByRole("button", { name: "Don’t open this link" }).click();
  }
  await waitFor(() => checkRestored(refusal, offset), {
    onTimeout: (error) => error,
  });

  const denied = body.getByRole("link", { name: "Denied published message" });
  denied.scrollIntoView({ block: "center" });
  denied.focus({ preventScroll: true });
  const deniedOffset = scroll.scrollTop;
  denied.click();
  const acknowledge = await page.findByRole("button", { name: "OK" });
  if (opener) await nativeBack("denied");
  else acknowledge.click();
  await waitFor(() => checkRestored(denied, deniedOffset), {
    onTimeout: (error) => error,
  });
  if (opener) {
    await nativeBack("table");
    await waitFor(() => {
      if (
        table.isConnected ||
        !thread.isConnected ||
        thread.scrollTop !== threadOffset ||
        document.activeElement !== opener
      )
        throw Error("Back after a link refusal lost the original thread");
    });
    opener.click();
    table = await page.findByRole("dialog", { name: "Table" });
  }
  const rootLink = within(table).getByRole("link", {
    name: "Open published root",
  });
  rootLink.scrollIntoView({ block: "center" });
  rootLink.click();
  const channelRoot = () =>
    host.querySelector<HTMLElement>(
      `.channels-conversation [data-post-id="${systemRoot}"]`,
    );
  function shown(row: Element | null) {
    if (!row || document.activeElement !== row || !document.hasFocus())
      return false;
    const viewport = row.closest(".timeline-scroll")?.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    return (
      document.visibilityState === "visible" &&
      viewport?.width &&
      viewport.height &&
      box.width &&
      box.height &&
      viewport.right > box.left &&
      box.right > viewport.left &&
      viewport.bottom > box.top &&
      box.bottom > viewport.top
    );
  }
  await waitFor(
    () => {
      if (!shown(channelRoot()))
        throw Error(
          "The published table link did not focus its signed destination",
        );
      if (opener && table.isConnected)
        throw Error(
          "The table remained open after the linked destination was shown",
        );
    },
    {
      timeout: 10_000,
      onTimeout: (error) => {
        const active = document.activeElement;
        return Error(
          `${error.message} pane=${host.querySelector<HTMLElement>(".channels-panes")?.dataset.page} active=${active?.tagName}.${active?.className} row=${Boolean(channelRoot())} tabIndex=${channelRoot()?.tabIndex} table=${opener ? table.isConnected : "inline"} source=${rootLink.isConnected} status=${host.querySelector(".system-post-notice [role=status]")?.textContent}`,
        );
      },
    },
  );
  const destination = channelRoot();
  if (!destination)
    throw Error("The linked root was removed before activation");
  within(destination)
    .getByRole("link", { name: "Open published reply" })
    .click();
  await waitFor(
    () => {
      const returned = host.querySelector(`[data-post-id="${systemReply}"]`);
      if (!shown(returned) || !returned?.closest(".thread-feed"))
        throw Error("The published feed link did not reopen the signed reply");
    },
    { timeout: 10_000 },
  );
  if (await invoke("pending_channels_link"))
    throw Error("A published link entered the operating-system queue");
}
