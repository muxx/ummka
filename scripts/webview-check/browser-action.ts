import {
  cancelBrowserSignIn,
  signInWithBrowser,
} from "../../src/mattermost/browser-sign-in.ts";
import {
  connectInstallation,
  forgetInstallation,
} from "../../src/mattermost/installation-registry.ts";
import {
  forgetLocalAccount,
  getCurrentAccountId,
} from "../../src/mattermost/native-rest.ts";
import { checkBrowserApp } from "./browser-app.tsx";

function matches(actual: unknown, fields: Record<string, string>) {
  if (actual === null || typeof actual !== "object") return false;
  const entries = Object.entries(actual);
  return (
    entries.length === Object.keys(fields).length &&
    entries.every(
      ([key, value]) => Object.hasOwn(fields, key) && fields[key] === value,
    )
  );
}

export async function checkBrowserAction(port: string) {
  const server = `https://127.0.0.1:${port}/browser-action-check`;
  const unchanged = await signInWithBrowser(server, "gitlab", () => {
    throw Error("a browser opened for an unselected installation");
  }).catch((error: unknown) => error);
  if (!matches(unchanged, { kind: "selection_changed" })) {
    throw Error(
      "unselected browser action did not report the selection change",
    );
  }
  if (await cancelBrowserSignIn("00000000-0000-4000-8000-000000000000")) {
    throw Error("inactive browser request was cancelled");
  }
  if (!navigator.userAgent.includes("Android")) return;

  await connectInstallation(server);
  let cancelled: Promise<boolean> | undefined;
  const result = await signInWithBrowser(server, "google", (id) => {
    cancelled = cancelBrowserSignIn(id);
  }).catch((error: unknown) => error);
  if (
    !(await cancelled) ||
    !matches(result, { kind: "browser", cause: "cancelled" })
  ) {
    throw Error("browser action failed to cancel its own pending request");
  }
  let requestId: string | undefined;
  const user = await signInWithBrowser(server, "gitlab", (id) => {
    requestId = id;
  });
  if (
    user !== "f".repeat(26) ||
    user !== (await getCurrentAccountId(server)) ||
    !requestId ||
    (await cancelBrowserSignIn(requestId))
  ) {
    throw Error("browser account was not restored after system sign-in");
  }
  await forgetLocalAccount(server, user);
  await forgetInstallation(server);
  await checkBrowserApp(server);
  if ((await getCurrentAccountId(server)) !== null)
    throw Error("explicit device sign-out retained the account");
  await forgetInstallation(server);
}
