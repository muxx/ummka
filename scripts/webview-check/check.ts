import { invoke } from "@tauri-apps/api/core";
import { openNativeRestConnection } from "../../src/mattermost/native-rest.ts";

const fetch = window.fetch.bind(window);
let direct = 0;
let blocked = 0;
window.fetch = async (input, init) => {
  if (!String(input).startsWith("ipc://localhost/")) return fetch(input, init);
  try {
    const response = await fetch(input, init);
    direct++;
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
    checkRoute(4);
    sessionStorage.setItem("rest-connection", String(second.rid));
    location.reload();
    return;
  }
  await expectClosed(() =>
    invoke("close_rest_connection", { rid: Number(old) }),
  );
  const next = await openNativeRestConnection(server);
  await next.close();
  checkRoute(3);
  sessionStorage.removeItem("rest-connection");
  location.replace("/ipc-result.html?pass");
}

checkResources().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  location.replace(`/ipc-result.html?fail=${encodeURIComponent(reason)}`);
});
