import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

type Adb = (...args: string[]) => Promise<string>;
const documents = /package="[^"]*\.documentsui"/iu;

function nodeCenter(xml: string, matches: (node: string) => boolean) {
  for (const node of xml.match(/<node\b[^>]*>/gu) ?? []) {
    if (!matches(node)) continue;
    const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/u.exec(node);
    if (bounds) {
      const [left, top, right, bottom] = bounds.slice(1).map(Number) as [
        number,
        number,
        number,
        number,
      ];
      return [
        String(Math.floor((left + right) / 2)),
        String(Math.floor((top + bottom) / 2)),
      ];
    }
  }
  return null;
}

export async function checkDocumentPicker(
  adb: Adb,
  component: string,
  pid: string,
) {
  const signal = (action: string) =>
    adb(
      "shell",
      "am",
      "broadcast",
      "-n",
      `${component}DocumentPickerSignal`,
      "-a",
      `ummka.fixture.DOCUMENTS_${action}`,
    );
  const ui = () => adb("exec-out", "uiautomator", "dump", "/dev/tty");
  async function waitStage(stage: string) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const output = await adb(
        "logcat",
        "-d",
        `--pid=${pid}`,
        "-s",
        "RustStdoutStderr:I",
        "AndroidRuntime:E",
      );
      assert.doesNotMatch(output, /UMMKA_PICKER_STAGE failed|FATAL EXCEPTION/u);
      if (
        output
          .split(/\r?\n/u)
          .some((line) => line.endsWith(`UMMKA_PICKER_STAGE ${stage}`))
      )
        return;
      await delay(100);
    }
    throw Error(`Missing document chooser stage ${stage}`);
  }
  async function waitUi(match: (xml: string) => boolean, label: string) {
    const deadline = Date.now() + 16_000;
    while (Date.now() < deadline) {
      const xml = await ui();
      if (match(xml)) return xml;
      await delay(100);
    }
    throw Error(`Android document chooser did not show ${label}`);
  }
  async function tapNode(
    match: (node: string) => boolean,
    label: string,
    hold = false,
  ) {
    const xml = await waitUi(
      (x) => documents.test(x) && !!nodeCenter(x, match),
      label,
    );
    const at = nodeCenter(xml, match);
    assert(at);
    if (hold) await adb("shell", "input", "swipe", ...at, ...at, "750");
    else await adb("shell", "input", "tap", ...at);
  }
  const title = (name: string) => (node: string) =>
    node.includes(`text="${name}"`);
  const returnedToApp = (xml: string) =>
    xml.includes('package="io.github.muxx.ummka.dev.httpcheck"') &&
    !documents.test(xml);
  async function openDownloads() {
    const xml = await waitUi((x) => documents.test(x), "DocumentsUI");
    if (nodeCenter(xml, title("ummka-first.txt"))) return;
    await tapNode(
      (node) => node.includes('content-desc="Show roots"'),
      "locations",
    );
    await tapNode(title("Downloads"), "Downloads");
  }
  await signal("START");
  try {
    await waitStage("one");
    await waitUi((x) => documents.test(x), "the single-file chooser");
    await adb("shell", "wm", "user-rotation", "lock", "1");
    await waitUi(
      (x) => documents.test(x) && x.includes('rotation="1"'),
      "the rotated chooser",
    );
    await openDownloads();
    await tapNode(title("ummka-first.txt"), "first file");
    await waitStage("many");
    await openDownloads();
    await tapNode(title("ummka-first.txt"), "first file", true);
    await tapNode(title("ummka-second.txt"), "second file");
    await tapNode(
      (node) =>
        /resource-id="[^"]*:id\/(action_menu_select|pick_button)"|(?:text|content-desc)="(?:open|select)"/iu.test(
          node,
        ),
      "confirm selection",
    );
    await waitStage("back");
    await waitUi((x) => documents.test(x), "the chooser before Back");
    await adb("shell", "input", "keyevent", "KEYCODE_BACK");
    await waitStage("owner");
    await waitUi(
      (x) => documents.test(x),
      "the chooser before owner cancellation",
    );
    await signal("CANCEL");
    await waitStage("waiting-to-reopen");
    await waitUi(returnedToApp, "return to ummka after owner cancellation");
    await signal("REOPEN");
    await waitStage("reopened");
    await waitUi((x) => documents.test(x), "the reopened chooser");
    await adb("shell", "input", "keyevent", "KEYCODE_BACK");
    await waitStage("checked");
    await waitUi(returnedToApp, "return to ummka after reopening");
    console.log(
      "Android DocumentsUI returned one and multiple readable documents, survived rotation and closed on Back and owner cancellation.",
    );
  } finally {
    await adb("shell", "wm", "user-rotation", "lock", "0");
  }
}
