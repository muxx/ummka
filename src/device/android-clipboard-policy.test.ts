import {
  addPluginListener,
  invoke,
  type PluginListener,
} from "@tauri-apps/api/core";
import { beforeEach, expect, test, vi } from "vitest";
import {
  observeAndroidClipboardAllowed,
  readAndroidClipboardAllowed,
} from "./android-clipboard-policy.ts";

vi.mock("@tauri-apps/api/core", () => ({
  addPluginListener: vi.fn(),
  invoke: vi.fn(),
}));
const unregister = vi.fn(async () => {});
function setup() {
  let changed!: (data: { allowed: boolean }) => void;
  vi.mocked(addPluginListener, { partial: true }).mockImplementation(
    async (_plugin, _event, callback) => {
      changed = callback as typeof changed;
      return { unregister };
    },
  );
  const report = vi.fn();
  const stop = observeAndroidClipboardAllowed(report);
  expect(report.mock.calls).toEqual([[false]]);
  return { changed, report, stop };
}
beforeEach(() => vi.resetAllMocks());

test("observes the real key, and a new restriction wins over a stale initial read", async () => {
  let finish!: (allowed: boolean) => void;
  const initial = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  vi.mocked(invoke).mockReturnValueOnce(initial);
  const { changed, report, stop } = setup();
  await vi.waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("plugin:clipboard-policy|read_allowed"),
  );
  expect(addPluginListener).toHaveBeenCalledWith(
    "clipboard-policy",
    "changed",
    expect.any(Function),
  );
  changed({ allowed: false });
  finish(true);
  await initial;
  await Promise.resolve();
  expect(report.mock.calls).toEqual([[false], [false]]);
  changed({ allowed: true });
  expect(report).toHaveBeenLastCalledWith(true);
  stop();
  changed({ allowed: false });
  expect(report).toHaveBeenLastCalledWith(true);
  await vi.waitFor(() => expect(unregister).toHaveBeenCalledOnce());
});

test("a failed read leaves copy disabled until a confirmed change", async () => {
  vi.mocked(invoke).mockRejectedValue(Error("unavailable"));
  const { changed, report, stop } = setup();
  await vi.waitFor(() => expect(report.mock.calls).toEqual([[false], [false]]));
  changed({ allowed: true });
  expect(report).toHaveBeenLastCalledWith(true);
  await expect(readAndroidClipboardAllowed()).resolves.toBe(false);
  stop();
});

test("publishes the current read after registration instead of an earlier change", async () => {
  let confirm!: (listener: Partial<PluginListener>) => void;
  let changed!: (event: { allowed: boolean }) => void;
  vi.mocked(addPluginListener, { partial: true }).mockImplementation(
    (_plugin, _event, callback) => {
      changed = callback as typeof changed;
      return new Promise((resolve) => {
        confirm = resolve;
      });
    },
  );
  vi.mocked(invoke).mockResolvedValue(false);
  const report = vi.fn();
  const stop = observeAndroidClipboardAllowed(report);
  changed({ allowed: true });
  expect(report.mock.calls).toEqual([[false]]);
  expect(invoke).not.toHaveBeenCalled();

  confirm({ unregister });
  await vi.waitFor(() => expect(report.mock.calls).toEqual([[false], [false]]));
  changed({ allowed: true });
  expect(report).toHaveBeenLastCalledWith(true);
  stop();
});

test("a rejected registration leaves the initial permission denied", async () => {
  const failure = Promise.reject(Error("unavailable"));
  vi.mocked(addPluginListener).mockReturnValueOnce(failure);
  const report = vi.fn();
  const stop = observeAndroidClipboardAllowed(report);
  await failure.catch(() => {});
  expect(report.mock.calls).toEqual([[false]]);
  expect(invoke).not.toHaveBeenCalled();
  stop();
});

test.each([null, "true", { allowed: true }])(
  "fails closed on malformed native read value %j",
  async (value) => {
    vi.mocked(invoke).mockResolvedValueOnce(value);
    await expect(readAndroidClipboardAllowed()).resolves.toBe(false);
  },
);

test("never reads after disposal during registration", async () => {
  const { stop, report } = setup();
  stop();
  stop();
  await vi.waitFor(() => expect(unregister).toHaveBeenCalledOnce());
  expect(invoke).not.toHaveBeenCalled();
  expect(report.mock.calls).toEqual([[false]]);
});
