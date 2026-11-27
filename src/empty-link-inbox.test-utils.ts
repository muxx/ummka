import { vi } from "vitest";

vi.mock("./mattermost/system-channels-links", () => ({
  watchSystemChannelsLinks: async (
    _navigate: unknown,
    _failure: unknown,
    _signal: AbortSignal,
    observers: { onEmpty: () => void },
  ) => {
    observers.onEmpty();
    return { retry: vi.fn(), dismiss: vi.fn() };
  },
}));
