import { waitFor } from "@testing-library/dom";
import { isAndroid } from "../../src/build-platform.ts";
import {
  observeClipboardAllowed,
  readClipboardAllowed,
} from "../../src/device/clipboard-policy.ts";
import { openNativeRestConnection } from "../../src/mattermost/native-rest.ts";

export async function checkClipboardPolicy(controlPort: string) {
  let current: boolean | undefined;
  let updates = 0;
  const stop = observeClipboardAllowed((allowed) => {
    current = allowed;
    updates++;
  });
  try {
    if (updates !== 1 || current !== !isAndroid)
      throw Error(
        "Unexpected clipboard permission before Android subscription",
      );
    await waitFor(() => {
      if (!current) throw Error("Missing initial clipboard permission");
    });
    if (!(await readClipboardAllowed()))
      throw Error("Clipboard restricted before device policy");
    if (!isAndroid) return;

    let retiredUpdates = 0;
    const retire = observeClipboardAllowed(() => {
      retiredUpdates++;
    });
    try {
      await waitFor(() => {
        if (retiredUpdates !== 2)
          throw Error("The second clipboard subscriber did not initialize");
      });
    } finally {
      retire();
    }
    const control = await openNativeRestConnection(
      `https://127.0.0.1:${controlPort}`,
    );
    try {
      for (const [step, allowed] of [
        ["true", false],
        ["resume", false],
        ["false", true],
        ["malformed", false],
        ["boolean", false],
        ["unset", true],
      ] as const) {
        const previous = updates;
        const response = await control.fetchApi(
          `${control.basePath}/api/v4/system/ping?step=copy-${step}`,
        );
        if (response.status !== 204)
          throw Error(
            `Android did not complete the clipboard test step ${step}`,
          );
        await waitFor(
          () => {
            if (
              updates === previous ||
              current !== allowed ||
              document.visibilityState !== "visible"
            )
              throw Error(
                `Missing foreground clipboard policy update for ${step}`,
              );
          },
          { timeout: 5000 },
        );
        if ((await readClipboardAllowed()) !== allowed)
          throw Error(`Wrong Android clipboard policy for ${step}`);
        if (retiredUpdates !== 2)
          throw Error("A retired clipboard subscriber received an update");
      }
    } finally {
      await control.close();
    }
  } finally {
    stop();
  }
}
