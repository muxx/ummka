import { invoke } from "@tauri-apps/api/core";
import { configure } from "@testing-library/dom";
import { openExternalPostLink } from "../../src/mattermost/external-post-link.ts";
import { openNativeRestConnection } from "../../src/mattermost/native-rest.ts";
import { findStandardEmoji } from "../../src/mattermost/standard-emoji.ts";
import { checkAppearance } from "./appearance.ts";
import { checkAttachmentWidth } from "./attachment-width.tsx";
import { checkBrowserAction } from "./browser-action.ts";
import { checkChannelTimeline } from "./channel-timeline.tsx";
import { checkChannelsFrame } from "./channels-frame.tsx";
import { checkClipboardPolicy } from "./clipboard-policy.ts";
import { checkEntryWindow } from "./entry-window.tsx";
import { beginExchanges, finishExchangesAfterReload } from "./exchanges.ts";
import { checkGeneratedRequests } from "./generated.ts";
import { checkNotificationSoundAssets } from "./notification-sounds.ts";
import { checkPaletteSurfaces } from "./palette.ts";

import { resumeRegistryCheck, seedRegistry } from "./registry.ts";

const fetch = window.fetch.bind(window);
let direct = 0;
let blocked = 0;
let androidBinary = 0;
window.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.startsWith("https://127.0.0.1:"))
    throw Error("unexpected-webview-network");
  const androidChannel = url.startsWith("http://ipc.localhost/");
  if (!androidChannel && !url.startsWith("ipc://localhost/"))
    return fetch(input, init);
  try {
    const response = await fetch(input, init);
    if (androidChannel) androidBinary++;
    else direct++;
    return response;
  } catch (error) {
    blocked++;
    throw error;
  }
};

function checkRoute(expected: number) {
  // Ordinary Android commands use Tauri's native postMessage bridge.
  const onAndroid = navigator.userAgent.includes("Android");
  if (blocked !== 0 || direct !== (onAndroid ? 0 : expected)) {
    throw Error("ipc-route");
  }
}

// WebKit reads autocorrect from the editor or its form, including for controls
// React mounts after startup. Configure the focused test field before typing.
document.addEventListener(
  "focus",
  (event) => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    )
      event.target.setAttribute("autocorrect", "off");
  },
  true,
);

// A native UI transition can cross IPC, SQLite and a cold WebView chunk.
// Keep the DOM assertion pending until the transition actually appears.
configure({ asyncUtilTimeout: 10_000 });

async function expectClosed(close: () => Promise<void>) {
  try {
    await close();
  } catch (error) {
    if (error === "unknown_connection") return;
    throw Error("unexpected-close-error");
  }
  throw Error("handle-still-open");
}

async function checkResources() {
  // WKWebView can execute the entry module before the bundled stylesheet has loaded.
  if (document.readyState !== "complete") {
    await new Promise<void>((resolve) =>
      window.addEventListener("load", () => resolve(), { once: true }),
    );
  }
  await checkNotificationSoundAssets();
  // A fresh offline process resumes the saved registry before the first-run UI probes.
  if (await resumeRegistryCheck()) return;
  await checkEntryWindow();
  checkPaletteSurfaces();
  if (checkAppearance()) return;
  if (await finishExchangesAfterReload()) {
    if (findStandardEmoji("thumbsup")?.glyph !== "👍")
      throw Error("standard-emoji-directory");
    await checkChannelsFrame();
    await checkChannelTimeline();
    await checkAttachmentWidth();
    const ports = String(import.meta.env.VITE_UMMKA_CHECK_PORTS).split(",");
    await checkClipboardPolicy(ports[1]);
    await checkGeneratedRequests(ports);
    const invalid = await openExternalPostLink("/relative").catch(
      (reason: unknown) => reason,
    );
    if (invalid !== "invalid_url")
      throw Error("External URL validation failed");
    const android = navigator.userAgent.includes("Android");
    if (android)
      await openExternalPostLink(
        "https://external.ummka.invalid/post/@bear?value=a%2Fb#anchor",
      );
    await checkBrowserAction(ports[0], ports[1]);
    if (android) {
      await openExternalPostLink("mailto:probe@ummka.invalid");
      const missing = await openExternalPostLink(
        "mailto:unhandled@ummka.invalid",
      ).catch((reason: unknown) => reason);
      if (missing !== "handler_unavailable")
        throw Error("Missing Android mail handler was not reported");
    }
    await seedRegistry();
    // LaunchServices activates the default browser. Finish work that needs the
    // fixture window and keyboard focus before handing it the foreground.
    const browserHref = import.meta.env.VITE_UMMKA_CHECK_EXTERNAL_HREF;
    if (!android && browserHref) await openExternalPostLink(browserHref);
    location.replace("/ipc-result.html?pass");
    return;
  }
  const old = sessionStorage.getItem("rest-connection");
  const server = "https://chat.example.test:8443/Team/";
  if (old === null) {
    const first = await openNativeRestConnection(server);
    const second = await openNativeRestConnection(
      "https://second.example.test",
    );
    if (first.rid === second.rid) throw Error("shared-handle");
    await first.close();
    await expectClosed(first.close);
    checkRoute(5);
    sessionStorage.setItem("rest-connection", String(second.rid));
    location.reload();
    return;
  }
  await expectClosed(() =>
    invoke("close_rest_connection", { rid: Number(old) }),
  );
  const next = await openNativeRestConnection(server);
  await next.close();
  checkRoute(4);
  sessionStorage.removeItem("rest-connection");
  await beginExchanges(() => {
    if (
      blocked !== 0 ||
      (navigator.userAgent.includes("Android") && androidBinary === 0)
    )
      throw Error("binary-ipc-route");
  });
}

checkResources().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  location.replace(`/ipc-result.html?fail=${encodeURIComponent(reason)}`);
});
