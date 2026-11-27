import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PostBodyDisclosure } from "./PostBodyDisclosure.tsx";
import { PublishedCodeReader } from "./PublishedCodeReader.tsx";
import { PublishedPostBody } from "./PublishedPostBody.tsx";
import {
  PublishedReaderWindow,
  PublishedTableScreen,
  usePublishedReaderWindow,
} from "./PublishedReaderWindow.tsx";

const environment = vi.hoisted(() => ({
  android: true,
  report: undefined as ((allowed: boolean) => void) | undefined,
  read: vi.fn<() => Promise<boolean>>(),
  start: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("../build-platform.ts", () => ({
  get isAndroid() {
    return environment.android;
  },
}));
vi.mock("../device/clipboard-policy.ts", () => ({
  readClipboardAllowed: environment.read,
  observeClipboardAllowed(report: (allowed: boolean) => void) {
    environment.start();
    environment.report = report;
    report(false);
    return environment.stop;
  },
}));

const exact = "\t<div>雪 ☃  </div>  \n\n\nlast  \n\n";
const first = `\`\`\`html\n${exact}\`\`\``;
const second = "```sh\nother source\n```";
const write = vi.fn<(source: string) => Promise<void>>();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function Workspace({
  message,
  scope = "release",
}: {
  message: string;
  scope?: string;
}) {
  const reader = usePublishedReaderWindow(scope, "# Release");
  return (
    <PublishedReaderWindow value={reader.value}>
      <PostBodyDisclosure locale="en">
        <PublishedPostBody
          message={message}
          locale="en"
          authorName="Ada"
          inThread
        />
      </PostBodyDisclosure>
      <PublishedTableScreen reader={reader} />
      <PublishedCodeReader reader={reader} />
    </PublishedReaderWindow>
  );
}

function policy(allowed: boolean) {
  const report = environment.report;
  if (!report) throw Error("No policy listener");
  act(() => report(allowed));
}

const code = () => screen.getByRole("dialog", { name: "Code" });
const action = () => within(code()).getByRole("button", { name: "Copy code" });

beforeEach(() => {
  environment.android = true;
  environment.report = undefined;
  environment.read.mockReset().mockResolvedValue(true);
  environment.start.mockClear();
  environment.stop.mockClear();
  write.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: write },
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    if (this.contains(document.activeElement))
      (document.activeElement as HTMLElement).blur();
    this.open = false;
  };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test.each([
  ["one", 1, null],
  ["one\ntwo\nthree\nfour", 4, null],
  ["one\ntwo\nthree\nfour\nfive", 5, "+1 line"],
])("opens a real fenced code block of %d lines", (source, lines, remaining) => {
  const { container } = render(
    <Workspace message={`\`\`\`\n${source}\n\`\`\``} />,
  );
  const button = screen.getByRole("button", {
    name: `Open code: ${lines} ${lines === 1 ? "line" : "lines"}`,
  });
  expect(button.querySelector("code")?.textContent).toBe(
    source.split("\n").slice(0, 4).join("\n"),
  );
  expect(
    container.querySelector(".post-code-remaining")?.textContent ?? null,
  ).toBe(remaining);
  fireEvent.click(button);
  expect(code().querySelector("pre code")?.textContent).toBe(source);
});

test("Android keeps tabs, empty lines, Unicode and HTML and updates focus and policy", async () => {
  render(<Workspace message={`${first}\n\n${second}`} />);
  const long = screen.getByRole("button", { name: "Open code: 6 lines" });
  const short = screen.getByRole("button", { name: "Open code: 1 line" });
  expect(long.querySelector("code")?.textContent).toBe(
    exact.split("\n").slice(0, 4).join("\n"),
  );
  expect(long.querySelector(".post-code-remaining")?.textContent).toBe(
    "+2 lines",
  );
  fireEvent.click(long);
  const dialog = code();
  const region = within(dialog).getByRole("region", {
    name: "Full code, 6 lines",
  });
  expect(document.activeElement).toBe(region);
  expect(within(dialog).getByText("Ada · thread in # Release")).toBeTruthy();
  expect(dialog.querySelector("code")?.textContent).toBe(exact);
  expect(dialog.querySelector("code div")).toBeNull();
  expect(dialog.querySelector(".post-code-line-numbers")?.textContent).toBe(
    "1\n2\n3\n4\n5\n6",
  );
  expect(
    within(dialog).queryByRole("button", { name: "Copy code" }),
  ).toBeNull();
  const copyEvent = () =>
    new Event("copy", { bubbles: true, cancelable: true });
  expect(region.dispatchEvent(copyEvent())).toBe(false);

  policy(true);
  expect(region.dispatchEvent(copyEvent())).toBe(true);
  const pending = deferred<void>();
  write.mockReturnValueOnce(pending.promise);
  const button = action();
  fireEvent.click(button);
  fireEvent.click(button);
  expect(action().textContent).toBe("Copying…");
  await waitFor(() => expect(write).toHaveBeenCalledExactlyOnceWith(exact));
  expect(within(dialog).getByRole("status").textContent).toBe("");
  await act(async () => pending.resolve(undefined));
  expect(within(dialog).getByRole("status").textContent).toBe("Code copied.");

  button.focus();
  window.getSelection()?.removeAllRanges();
  const range = document.createRange();
  const raw = dialog.querySelector("code");
  if (!raw) throw Error("Missing rendered source");
  range.selectNodeContents(raw);
  window.getSelection()?.addRange(range);
  expect(window.getSelection()?.toString()).toBe(exact);
  policy(false);
  expect(window.getSelection()?.toString()).toBe("");
  expect(document.activeElement).toBe(region);
  expect(region.dispatchEvent(copyEvent())).toBe(false);
  expect(
    within(dialog).queryByRole("button", { name: "Copy code" }),
  ).toBeNull();
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  await waitFor(() => expect(document.activeElement).toBe(long));
  expect(environment.start).toHaveBeenCalledOnce();
  expect(environment.stop).toHaveBeenCalledOnce();

  fireEvent.click(short);
  expect(environment.start).toHaveBeenCalledTimes(2);
  policy(true);
  fireEvent.click(action());
  await waitFor(() => expect(write).toHaveBeenLastCalledWith("other source"));
  fireEvent.click(within(code()).getByRole("button", { name: "Back" }));
  await waitFor(() => expect(document.activeElement).toBe(short));
});

test("Android rechecks immediately before writing and abandons a detached or revoked request", async () => {
  render(<Workspace message={first} />);
  const open = screen.getByRole("button", { name: /Open code/ });
  fireEvent.click(open);
  policy(true);
  const checked = deferred<boolean>();
  environment.read.mockReturnValueOnce(checked.promise);
  fireEvent.click(action());
  expect(action().textContent).toBe("Copying…");
  policy(false);
  await act(async () => checked.resolve(true));
  expect(write).not.toHaveBeenCalled();

  policy(true);
  environment.read.mockResolvedValueOnce(false);
  fireEvent.click(action());
  await waitFor(() => {
    expect(within(code()).getByRole("status").textContent).toBe(
      "Copying code is restricted.",
    );
  });
  expect(write).not.toHaveBeenCalled();
  expect(
    within(code()).queryByRole("button", { name: "Copy code" }),
  ).toBeNull();

  policy(true);
  const detached = deferred<boolean>();
  environment.read.mockReturnValueOnce(detached.promise);
  fireEvent.click(action());
  fireEvent.click(within(code()).getByRole("button", { name: "Back" }));
  await act(async () => detached.resolve(true));
  expect(write).not.toHaveBeenCalled();
});

test.each([true, false])(
  "a pending read cannot resume after a revoke and re-grant (batched: %s)",
  async (batched) => {
    render(<Workspace message={first} />);
    fireEvent.click(screen.getByRole("button", { name: /Open code/ }));
    policy(true);
    const held = deferred<boolean>();
    environment.read.mockReturnValueOnce(held.promise);
    const button = action();
    fireEvent.click(button);
    if (batched) {
      const report = environment.report;
      if (!report) throw Error("No clipboard observer");
      act(() => {
        report(false);
        report(true);
      });
    } else {
      policy(false);
      policy(true);
    }
    expect(action() === button).toBe(batched);
    await act(async () => held.resolve(true));
    expect(write).not.toHaveBeenCalled();
    expect(within(code()).getByRole("status").textContent).toBe(
      "Copying code is restricted.",
    );
    expect(action().getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(action());
    await waitFor(() => expect(write).toHaveBeenCalledExactlyOnceWith(exact));
  },
);

test("an allowed notification without a denial keeps a pending read valid", async () => {
  render(<Workspace message={first} />);
  fireEvent.click(screen.getByRole("button", { name: /Open code/ }));
  policy(true);
  const held = deferred<boolean>();
  environment.read.mockReturnValueOnce(held.promise);
  fireEvent.click(action());
  policy(true);
  await act(async () => held.resolve(true));
  expect(write).toHaveBeenCalledExactlyOnceWith(exact);
});

test("a newer policy notification is not overwritten by an earlier denied copy check", async () => {
  render(<Workspace message={first} />);
  fireEvent.click(screen.getByRole("button", { name: /Open code/ }));
  policy(true);
  const read = deferred<boolean>();
  environment.read.mockReturnValueOnce(read.promise);
  fireEvent.click(action());
  policy(true);
  await act(async () => read.resolve(false));
  expect(write).not.toHaveBeenCalled();
  expect(action().isConnected).toBe(true);
  expect(within(code()).getByRole("status").textContent).toBe(
    "Copying code is restricted.",
  );
});

test("returns to the pressed code when the browser restores another previous focus on close", async () => {
  render(
    <>
      <button type="button">Timeline</button>
      <Workspace message={first} />
    </>,
  );
  const before = screen.getByRole("button", { name: "Timeline" });
  const trigger = screen.getByRole("button", { name: /Open code/ });
  before.focus();
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = false;
    before.focus();
  });
  fireEvent.click(trigger);
  fireEvent(code(), new Event("cancel", { cancelable: true }));
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  vi.restoreAllMocks();
});

test.each([
  { kind: "Code", message: first },
  { kind: "Table", message: "| Key | Value |\n| --- | --- |\n| one | two |" },
])(
  "restores the folded post action after rotation while reading $kind",
  async ({ kind, message }) => {
    vi.stubGlobal("innerHeight", 844);
    const bounds = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains("post-body-disclosure-content"))
          return new DOMRect(0, 0, 320, 600);
        if (this.classList.contains("post-body-disclosure-viewport"))
          return new DOMRect(
            0,
            0,
            320,
            Number.parseFloat(this.style.maxBlockSize),
          );
        return new DOMRect(0, 300, 160, 44);
      });
    try {
      const { rerender } = render(<Workspace message={message} />);
      const open = screen.getByRole("button", { name: /^Open (code|table)/ });
      const reveal = screen.getByRole("button", { name: "Show full message" });
      reveal.scrollIntoView = vi.fn();
      expect(open.hasAttribute("inert")).toBe(false);
      fireEvent.click(open);
      const dialog = screen.getByRole("dialog", { name: kind });
      const rotate = (height: number) => {
        vi.stubGlobal("innerHeight", height);
        act(() => window.dispatchEvent(new Event("resize")));
      };
      rotate(390);
      expect(open.hasAttribute("inert")).toBe(true);
      fireEvent(dialog, new Event("cancel", { cancelable: true }));
      await waitFor(() => expect(document.activeElement).toBe(reveal));
      expect(reveal.scrollIntoView).toHaveBeenCalledExactlyOnceWith({
        block: "nearest",
        inline: "nearest",
      });
      expect(reveal.getAttribute("aria-expanded")).toBe("false");

      rotate(844);
      fireEvent.click(open);
      rotate(390);
      rerender(<Workspace message={message} scope="another account" />);
      await act(async () => {});
      expect(screen.queryByRole("dialog", { name: kind })).toBeNull();
      expect(document.activeElement).toBe(document.body);
      expect(reveal.scrollIntoView).toHaveBeenCalledTimes(1);
    } finally {
      bounds.mockRestore();
    }
  },
);

test("desktop keeps the entire block and copies only that source at 320px", async () => {
  environment.android = false;
  vi.stubGlobal("innerWidth", 320);
  render(<Workspace message={`${first}\n\n${second}`} />);
  expect(screen.queryByRole("button", { name: /Open code/ })).toBeNull();
  const [a, b] = screen.getAllByRole("button", { name: "Copy code" });
  write.mockRejectedValueOnce(
    new DOMException("Clipboard denied", "NotAllowedError"),
  );
  fireEvent.click(a);
  await waitFor(() =>
    expect(screen.getByText("Could not copy code.")).toBeTruthy(),
  );
  expect(write).toHaveBeenNthCalledWith(1, exact);
  fireEvent.click(b);
  await waitFor(() => expect(screen.getByText("Code copied.")).toBeTruthy());
  expect(write).toHaveBeenNthCalledWith(2, "other source");
  expect(environment.read).not.toHaveBeenCalled();
});
