import { beforeEach, expect, test, vi } from "vitest";
import { getDeviceLaunchContext } from "./device-launch.ts";
import { readInstallationSelection } from "./installation-registry.ts";
import { getCurrentAccountId } from "./native-rest.ts";

vi.mock("./installation-registry.ts", () => ({
  readInstallationSelection: vi.fn(),
}));
vi.mock("./native-rest.ts", () => ({ getCurrentAccountId: vi.fn() }));
const read = vi.mocked(readInstallationSelection);
const current = vi.mocked(getCurrentAccountId);
const selected = "https://chat.example.test/Team";
const snapshot = {
  installations: ["https://chat.example.test", selected],
  selected,
};
beforeEach(() => vi.resetAllMocks());

test("first launch is local and never opens the credential store", async () => {
  read.mockResolvedValue({ installations: [], selected: null });
  await expect(getDeviceLaunchContext()).resolves.toEqual({
    status: "first_launch",
  });
  expect(current).not.toHaveBeenCalled();
});

test.each([null, "a".repeat(26)])(
  "uses only the selected installation for %s",
  async (userId) => {
    read.mockResolvedValue(snapshot);
    current.mockResolvedValue(userId);
    await expect(getDeviceLaunchContext()).resolves.toEqual(
      userId === null
        ? {
            status: "sign_in_required",
            serverUrl: selected,
            installations: snapshot.installations,
          }
        : { status: "ready", serverUrl: selected, userId },
    );
    expect(current).toHaveBeenCalledExactlyOnceWith(selected);
  },
);

test("preserves registry and credential failures for the window", async () => {
  read
    .mockRejectedValueOnce("unsupported_schema")
    .mockResolvedValueOnce(snapshot);
  current.mockRejectedValueOnce("storage");
  await expect(getDeviceLaunchContext()).rejects.toBe("unsupported_schema");
  expect(current).not.toHaveBeenCalled();
  await expect(getDeviceLaunchContext()).rejects.toBe("storage");
});
