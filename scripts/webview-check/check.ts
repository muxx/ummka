import { invoke } from "@tauri-apps/api/core";
import { openNativeRestConnection } from "../../src/mattermost/native-rest.ts";
import { checkAppearance } from "./appearance.ts";
import { checkBrowserAction } from "./browser-action.ts";
import { checkEntryWindow } from "./entry-window.tsx";
import { beginExchanges, finishExchangesAfterReload } from "./exchanges.ts";
import { checkGeneratedRequests } from "./generated.ts";
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
  await checkEntryWindow();
  checkPaletteSurfaces();
  if (checkAppearance()) return;
  if (await resumeRegistryCheck()) return;
  if (await finishExchangesAfterReload()) {
    const ports = String(import.meta.env.VITE_UMMKA_CHECK_PORTS).split(",");
    await checkGeneratedRequests(ports);
    await checkBrowserAction(ports[0]);
    await seedRegistry();
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
