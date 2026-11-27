import { waitFor } from "@testing-library/dom";
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
import { checkBrowserApp, waitForAppForeground } from "./browser-app.tsx";
import { fixtureStep } from "./fixture-step.ts";
import { checkDesktopBack } from "./workspace-back.tsx";

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

export async function checkBrowserAction(port: string, controlPort: string) {
  const server = `https://127.0.0.1:${port}/browser-action-check`;
  const unchanged = await fixtureStep("reject-unselected-browser-sign-in", () =>
    signInWithBrowser(server, "gitlab", () => {
      throw Error("a browser opened for an unselected installation");
    }).catch((error: unknown) => error),
  );
  if (!matches(unchanged, { kind: "selection_changed" })) {
    throw Error(
      "unselected browser action did not report the selection change",
    );
  }
  if (
    await fixtureStep("cancel-inactive-browser-sign-in", () =>
      cancelBrowserSignIn("00000000-0000-4000-8000-000000000000"),
    )
  ) {
    throw Error("inactive browser request was cancelled");
  }
  if (!navigator.userAgent.includes("Android")) {
    await fixtureStep("connect-desktop-installation", () =>
      connectInstallation(server),
    );
    // A failed run exits the disposable process. Do not defer its result
    // behind more account IPC against that process.
    await checkDesktopBack(controlPort);
    await fixtureStep("remove-desktop-account", () =>
      forgetLocalAccount(server, "f".repeat(26)),
    );
    await fixtureStep("remove-desktop-installation", () =>
      forgetInstallation(server),
    );
    return;
  }

  await connectInstallation(server);
  await waitForAppForeground();
  let googleId: string | undefined;
  const pending = signInWithBrowser(server, "google", (id) => {
    googleId = id;
  }).catch((error: unknown) => error);
  const opened = await waitFor(
    () => {
      if (!googleId || document.visibilityState !== "hidden")
        throw Error("The Google auth tab did not cover the application");
      return googleId;
    },
    { timeout: 5000 },
  );
  if (
    !(await cancelBrowserSignIn(opened)) ||
    !matches(await pending, { kind: "browser", cause: "cancelled" })
  ) {
    throw Error("browser action failed to cancel its own pending request");
  }
  await waitForAppForeground();
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
  await checkBrowserApp(server, controlPort);
  if ((await getCurrentAccountId(server)) !== null)
    throw Error("explicit device sign-out retained the account");
  await forgetInstallation(server);
}
