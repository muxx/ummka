import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ResponseError } from "../../vendor/mattermost/index.js";
import { isMobile, usesMacOSOverlay } from "../build-platform.ts";
import {
  cancelBrowserSignIn,
  signInWithBrowser,
} from "../mattermost/browser-sign-in.ts";
import { inspectInstallation } from "../mattermost/inspect-installation.ts";
import {
  getCurrentAccountId,
  openAccountRestConnection,
} from "../mattermost/native-rest.ts";
import {
  design,
  fixture,
  home,
  other,
  reply,
  root,
  summer,
  user,
  winter,
} from "./navigation-app.test-utils.tsx";

let nativeBack: (() => void) | undefined;
vi.mock("@tauri-apps/api/app", () => ({
  onBackButtonPress: vi.fn(async (pressed: () => void) => {
    nativeBack = pressed;
    return {
      unregister: () => {
        if (nativeBack === pressed) nativeBack = undefined;
      },
    };
  }),
}));
function pressBack() {
  if (process.env.TAURI_ENV_PLATFORM === "android") {
    expect(nativeBack).toBeTypeOf("function");
    act(() => nativeBack?.());
  } else fireEvent.keyDown(document.body, { key: "Escape" });
}

vi.mock("../mattermost/device-launch.ts", () => ({
  getDeviceLaunchContext: vi.fn(),
}));
vi.mock("../mattermost/native-rest.ts", () => ({
  openAccountRestConnection: vi.fn(),
  getCurrentAccountId: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn(),
}));
vi.mock("../mattermost/inspect-installation.ts", async (original) => ({
  ...(await original<typeof import("../mattermost/inspect-installation.ts")>()),
  inspectInstallation: vi.fn(),
}));
vi.mock("../mattermost/browser-sign-in.ts", async (original) => ({
  ...(await original<typeof import("../mattermost/browser-sign-in.ts")>()),
  cancelBrowserSignIn: vi.fn(),
  signInWithBrowser: vi.fn(),
}));

const base = "https://example.test",
  nested = base + "/install",
  otherUser = "z".repeat(26);
const href = (id: string, server = base) => server + "/_redirect/pl/" + id;
const foreign = "https://outside.example.test/private/path";
const unsupported = `${base}/winter/threads/${"s".repeat(26)}`;
type QueueItem = { id: string; href: string };
let queue: QueueItem[],
  acks: { id: string; row: string | undefined; thread: boolean }[],
  wake: () => void,
  visible: boolean,
  selected: string,
  saved: string[],
  sessions: Map<string, string>;
function enqueue(id: string, url: string) {
  queue.push({ id, href: url });
  wake?.();
}
function closeLink() {
  fireEvent.click(screen.getByRole("button", { name: "Don’t open this link" }));
}
function boot(options: Parameters<typeof fixture>[0] = {}) {
  return fixture({
    ...options,
    launch: async () =>
      sessions.has(selected)
        ? {
            status: "ready",
            serverUrl: selected,
            userId: sessions.get(selected) as string,
          }
        : {
            status: "sign_in_required",
            serverUrl: selected,
            installations: saved,
          },
  });
}
beforeEach(() => {
  queue = [];
  acks = [];
  visible = true;
  selected = base;
  saved = [base, nested];
  sessions = new Map([
    [base, user],
    [nested, otherUser],
  ]);
  vi.mocked(getCurrentAccountId).mockImplementation(
    async (url) => sessions.get(url) ?? null,
  );
  vi.mocked(listen).mockImplementation(async (event, handler) => {
    wake = () => handler({ event, id: 1, payload: undefined as never });
    return () => {};
  });
  vi.mocked(invoke).mockImplementation(async (cmd, args) => {
    if (cmd === "list_installations") return [...saved];
    if (cmd === "read_installation_selection")
      return { selected, installations: [...saved] };
    if (cmd === "select_installation" || cmd === "connect_installation") {
      selected = (args as { serverUrl: string }).serverUrl;
      return;
    }
    if (cmd === "pending_channels_link") {
      const head = queue[0];
      return head ? { ...head, waiting: queue.length - 1 } : null;
    }
    if (cmd === "acknowledge_channels_link") {
      const { id } = args as { id: string };
      expect(id).toBe(queue[0]?.id);
      const el = document.activeElement as HTMLElement;
      acks.push({
        id,
        row: el.closest<HTMLElement>("[data-post-id]")?.dataset.postId,
        thread: !!el.closest(".thread-feed"),
      });
      queue.shift();
      return true;
    }
    throw Error("unexpected native operation " + cmd);
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.dataset.postId
        ? new DOMRect(0, visible ? 20 : 550, 400, 45)
        : new DOMRect(0, 0, 400, 500);
    },
  );
});
afterEach(() => vi.restoreAllMocks());
test("cold root waits until the focused row enters the actual viewport; the next warm reply is acknowledged inside its thread", async () => {
  visible = false;
  queue.push({ id: "1", href: href(root.id) });
  const { account } = boot();
  await waitFor(() =>
    expect((document.activeElement as HTMLElement).dataset.postId).toBe(
      root.id,
    ),
  );
  fireEvent.scroll(document.activeElement as Element);
  await act(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  expect(acks).toEqual([]);
  expect(
    account.readChannelWindow.mock.calls.some(([q]) => q.kind === "latest"),
  ).toBe(false);
  act(() => {
    enqueue("2", href(reply.id));
    enqueue("3", href(reply.id));
  });
  expect(account.readPostAnchor).toHaveBeenCalledTimes(1);
  visible = true;
  fireEvent.scroll(document.activeElement as Element);
  await waitFor(() =>
    expect(acks).toEqual([
      { id: "1", row: root.id, thread: false },
      { id: "2", row: reply.id, thread: true },
      { id: "3", row: reply.id, thread: true },
    ]),
  );
  expect(screen.queryByRole("button", { name: /back to results/i })).toBeNull();
  expect(account.readPostAnchor.mock.calls.map(([id]) => id)).toEqual([
    root.id,
    reply.id,
    reply.id,
  ]);
});
test("a flat reply received in the foreground switches to its actual team and focuses its exact row", async () => {
  const { account } = boot({ collapsed: false, cross: true });
  await screen.findByRole("textbox", { name: "Message #Home…" });
  act(() => enqueue("1", href(reply.id)));
  await waitFor(() =>
    expect(acks).toEqual([{ id: "1", row: reply.id, thread: false }]),
  );
  expect(account.selectJoinedTeam).toHaveBeenCalledWith(summer);
});
test("selects only the deepest saved address and its own current user", async () => {
  const { account } = boot();
  await screen.findByRole("textbox", { name: "Message #Home…" });
  act(() => enqueue("1", href(root.id, nested)));
  await waitFor(() => expect(acks[0]?.row).toBe(root.id));
  expect(selected).toBe(nested);
  expect(vi.mocked(openAccountRestConnection).mock.calls).toEqual([
    [base, user],
    [nested, otherUser],
  ]);
  expect(account.readPostDestination).toHaveBeenCalledTimes(1);
});
test("unknown, malformed and recognized unsupported addresses each wait for dismissal without post reads", async () => {
  for (const [i, url] of [
    "https://unknown.test/_redirect/pl/" + root.id,
    base + "/unsupported",
    base + "/winter/channels/home",
    href(root.id),
  ].entries())
    queue.push({ id: String(i), href: url });
  const { account } = boot();
  for (let index = 0; index < 3; index++) {
    await screen.findByText(
      index === 2 ? /type of system link/ : /does not match/,
    );
    expect(account.readPostDestination).not.toHaveBeenCalled();
    closeLink();
    await waitFor(() => expect(acks).toHaveLength(index + 1));
  }
  await waitFor(() => expect(acks.at(-1)?.row).toBe(root.id));
});

test("the cold entry shows the count for its own head and closing keeps the address and restores focus", async () => {
  saved = [];
  queue.push(
    { id: "A", href: foreign },
    { id: "B", href: foreign },
    { id: "C", href: foreign },
  );
  const { account } = fixture({
    launch: async () => ({ status: "first_launch" }),
  });
  const address = await screen.findByRole<HTMLInputElement>("textbox", {
    name: "Server address",
  });
  const firstAction = isMobile
    ? screen.getByRole("heading", { name: "Connect your Mattermost server" })
    : address;
  expect(address.value).toBe("");
  expect(document.activeElement).toBe(firstAction);
  expect(
    within(screen.getByRole("status")).getByText("This link can’t be opened"),
  ).toBeTruthy();
  expect(screen.getByText(/2 more links are waiting/)).toBeTruthy();
  expect(screen.getByRole("main").textContent).not.toContain(foreign);

  fireEvent.change(address, {
    target: { value: "manually.example.test/mattermost" },
  });
  const close = () =>
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
  close();
  await screen.findByText(/One more link is waiting/);
  expect(screen.queryByText(/2 more links are waiting/)).toBeNull();
  expect(document.activeElement).toBe(firstAction);
  expect(address.value).toBe("manually.example.test/mattermost");
  close();
  await screen.findByText("This link can’t be opened");
  expect(screen.queryByText(/more links? (?:are|is) waiting/)).toBeNull();
  expect(acks.map(({ id }) => id)).toEqual(["A", "B"]);
  close();
  await waitFor(() =>
    expect(acks.map(({ id }) => id)).toEqual(["A", "B", "C"]),
  );
  expect(inspectInstallation).not.toHaveBeenCalled();
  expect(signInWithBrowser).not.toHaveBeenCalled();
  expect(account.readPostDestination).not.toHaveBeenCalled();
});

test("a warm outcome preserves typing and an address error, then leaves after successful connection", async () => {
  saved = [];
  fixture({
    launch: async () =>
      vi
        .mocked(invoke)
        .mock.calls.some(([command]) => command === "connect_installation")
        ? { status: "sign_in_required", serverUrl: base, installations: [base] }
        : { status: "first_launch" },
  });
  const profile = {
    serverUrl: base,
    siteName: "Winter",
    version: "10.10.1",
    passwordIdentifiers: [],
    ssoProviders: ["gitlab" as const],
    guestMagicLink: false,
  };
  vi.mocked(inspectInstallation)
    .mockRejectedValueOnce(
      new ResponseError(new Response(null, { status: 404 })),
    )
    .mockResolvedValueOnce(profile);
  const field = await screen.findByRole<HTMLInputElement>("textbox", {
    name: "Server address",
  });
  field.focus();
  fireEvent.change(field, { target: { value: "example.test" } });
  act(() => enqueue("A", foreign));
  await screen.findByText("This link can’t be opened");
  expect(field.value).toBe("example.test");
  expect(document.activeElement).toBe(field);
  expect(inspectInstallation).not.toHaveBeenCalled();
  const submit = () =>
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  submit();
  await screen.findByRole("alert");
  expect(screen.getByText("This link can’t be opened")).toBeTruthy();
  expect(acks).toEqual([]);
  submit();
  await screen.findByRole("heading", {
    name: "How would you like to sign in?",
  });
  await waitFor(() => expect(acks.map(({ id }) => id)).toEqual(["A"]));
  expect(screen.queryByText("This link can’t be opened")).toBeNull();
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === "connect_installation"),
  ).toEqual([["connect_installation", { serverUrl: base }]]);
});

test("the known outcome remains through browser wait and cancellation and leaves on successful sign-in", async () => {
  sessions.delete(base);
  queue.push({ id: "A", href: unsupported });
  vi.mocked(inspectInstallation).mockResolvedValueOnce({
    serverUrl: base,
    siteName: "Winter",
    version: "10.10.1",
    passwordIdentifiers: [],
    ssoProviders: ["gitlab"],
    guestMagicLink: false,
  });
  let rejectBrowser!: (error: unknown) => void;
  vi.mocked(signInWithBrowser)
    .mockImplementationOnce(
      (_url, _provider, started) =>
        new Promise((_resolve, reject) => {
          rejectBrowser = reject;
          started("pending-sign-in");
        }),
    )
    .mockImplementationOnce(async () => {
      sessions.set(base, user);
      return user;
    });
  vi.mocked(cancelBrowserSignIn).mockImplementationOnce(async () => {
    rejectBrowser({ kind: "browser", cause: "cancelled" });
    return true;
  });

  const { account } = boot();
  const provider = { name: "Sign in with GitLab" };
  const action = await screen.findByRole("button", provider);
  const server = screen.getByRole("heading", { name: "Sign in again" });
  expect(document.activeElement).toBe(isMobile ? server : action);
  const outcome = screen
    .getByText("ummka can’t open this type of link yet")
    .closest('[role="status"]');
  expect(outcome?.textContent).toContain("a thread list on “Winter”");
  expect(outcome?.textContent).not.toContain(unsupported);
  expect(signInWithBrowser).not.toHaveBeenCalled();

  fireEvent.click(action);
  const browser = screen.getByRole("heading", {
    name: "Continue in your browser",
  });
  expect(document.activeElement).toBe(browser);
  act(() => enqueue("B", foreign));
  await screen.findByText(/One more link is waiting/);
  expect(document.activeElement).toBe(browser);
  expect(acks).toEqual([]);

  pressBack();
  const returned = await screen.findByRole("button", provider);
  expect(screen.getByText(/One more link is waiting/)).toBeTruthy();
  expect(acks).toEqual([]);
  fireEvent.click(returned);
  await screen.findByRole("button", { name: "Don’t open this link" });
  expect(screen.queryByRole("button", { name: /^Close$/u })).toBeNull();
  expect(screen.queryByText(/One more link is waiting/)).toBeNull();
  expect(acks.map(({ id }) => id)).toEqual(["A"]);
  expect(account.readPostDestination).not.toHaveBeenCalled();
  closeLink();
  await waitFor(() => expect(acks.map(({ id }) => id)).toEqual(["A", "B"]));
});

test("confirming a connection leaves a delivery that has not been shown for the next form", async () => {
  saved = [];
  let confirmConnection: (() => void) | undefined;
  fixture({
    launch: async () => {
      if (
        !vi
          .mocked(invoke)
          .mock.calls.some(([command]) => command === "connect_installation")
      )
        return { status: "first_launch" };
      return await new Promise((resolve) => {
        confirmConnection = () =>
          resolve({
            status: "sign_in_required",
            serverUrl: base,
            installations: [base],
          });
      });
    },
  });
  vi.mocked(inspectInstallation).mockResolvedValueOnce({
    serverUrl: base,
    siteName: "Winter",
    version: "10.10.1",
    passwordIdentifiers: [],
    ssoProviders: ["gitlab"],
    guestMagicLink: false,
  });
  const field = await screen.findByRole("textbox", { name: "Server address" });
  fireEvent.change(field, { target: { value: "example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(confirmConnection).toBeDefined());
  await act(async () => {
    enqueue("A", foreign);
    // Resolve the synthetic native reads before React commits the resulting notice.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(screen.queryByText("This link can’t be opened")).toBeNull();
    confirmConnection?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  await screen.findByRole("heading", {
    name: "How would you like to sign in?",
  });
  expect(screen.getByText("You’re still signing in to “Winter”.")).toBeTruthy();
  expect(acks).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(acks.map(({ id }) => id)).toEqual(["A"]));
});
test("retention or deletion leaves the head until the explanation is closed", async () => {
  queue.push({ id: "1", href: href(root.id) });
  const { account } = boot();
  account.readPostAnchor.mockRejectedValueOnce(
    new ResponseError(
      new Response(null, {
        status: 403,
        headers: { "first-inaccessible-post-time": "1" },
      }),
    ),
  );
  const dialog = within(await screen.findByRole("dialog"));
  const explanation = dialog.getByRole("region", { name: "Open message" });
  expect(explanation.contains(dialog.getByRole("alert"))).toBe(true);
  expect(explanation.tabIndex).toBe(0);
  expect(dialog.getByRole("alert").textContent).toMatch(/available history/);
  expect(acks).toHaveLength(0);
  expect(screen.queryByText(root.message)).toBeNull();
  fireEvent.click(dialog.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(queue).toHaveLength(0));
});
test.each([null, winter])(
  "Back dismisses system membership consent with initial team %s",
  async (initialTeam) => {
    queue.push({ id: "1", href: href(root.id) });
    const { account, targetInfo } = boot({ initialTeam });
    let deliverDestination!: () => void;
    account.readPostDestination.mockImplementation(
      () =>
        new Promise((resolve) => {
          deliverDestination = () =>
            resolve({
              ...targetInfo,
              channel: { ...targetInfo.channel, kind: "P", joined: false },
            });
        }),
    );
    await waitFor(() =>
      expect(account.readPostDestination).toHaveBeenCalledOnce(),
    );
    // Flush the Back subscription with the update that opens the dialog.
    await act(async () => deliverDestination());
    expect(
      screen.getByRole("dialog", { name: "Join the private channel?" }),
    ).toBeTruthy();
    expect(acks).toEqual([]);
    pressBack();
    await waitFor(() => expect(queue).toHaveLength(0));
    expect(acks).toEqual([{ id: "1", row: undefined, thread: false }]);
    expect(account.changeOwnMembership).not.toHaveBeenCalled();
  },
);

test("a seeded reply is not acknowledged before the thread history check completes", async () => {
  queue.push({ id: "1", href: href(reply.id) });
  const { account } = boot();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  account.readThreadPage.mockImplementation(async () => {
    await pending;
    return { kind: "inaccessible", firstInaccessiblePostTime: 1 };
  });
  await waitFor(() =>
    expect((document.activeElement as HTMLElement).dataset.postId).toBe(
      reply.id,
    ),
  );
  await act(async () => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
  expect(acks).toHaveLength(0);
  await act(async () => release());
  await screen.findByText(/outside the available history/);
  expect(acks).toHaveLength(0);
  closeLink();
  await waitFor(() => expect(queue).toHaveLength(0));
});

test("losing the position before acknowledging a system post offers an explicit retry", async () => {
  visible = false;
  queue.push({ id: "1", href: href(root.id) });
  const { account } = boot();
  await waitFor(() =>
    expect((document.activeElement as HTMLElement).dataset.postId).toBe(
      root.id,
    ),
  );
  const pane = (document.activeElement as HTMLElement).closest(
    ".timeline-scroll",
  );
  if (!pane) throw Error("Expected a channel timeline");
  Object.defineProperties(pane, {
    clientHeight: { value: 500 },
    scrollHeight: { value: 1200 },
  });
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  visible = true;
  account.readChannelWindow.mockResolvedValue(null);
  act(() => account.notifyChannelHistoryChanged(design));
  await screen.findByText(/Couldn’t open the linked message/);
  expect(acks).toHaveLength(0);
  closeLink();
  await waitFor(() => expect(queue).toHaveLength(0));
});

test("declining private membership dismisses just this delivery and preserves its old draft", async () => {
  queue.push({ id: "1", href: href(root.id) });
  const { account, targetInfo } = boot();
  account.readPostDestination.mockResolvedValue({
    ...targetInfo,
    channel: { ...targetInfo.channel, kind: "P", joined: false },
  });
  const dialog = within(await screen.findByRole("dialog"));
  expect(acks).toHaveLength(0);
  fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(queue).toHaveLength(0));
  expect(account.changeOwnMembership).not.toHaveBeenCalled();
  expect(
    (
      await screen.findByRole<HTMLTextAreaElement>("textbox", {
        name: "Message #Home…",
      })
    ).value,
  ).toBe("Original unfinished draft");
});
test("cached network failure requires an explicit retry", async () => {
  queue.push({ id: "1", href: href(root.id) });
  const { account } = boot();
  account.readPostDestination.mockRejectedValueOnce(new TypeError("offline"));
  await screen.findByText(/Couldn’t open the linked message/);
  expect(acks).toEqual([]);
  expect(account.readPostAnchor).not.toHaveBeenCalled();
  fireEvent.click(
    within(
      screen.getByRole("complementary", { name: "Message link" }),
    ).getByRole("button", { name: "Try again" }),
  );
  await waitFor(() => expect(acks[0]?.row).toBe(root.id));
  expect(account.readPostAnchor).toHaveBeenCalledTimes(1);
});
test("a post with an authoritative team opens before a first team has been selected", async () => {
  queue.push({ id: "1", href: href(root.id) });
  const { account } = boot({ initialTeam: null, cross: true });
  await waitFor(() => expect(acks[0]?.row).toBe(root.id));
  expect(account.selectJoinedTeam).toHaveBeenCalledWith(summer);
});
test("a direct post keeps its delivery until the user chooses a team", async () => {
  queue.push({ id: "1", href: href(root.id) });
  const { account } = boot({ initialTeam: null, direct: true });
  account.readPostDestination.mockResolvedValue({
    postId: root.id,
    channel: { id: design, kind: "D", displayName: "", joined: true },
    team: null,
  });
  const button = await screen.findByRole("button", { name: "Winter" });
  expect(acks).toEqual([]);
  expect(account.readPostAnchor).not.toHaveBeenCalled();
  fireEvent.click(button);
  await waitFor(() => expect(acks[0]?.row).toBe(root.id));
  expect(account.selectJoinedTeam).toHaveBeenCalledWith(winter);
});
test("missing retained installation never routes to its parent", async () => {
  queue.push({ id: "1", href: href(root.id, nested) });
  vi.mocked(getCurrentAccountId).mockImplementationOnce(async () => {
    saved = [base];
    return otherUser;
  });
  const { account } = boot();
  await screen.findByText(/message is unavailable/i);
  expect(account.readPostAnchor).not.toHaveBeenCalled();
  expect(selected).toBe(base);
  closeLink();
  await waitFor(() => expect(queue).toHaveLength(0));
});
test("skipping a pending server read suppresses its late result and lets the next same URL complete", async () => {
  queue.push(
    { id: "1", href: href(root.id) },
    { id: "2", href: href(root.id) },
  );
  const { account, targetInfo } = boot();
  let release!: (value: typeof targetInfo) => void;
  account.readPostDestination.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await waitFor(() =>
    expect(account.readPostDestination).toHaveBeenCalledOnce(),
  );
  closeLink();
  await waitFor(() => expect(acks.at(-1)?.row).toBe(root.id));
  await act(async () => release(targetInfo));
  expect(account.readPostAnchor).toHaveBeenCalledTimes(1);
  expect(acks.map((x) => x.id)).toEqual(["1", "2"]);
});
test("a saved server with a pending link keeps sign-in and dismissal in the same card", async () => {
  saved = [base];
  sessions.delete(base);
  queue.push({ id: "1", href: href(root.id) });
  vi.mocked(inspectInstallation).mockResolvedValueOnce({
    serverUrl: base,
    siteName: "Winter",
    version: "10.10.1",
    passwordIdentifiers: [],
    ssoProviders: ["gitlab"],
    guestMagicLink: false,
  });
  let cancelBrowser!: (error: unknown) => void;
  vi.mocked(signInWithBrowser).mockImplementationOnce(
    (_url, _provider, started) =>
      new Promise((_resolve, reject) => {
        cancelBrowser = reject;
        started("browser-fixture");
      }),
  );
  vi.mocked(cancelBrowserSignIn).mockImplementationOnce(async () => {
    cancelBrowser({ kind: "browser", cause: "cancelled" });
    return true;
  });
  const { account } = boot();
  const linkTitle = await screen.findByRole("heading", {
    name: "Sign in to open the message",
  });
  const form = within(screen.getByRole("main"));
  const linkedProvider = () =>
    form.getByRole("button", { name: "Sign in with GitLab" });
  expect(form.getByText(new URL(base).host)).toBeTruthy();
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Change server address" }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "Another server" })).toBeNull();
  expect(document.activeElement).toBe(isMobile ? linkTitle : linkedProvider());

  fireEvent.click(linkedProvider());
  expect(signInWithBrowser).toHaveBeenCalledWith(
    base,
    "gitlab",
    expect.any(Function),
  );
  expect(document.activeElement).toBe(
    form.getByRole("heading", { name: "Continue in your browser" }),
  );
  fireEvent.click(form.getByRole("button", { name: "Cancel sign-in" }));
  await form.findByText("Sign-in canceled");
  const canceled = within(form.getByRole("status"));
  expect(canceled.getByText("Sign-in canceled")).toBeTruthy();
  expect(
    canceled.getByText("The message will still open when you sign in."),
  ).toBeTruthy();
  expect(cancelBrowserSignIn).toHaveBeenCalledWith("browser-fixture");
  expect(acks).toEqual([]);
  expect(account.readPostDestination).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(
    isMobile
      ? form.getByRole("heading", { name: "Sign in to open the message" })
      : linkedProvider(),
  );

  fireEvent.click(form.getByRole("button", { name: "Don’t open this link" }));
  await waitFor(() => expect(acks.map((entry) => entry.id)).toEqual(["1"]));
  const regularHeading = form.getByRole("heading", { name: "Sign in again" });
  expect(document.activeElement).toBe(
    isMobile ? regularHeading : linkedProvider(),
  );
  expect(
    screen.queryByRole("button", { name: "Change server address" }),
  ).toBeNull();
  expect(form.getByRole("button", { name: "Another server" })).toBeTruthy();
  expect(
    form.queryByText("The message will still open when you sign in."),
  ).toBeNull();
  expect(selected).toBe(base);
});
test("cancelled SSO keeps the head until authentication on that installation", async () => {
  sessions.delete(nested);
  queue.push({ id: "1", href: href(root.id, nested) });
  vi.mocked(inspectInstallation).mockImplementation(async (serverUrl) => ({
    serverUrl,
    siteName: "Nested",
    version: "10.10.1",
    passwordIdentifiers: [],
    ssoProviders: ["gitlab"],
    guestMagicLink: false,
  }));
  vi.mocked(signInWithBrowser)
    .mockRejectedValueOnce({ kind: "browser", cause: "cancelled" })
    .mockImplementationOnce(async () => {
      sessions.set(nested, otherUser);
      return otherUser;
    });
  const { account } = boot();
  const linkedProvider = { name: "Sign in with GitLab" };
  fireEvent.click(await screen.findByRole("button", linkedProvider));
  await screen.findByRole("button", linkedProvider);
  expect(acks).toEqual([]);
  expect(account.readPostDestination).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", linkedProvider));
  await waitFor(() => expect(acks[0]?.row).toBe(root.id));
  expect(account.readPostAnchor).toHaveBeenCalledTimes(1);
  expect(vi.mocked(openAccountRestConnection)).toHaveBeenCalledWith(
    nested,
    otherUser,
  );
});

test("choosing a neighboring installation leaves the original target pending until explicit continuation", async () => {
  sessions.delete(nested);
  queue.push({ id: "1", href: href(root.id, nested) });
  vi.mocked(inspectInstallation).mockImplementation(async (serverUrl) => ({
    serverUrl,
    siteName: "Fixture",
    version: "10.10.1",
    passwordIdentifiers: [],
    ssoProviders: ["gitlab"],
    guestMagicLink: false,
  }));
  vi.mocked(signInWithBrowser).mockImplementationOnce(async () => {
    sessions.set(nested, otherUser);
    return otherUser;
  });
  const { account } = boot();
  fireEvent.click(
    await screen.findByRole("button", { name: "Another server" }),
  );
  expect(
    screen.getByRole("heading", { name: "Servers on this device" }),
  ).toBeTruthy();
  const current = screen.getByRole("button", { current: true });
  expect(within(current).getByTitle(nested)).toBeTruthy();
  const neighbor = screen.getByTitle(base).closest("button");
  if (!neighbor) throw Error("Missing saved installation");
  fireEvent.click(neighbor);
  await screen.findByRole("textbox", { name: "Message #Home…" });
  expect(invoke).toHaveBeenCalledWith("select_installation", {
    serverUrl: base,
  });
  expect(invoke).not.toHaveBeenCalledWith(
    "connect_installation",
    expect.anything(),
  );
  expect(acks).toEqual([]);
  expect(account.readPostAnchor).not.toHaveBeenCalled();
  fireEvent.click(
    within(
      screen.getByRole("complementary", { name: "Message link" }),
    ).getByRole("button", { name: "Try again" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Sign in with GitLab" }),
  );
  await waitFor(() => expect(acks[0]?.row).toBe(root.id));
  expect(account.readPostDestination).toHaveBeenCalledTimes(1);
});

test("Back returns from the empty add form and the saved-server list with focus restored", async () => {
  sessions.delete(base);
  queue.push({ id: "1", href: href(root.id) });
  vi.mocked(inspectInstallation).mockResolvedValueOnce({
    serverUrl: base,
    siteName: "Fixture",
    version: "10.10.1",
    passwordIdentifiers: [],
    ssoProviders: ["gitlab"],
    guestMagicLink: false,
  });
  boot();
  const open = { name: "Another server" };
  const add = { name: "Add server" };
  fireEvent.click(await screen.findByRole("button", open));
  const title = screen.getByRole("heading", { name: "Servers on this device" });
  const current = screen.getByRole("button", { current: true });
  expect(document.activeElement).toBe(isMobile ? title : current);
  fireEvent.click(current);
  expect(document.activeElement).toBe(screen.getByRole("button", open));
  fireEvent.click(screen.getByRole("button", open));
  fireEvent.click(screen.getByRole("button", add));
  const address = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Server address",
  });
  expect(address.value).toBe("");
  expect(document.activeElement).toBe(
    isMobile
      ? screen.getByRole("heading", { name: "Connect your Mattermost server" })
      : address,
  );
  pressBack();
  expect(document.activeElement).toBe(screen.getByRole("button", add));
  pressBack();
  expect(document.activeElement).toBe(screen.getByRole("button", open));
  expect(vi.mocked(inspectInstallation)).toHaveBeenCalledTimes(1);
  expect(invoke).not.toHaveBeenCalledWith(
    "select_installation",
    expect.anything(),
  );
  expect(acks).toEqual([]);
});

test("a failed saved-server choice leaves the picker and pending link available", async () => {
  sessions.delete(base);
  queue.push({ id: "1", href: href(root.id) });
  vi.mocked(inspectInstallation).mockResolvedValueOnce({
    serverUrl: base,
    siteName: "Fixture",
    version: "10.10.1",
    passwordIdentifiers: [],
    ssoProviders: ["gitlab"],
    guestMagicLink: false,
  });
  const native = vi.mocked(invoke).getMockImplementation();
  if (!native) throw Error("Missing registry fixture");
  let rejectSelection!: () => void;
  let choices = 0;
  vi.mocked(invoke).mockImplementation(async (command, args, options) => {
    if (command === "select_installation") {
      choices++;
      await new Promise<void>((_resolve, reject) => {
        rejectSelection = () => reject("storage_unavailable");
      });
    }
    return native(command, args, options);
  });
  const { account } = boot();
  fireEvent.click(
    await screen.findByRole("button", { name: "Another server" }),
  );
  const neighbor = screen.getByTitle(nested).closest("button");
  if (!neighbor) throw Error("Missing saved installation");
  fireEvent.click(neighbor);
  fireEvent.click(neighbor);
  fireEvent.click(screen.getByRole("button", { name: "Add server" }));
  pressBack();
  await waitFor(() => expect(rejectSelection).toBeTypeOf("function"));
  await act(async () => rejectSelection());
  expect((await screen.findByRole("alert")).textContent).toMatch(
    /switch servers/,
  );
  expect(choices).toBe(1);
  expect(selected).toBe(base);
  expect(acks).toEqual([]);
  expect(account.readPostDestination).not.toHaveBeenCalled();
  pressBack();
  expect(
    screen.getByRole("heading", { name: "Sign in to open the message" }),
  ).toBeTruthy();
});
test("Add server submits through the existing address form without consuming the link", async () => {
  sessions.delete(base);
  queue.push({ id: "1", href: href(root.id) });
  vi.mocked(inspectInstallation).mockImplementation(async (serverUrl) => ({
    serverUrl,
    siteName: "Fixture",
    version: "10.10.1",
    passwordIdentifiers: [],
    ssoProviders: ["gitlab"],
    guestMagicLink: false,
  }));
  const { account } = boot();
  fireEvent.click(
    await screen.findByRole("button", { name: "Another server" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Add server" }));
  const third = `${base}/third`;
  fireEvent.change(screen.getByRole("textbox", { name: "Server address" }), {
    target: { value: third },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("button", { name: "Sign in with GitLab" });
  expect(selected).toBe(third);
  expect(invoke).toHaveBeenCalledWith("connect_installation", {
    serverUrl: third,
  });
  expect(invoke).not.toHaveBeenCalledWith(
    "select_installation",
    expect.anything(),
  );
  expect(
    screen.queryByRole("heading", { name: "Sign in to open the message" }),
  ).toBeNull();
  expect(acks).toEqual([]);
  expect(account.readPostDestination).not.toHaveBeenCalled();
});

test("replacing the current user before resolution pauses until the new account explicitly resumes", async () => {
  queue.push({ id: "1", href: href(root.id) });
  vi.mocked(getCurrentAccountId).mockImplementationOnce(async () => {
    sessions.set(base, otherUser);
    return user;
  });
  const { account } = boot();
  await screen.findByText(/linked message is waiting/);
  expect(account.readPostDestination).not.toHaveBeenCalled();
  expect(acks).toEqual([]);
  fireEvent.click(
    within(
      screen.getByRole("complementary", { name: "Message link" }),
    ).getByRole("button", { name: "Try again" }),
  );
  await waitFor(() => expect(acks[0]?.row).toBe(root.id));
  expect(openAccountRestConnection).toHaveBeenCalledWith(base, otherUser);
});
test.each(["channel", "thread"] as const)(
  "a confirmed private membership stays visible when the linked %s cannot be displayed",
  async (target) => {
    visible = false;
    const post = target === "channel" ? root : reply;
    queue.push({ id: "1", href: href(post.id) });
    const { account, targetInfo } = boot();
    const pending = {
      ...targetInfo,
      postId: post.id,
      channel: { ...targetInfo.channel, kind: "P" as const, joined: false },
    };
    account.readPostDestination
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending);
    if (target === "channel") {
      account.readChannelWindow.mockResolvedValue(null);
      account.refreshChannelHistory.mockRejectedValue(new TypeError("offline"));
    } else {
      account.readThreadPage.mockResolvedValue({
        kind: "inaccessible",
        firstInaccessiblePostTime: 1,
      });
    }
    fireEvent.click(
      await screen.findByRole("button", { name: "Join and open" }),
    );
    const reason =
      target === "channel"
        ? /Couldn’t open the linked message/
        : /outside the available history/;
    const notice = await screen.findByText(reason);
    expect(notice.textContent).toContain("You joined the channel.");
    expect(account.changeOwnMembership).toHaveBeenCalledOnce();
    expect(acks).toEqual([]);
    closeLink();
    await waitFor(() => expect(acks.map((ack) => ack.id)).toEqual(["1"]));
  },
);
test("reloading a WebView with an invisible private post rechecks membership without submitting the join twice", async () => {
  visible = false;
  queue.push({ id: "1", href: href(root.id) });
  const first = boot();
  const pending = {
    ...first.targetInfo,
    channel: { ...first.targetInfo.channel, kind: "P" as const, joined: false },
  };
  first.account.readPostDestination
    .mockResolvedValueOnce(pending)
    .mockResolvedValueOnce(pending);
  fireEvent.click(await screen.findByRole("button", { name: "Join and open" }));
  await waitFor(() =>
    expect((document.activeElement as HTMLElement).dataset.postId).toBe(
      root.id,
    ),
  );
  expect(acks).toEqual([]);
  expect(first.account.changeOwnMembership).toHaveBeenCalledOnce();
  first.view.unmount();
  visible = true;
  const second = boot();
  await waitFor(() => expect(acks[0]?.row).toBe(root.id));
  expect(second.account.readPostDestination).toHaveBeenCalledOnce();
  expect(second.account.changeOwnMembership).not.toHaveBeenCalled();
});
test("a failed listener registration can be retried without a delivery ID or dismissal", async () => {
  queue.push({ id: "1", href: href(root.id) });
  vi.mocked(listen).mockRejectedValueOnce(Error("unavailable"));
  boot();
  const notice = within(
    await screen.findByRole("complementary", { name: "Message link" }),
  );
  expect(
    notice.queryByRole("button", { name: "Don’t open this link" }),
  ).toBeNull();
  fireEvent.click(notice.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(acks[0]?.row).toBe(root.id));
});

function delayFirstTeamSelection(
  account: ReturnType<typeof fixture>["account"],
) {
  const write = account.selectJoinedTeam.getMockImplementation();
  if (!write) throw Error("Missing team storage fixture");
  let release!: () => void;
  const selection = new Promise<void>((resolve) => {
    release = resolve;
  });
  account.selectJoinedTeam.mockImplementationOnce(async (team) => {
    await selection;
    return write(team);
  });
  return release;
}
test("a link received during a manual team selection reaches its post in the chosen team", async () => {
  const { account } = boot({ cross: true });
  const release = delayFirstTeamSelection(account);
  fireEvent.click(await screen.findByRole("button", { name: /team, Winter/i }));
  fireEvent.click(await screen.findByRole("button", { name: "Summer" }));
  await waitFor(() =>
    expect(account.selectJoinedTeam).toHaveBeenCalledWith(summer),
  );
  act(() => enqueue("1", href(root.id)));
  await screen.findByRole("button", { name: "Don’t open this link" });
  await waitFor(() => expect(getCurrentAccountId).toHaveBeenCalledWith(base));
  expect(acks).toEqual([]);
  await act(async () => release());
  await waitFor(() =>
    expect(acks).toEqual([{ id: "1", row: root.id, thread: false }]),
  );
  expect(account.selectJoinedTeam.mock.calls).toEqual([[summer]]);
  expect(screen.getByRole("button", { name: /team, Summer/i })).toBeTruthy();
});
test("dismissing a link during team persistence lets the next post return to its own team", async () => {
  const { account, targetInfo } = boot({ cross: true });
  await screen.findByRole("textbox", { name: "Message #Home…" });
  const release = delayFirstTeamSelection(account);
  const next = {
    ...root,
    id: "j".repeat(26),
    channelId: home,
    message: "Second link in Winter",
  };
  const destination = account.readPostDestination.getMockImplementation(),
    anchor = account.readPostAnchor.getMockImplementation(),
    window = account.readChannelWindow.getMockImplementation();
  if (!destination || !anchor || !window)
    throw Error("Missing post navigation fixtures");
  account.readPostDestination.mockImplementation(async (id, signal) =>
    id === next.id
      ? {
          postId: next.id,
          team: { ...targetInfo.team, id: winter, displayName: "Winter" },
          channel: { ...targetInfo.channel, id: home, displayName: "Home" },
        }
      : destination(id, signal),
  );
  account.readPostAnchor.mockImplementation(async (id, signal) =>
    id === next.id
      ? { postId: id, post: next, channelId: home, rootId: null }
      : anchor(id, signal),
  );
  account.readChannelWindow.mockImplementation(async (q) =>
    q.kind === "around" && q.postId === next.id
      ? {
          posts: [next],
          older: { kind: "end" },
          newer: { kind: "end" },
          firstInaccessiblePostTime: 0,
        }
      : window(q),
  );
  act(() => {
    enqueue("1", href(root.id));
    enqueue("2", href(next.id));
  });
  await waitFor(() =>
    expect(account.selectJoinedTeam).toHaveBeenCalledWith(summer),
  );
  closeLink();
  await waitFor(() => expect(acks.map((a) => a.id)).toContain("1"));
  await act(async () => release());
  await waitFor(() =>
    expect(acks.at(-1)).toEqual({ id: "2", row: next.id, thread: false }),
  );
  expect(account.selectJoinedTeam.mock.calls).toEqual([[summer], [winter]]);
  expect(await account.readJoinedTeams()).toMatchObject({
    selectedTeam: winter,
  });
  expect(screen.queryByText(root.message)).toBeNull();
});

test("dismissing an in-flight installation switch waits for its commit before the next link chooses its own server", async () => {
  const { account } = boot();
  await screen.findByRole("textbox", { name: "Message #Home…" });
  const standard = vi.mocked(invoke).getMockImplementation();
  if (!standard) throw Error("missing native fixture");
  let release!: () => void;
  vi.mocked(invoke).mockImplementation(async (command, args, options) => {
    if (
      command === "select_installation" &&
      (args as { serverUrl: string }).serverUrl === nested
    )
      await new Promise<void>((done) => {
        release = done;
      });
    return standard(command, args, options);
  });
  act(() => {
    enqueue("1", href(reply.id, nested));
    enqueue("2", href(root.id));
  });
  await waitFor(() => expect(release).toBeTypeOf("function"));
  closeLink();
  expect(acks).toEqual([]);
  expect(account.readPostDestination).not.toHaveBeenCalled();
  await act(async () => release());
  await waitFor(() => expect(acks.at(-1)?.row).toBe(root.id));
  expect(selected).toBe(base);
  expect(acks.map((row) => row.id)).toEqual(["1", "2"]);
  expect(account.readPostDestination.mock.calls.map(([id]) => id)).toEqual([
    root.id,
  ]);
});

test("a hidden WebView can lay out and focus the root, but only confirms it after the window becomes visible", async () => {
  const visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("hidden");
  queue.push({ id: "1", href: href(root.id) });
  boot();
  await waitFor(() =>
    expect((document.activeElement as HTMLElement).dataset.postId).toBe(
      root.id,
    ),
  );
  await act(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  expect(acks).toEqual([]);
  visibility.mockReturnValue("visible");
  fireEvent(document, new Event("visibilitychange"));
  await waitFor(() => expect(acks[0]?.row).toBe(root.id));
});

test("hidden scrolls and a stale visible notification never schedule or acknowledge a superseded row", async () => {
  const visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("hidden");
  queue.push(
    { id: "1", href: href(root.id) },
    { id: "2", href: href(reply.id) },
  );
  boot();
  await waitFor(() =>
    expect((document.activeElement as HTMLElement).dataset.postId).toBe(
      root.id,
    ),
  );
  const frames = vi.spyOn(window, "requestAnimationFrame");
  fireEvent.scroll(document.activeElement as Element);
  fireEvent.scroll(document.activeElement as Element);
  fireEvent(document, new Event("visibilitychange"));
  expect(frames).not.toHaveBeenCalled();
  expect(acks).toEqual([]);
  closeLink();
  await waitFor(() =>
    expect((document.activeElement as HTMLElement).dataset.postId).toBe(
      reply.id,
    ),
  );
  expect(acks.map((row) => row.id)).toEqual(["1"]);
  visibility.mockReturnValue("visible");
  fireEvent(document, new Event("visibilitychange"));
  await waitFor(() =>
    expect(acks[1]).toEqual({ id: "2", row: reply.id, thread: true }),
  );
});

test("a visible window waits for native input focus even with its destination already selected", async () => {
  const nativeFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
  queue.push({ id: "1", href: href(root.id) });
  boot();
  await waitFor(() =>
    expect((document.activeElement as HTMLElement).dataset.postId).toBe(
      root.id,
    ),
  );
  const frames = vi.spyOn(window, "requestAnimationFrame");
  fireEvent.scroll(document.activeElement as Element);
  expect(frames).not.toHaveBeenCalled();
  expect(acks).toEqual([]);
  nativeFocus.mockReturnValue(true);
  fireEvent(window, new Event("focus"));
  await waitFor(() =>
    expect(acks).toEqual([{ id: "1", row: root.id, thread: false }]),
  );
});

test("a manual server choice wins an earlier native link selection and keeps the delivery for explicit resume", async () => {
  const manual = "https://neighbor.example.test";
  saved.push(manual);
  sessions.delete(base);
  sessions.set(manual, user);
  vi.mocked(inspectInstallation).mockImplementation(async (serverUrl) => ({
    serverUrl,
    siteName: "Fixture",
    version: "10.10.1",
    passwordIdentifiers: [],
    ssoProviders: ["gitlab"],
    guestMagicLink: false,
  }));
  const native = vi.mocked(invoke).getMockImplementation();
  if (!native) throw Error("missing native fixture");
  const writes: string[] = [];
  let releaseSelection: (() => void) | undefined;
  vi.mocked(invoke).mockImplementation(async (command, args, options) => {
    if (command === "select_installation" && !releaseSelection) {
      await new Promise<void>((resolve) => {
        releaseSelection = resolve;
      });
    }
    const result = await native(command, args, options);
    if (command === "select_installation" || command === "connect_installation")
      writes.push(selected);
    return result;
  });
  const { account } = boot();
  await screen.findByRole("button", { name: "Sign in with GitLab" });
  act(() => enqueue("1", href(reply.id, nested)));
  await waitFor(() => expect(releaseSelection).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: "Another server" }));
  fireEvent.click(screen.getByRole("button", { name: "Add server" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Server address" }), {
    target: { value: manual },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() =>
    expect(vi.mocked(inspectInstallation).mock.calls.at(-1)?.[0]).toBe(manual),
  );
  await act(async () => releaseSelection?.());
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes).toEqual([nested, manual]);
  await screen.findByRole("textbox", { name: "Message #Home…" });
  expect(selected).toBe(manual);
  expect(acks).toEqual([]);
  expect(account.readPostDestination).not.toHaveBeenCalled();
  fireEvent.click(
    within(
      screen.getByRole("complementary", { name: "Message link" }),
    ).getByRole("button", { name: "Try again" }),
  );
  await waitFor(() =>
    expect(acks).toEqual([{ id: "1", row: reply.id, thread: true }]),
  );
  expect(selected).toBe(nested);
  expect(writes).toEqual([nested, manual, nested]);
});

test("a fresh system delivery to the same saved post owns navigation", async () => {
  boot();
  fireEvent.click(
    await screen.findByRole("button", { name: "Saved messages" }),
  );
  const panel = await screen.findByRole("complementary", {
    name: "Saved messages",
  });
  fireEvent.click(
    await within(panel).findByRole("button", { name: /Saved root preview/ }),
  );
  expect(
    await screen.findByRole("button", { name: "Back to saved messages" }),
  ).toBeTruthy();
  act(() => enqueue("1", href(root.id)));
  await waitFor(() =>
    expect(acks).toEqual([{ id: "1", row: root.id, thread: false }]),
  );
  expect(
    screen.queryByRole("button", { name: "Back to saved messages" }),
  ).toBeNull();
});

const savedPanel = () =>
  screen.findByRole("complementary", { name: "Saved messages" });
const savedReturn = () =>
  screen.findByRole("button", {
    name: "Back to saved messages in team “Winter”",
  });
async function visitSavedReply() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Saved messages" }),
  );
  const row = await within(await savedPanel()).findByRole("button", {
    name: /Saved reply preview/,
  });
  fireEvent.click(row);
  await savedReturn();
  await waitFor(() =>
    expect(document.activeElement).toBe(
      document.querySelector(`.thread-feed [data-post-id="${reply.id}"]`),
    ),
  );
}

test("cross-team saved reply returns to the same ID in a fresh list and keeps the original draft", async () => {
  const { account } = boot({ cross: true });
  account.readChannelIdentity.mockResolvedValue({
    id: design,
    kind: "O",
    teamId: summer,
    name: "design",
    displayName: "Design",
    deleteAt: 0,
  });
  await visitSavedReply();
  const returnButton = await savedReturn();
  expect(screen.queryByRole("button", { name: "Next in list" })).toBeNull();
  expect(screen.getByText("Team “Winter”")).toBeTruthy();
  const before = account.readSavedPosts.mock.calls.length;
  account.readSavedPostPreferences.mockResolvedValueOnce({ upperBound: 61 });
  account.readSavedPostsAtOffset.mockResolvedValueOnce({
    items: [
      {
        id: reply.id,
        channelId: design,
        rootId: root.id,
        message: "Fresh saved reply",
        createAt: 123,
      },
    ],
    firstInaccessiblePostTime: 0,
  });
  let fresh: (() => void) | undefined;
  account.readSavedPosts.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        fresh = () =>
          resolve({
            items: [{ id: root.id, channelId: design, createAt: 999 }],
            firstInaccessiblePostTime: 0,
          });
      }),
  );
  fireEvent.click(returnButton);
  const pane = within(await savedPanel());
  expect(pane.queryByText("Saved reply preview")).toBeNull();
  expect(account.readSavedPosts).toHaveBeenCalledTimes(before + 1);
  await act(async () => fresh?.());
  const returned = await pane.findByRole("button", {
    name: /Fresh saved reply/,
  });
  expect(returned.getAttribute("aria-current")).toBe("true");
  expect(document.activeElement).toBe(returned);
  expect(account.readSavedPostsAtOffset).toHaveBeenCalledExactlyOnceWith(
    { kind: "all" },
    60,
    expect.any(AbortSignal),
  );
  expect(account.selectJoinedTeam.mock.calls).toEqual([[summer], [winter]]);
  expect(account.selectSidebarChannel).toHaveBeenLastCalledWith(winter, home);
  if (isMobile) pressBack();
  await waitFor(() =>
    expect(
      (
        screen.getByRole("textbox", {
          name: "Message #Home…",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("Original unfinished draft"),
  );
});

test("manual channel and team changes abandon the particular row and reopen the last saved surface", async () => {
  const { account } = boot({ cross: true });
  await visitSavedReply();
  fireEvent.click(screen.getByRole("button", { name: /^(# )?Other$/ }));
  await screen.findByRole("textbox", { name: "Message #Other…" });
  expect(
    screen.queryByRole("button", { name: /back to saved messages/i }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Switch team, Summer" }));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Teams and servers" })).getByRole(
      "button",
      { name: "Winter" },
    ),
  );
  const pane = await savedPanel();
  await within(pane).findByRole("button", { name: /Saved reply preview/ });
  expect(pane.querySelector("[aria-current]")).toBeNull();
  expect(account.readSavedPosts).toHaveBeenCalledTimes(2);
});

function revokeWinter(account: ReturnType<typeof fixture>["account"]) {
  const joined = account.readJoinedTeams.getMockImplementation();
  account.readJoinedTeams.mockImplementation(async () => {
    const directory = await joined?.();
    if (!directory) throw new Error("Missing fixture directory");
    return {
      ...directory,
      teams: directory.teams.filter(({ id }) => id !== winter),
    };
  });
}

test.each(["activated", "return bar", "draft"] as const)(
  "a revoked source team removes return and announces it with focus at %s",
  async (focused) => {
    const { account } = boot({ cross: true });
    await visitSavedReply();
    const post = document.activeElement as HTMLElement;
    vi.spyOn(post, "getClientRects").mockReturnValue([
      post.getBoundingClientRect(),
    ] as unknown as DOMRectList);
    const back = await savedReturn();
    const draft = screen.getByDisplayValue("Unfinished reply");
    (focused === "draft" ? draft : back).focus();
    revokeWinter(account);
    if (focused === "activated") fireEvent.click(back);
    else act(() => window.dispatchEvent(new Event("online")));
    const notice = await screen.findByText(
      "You were removed from team “Winter”. You can’t return to saved messages.",
    );
    expect(notice.closest("[role=status]")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(account.selectJoinedTeam.mock.calls).toEqual([[summer]]);
    expect(account.readSavedPosts).toHaveBeenCalledTimes(1);
    expect(screen.getByDisplayValue("Unfinished reply")).toBe(draft);
    expect(screen.getByText(reply.message).closest("article")).toBe(post);
    expect(back.isConnected).toBe(false);
    expect(document.activeElement).toBe(focused === "draft" ? draft : post);
  },
);

test("a refused destination team leaves its previous channel untouched", async () => {
  const { account } = boot({ cross: true });
  fireEvent.click(
    await screen.findByRole("button", { name: "Saved messages" }),
  );
  const row = await within(await savedPanel()).findByRole("button", {
    name: /Saved reply preview/,
  });
  account.selectJoinedTeam.mockResolvedValueOnce(false);
  fireEvent.click(row);
  await screen.findByText("Couldn’t open the message. Try again.");
  expect(account.selectSidebarChannel).not.toHaveBeenCalled();
  expect((await account.readTeamSidebar(summer))?.selectedChannel).toBe(other);
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "OK" }),
  );
  expect(document.activeElement).toBe(row);
  fireEvent.click(row);
  await savedReturn();
  expect(account.selectSidebarChannel).toHaveBeenCalledExactlyOnceWith(
    summer,
    design,
  );
});

test.each(["teams", "sidebar", "after refusal"] as const)(
  "a missing %s snapshot leaves the saved return available for retry",
  async (missing) => {
    const { account } = boot({ cross: true });
    await visitSavedReply();
    if (missing === "teams")
      account.readJoinedTeams.mockResolvedValueOnce(null);
    if (missing === "sidebar")
      account.readTeamSidebar.mockResolvedValueOnce(null);
    if (missing === "after refusal")
      account.selectJoinedTeam.mockImplementationOnce(async () => {
        account.readJoinedTeams.mockResolvedValueOnce(null);
        return false;
      });

    fireEvent.click(await savedReturn());
    await screen.findByText("Couldn’t return to saved messages. Try again.");
    expect(account.readSavedPosts).toHaveBeenCalledTimes(1);
    expect(account.selectSidebarChannel.mock.calls).toEqual([[summer, design]]);
    expect((await account.readJoinedTeams())?.selectedTeam).toBe(summer);
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "OK" }));
    const retry = await savedReturn();
    expect(document.activeElement).toBe(retry);

    fireEvent.click(retry);
    const row = await within(await savedPanel()).findByRole("button", {
      name: /Saved reply preview/,
    });
    await waitFor(() => expect(document.activeElement).toBe(row));
    expect(row.getAttribute("aria-current")).toBe("true");
    expect(account.readSavedPosts).toHaveBeenCalledTimes(2);
  },
);

test("going offline during return keeps its provenance available after reconnect", async () => {
  const { account } = boot({ cross: true });
  await visitSavedReply();
  let release: (() => void) | undefined;
  let signal: AbortSignal | undefined;
  account.refreshJoinedTeams.mockImplementationOnce(
    (active?: AbortSignal) =>
      new Promise((resolve) => {
        signal = active;
        release = () => resolve(true);
      }),
  );
  fireEvent.click(await savedReturn());
  expect(signal?.aborted).toBe(false);
  const online = vi.spyOn(navigator, "onLine", "get");
  online.mockReturnValue(false);
  act(() => window.dispatchEvent(new Event("offline")));
  expect(signal?.aborted).toBe(true);
  expect(((await savedReturn()) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => release?.());
  expect(account.selectJoinedTeam.mock.calls).toEqual([[summer]]);

  online.mockReturnValue(true);
  act(() => window.dispatchEvent(new Event("online")));
  fireEvent.click(await savedReturn());
  const row = await within(await savedPanel()).findByRole("button", {
    name: /Saved reply preview/,
  });
  expect(document.activeElement).toBe(row);
});

test.each(["absent", "forbidden"] as const)(
  "a joined source team reopens its fresh saved list when the original channel is %s",
  async (channelAccess) => {
    const { account } = boot({ cross: true });
    await visitSavedReply();
    if (channelAccess === "forbidden") {
      account.refreshTeamSidebar.mockRejectedValueOnce(
        new ResponseError(new Response(null, { status: 403 })),
      );
    } else {
      const readSidebar = account.readTeamSidebar.getMockImplementation();
      if (!readSidebar) throw Error("Fixture sidebar required");
      account.readTeamSidebar.mockImplementation(async (id) => {
        const sidebar = await readSidebar(id);
        if (id !== winter || !sidebar) return sidebar;
        return {
          selectedChannel: null,
          data: {
            ...sidebar.data,
            channels: sidebar.data.channels.filter(({ id }) => id !== home),
          },
        };
      });
    }
    account.readDraft.mockClear();
    fireEvent.click(await savedReturn());
    const row = await within(await savedPanel()).findByRole("button", {
      name: /Saved reply preview/,
    });
    expect(document.activeElement).toBe(row);
    expect(row.getAttribute("aria-current")).toBe("true");
    expect(account.readSavedPosts).toHaveBeenCalledTimes(2);
    expect(account.selectSidebarChannel.mock.calls).toEqual([[summer, design]]);
    expect(screen.queryByRole("dialog")).toBeNull();
    pressBack();
    await screen.findByRole("textbox", { name: "Message #Third channel…" });
    expect(
      account.readDraft.mock.calls.some(
        ([address]) => address.channelId === home,
      ),
    ).toBe(false);
  },
);

test.each(["rejected", "storage error"] as const)(
  "a %s channel write uses standard failure handling after the team return",
  async (failure) => {
    const { account } = boot({ cross: true });
    await visitSavedReply();
    // Another view left a newer ordinary channel selection in the source team.
    await account.selectSidebarChannel(winter, other);
    account.selectSidebarChannel.mockClear();
    if (failure === "rejected")
      account.selectSidebarChannel.mockResolvedValueOnce(false);
    else
      account.selectSidebarChannel.mockRejectedValueOnce(
        Error("Fixture sidebar storage error"),
      );
    account.readChannelWindow.mockClear();

    fireEvent.click(await savedReturn());
    const returned = await within(await savedPanel()).findByRole("button", {
      name: /Saved reply preview/,
    });
    expect(returned.getAttribute("aria-current")).toBe("true");
    await screen.findByText("Couldn’t save the selected channel.");
    expect(account.selectSidebarChannel.mock.calls).toEqual([[winter, home]]);
    expect((await account.readTeamSidebar(winter))?.selectedChannel).toBe(
      other,
    );
    pressBack();
    await screen.findByRole("textbox", { name: "Message #Third channel…" });
    expect(
      account.readChannelWindow.mock.calls.some(
        ([read]) => read.channelId === home,
      ),
    ).toBe(false);
  },
);

test("a failed channel write finishing after manual navigation leaves the latest channel selected on re-entry", async () => {
  const { account } = boot({ cross: true });
  await visitSavedReply();
  let finish: (() => void) | undefined;
  account.selectSidebarChannel.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(false);
      }),
  );
  fireEvent.click(await savedReturn());
  await savedPanel();
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: "Third channel" }));
  await screen.findByRole("textbox", { name: "Message #Third channel…" });
  await act(async () => finish?.());
  await waitFor(() =>
    expect(account.selectSidebarChannel).toHaveBeenLastCalledWith(
      winter,
      other,
    ),
  );
  expect(screen.queryByText("Couldn’t save the selected channel.")).toBeNull();
  async function switchTeam(from: string, to: string) {
    fireEvent.click(
      screen.getByRole("button", { name: `Switch team, ${from}` }),
    );
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "Teams and servers" }),
      ).getByRole("button", { name: to }),
    );
  }
  await switchTeam("Winter", "Summer");
  await screen.findByRole("button", { name: "Switch team, Summer" });
  await switchTeam("Summer", "Winter");
  await screen.findByRole("textbox", { name: "Message #Third channel…" });
  expect(
    screen.queryByRole("complementary", { name: "Saved messages" }),
  ).toBeNull();
  expect((await account.readTeamSidebar(winter))?.selectedChannel).toBe(other);
});

test("a system link to the same reply cancels a held saved return and keeps the newer destination", async () => {
  const { account } = boot({ cross: true });
  await visitSavedReply();
  let resume: (() => void) | undefined;
  account.refreshJoinedTeams.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resume = () => resolve(true);
      }),
  );
  fireEvent.click(await savedReturn());
  expect(resume).toBeTypeOf("function");
  act(() => enqueue("1", href(reply.id)));
  await waitFor(() =>
    expect(acks).toEqual([{ id: "1", row: reply.id, thread: true }]),
  );
  await act(async () => resume?.());
  expect(account.selectJoinedTeam.mock.calls).toEqual([[summer]]);
  expect(account.readSavedPosts).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByRole("button", { name: /back to saved messages/i }),
  ).toBeNull();
});

test("changing installations retires a held saved return with the old account", async () => {
  const { account } = boot({ cross: true });
  await visitSavedReply();
  let release: (() => void) | undefined;
  let oldSignal: AbortSignal | undefined;
  account.refreshJoinedTeams.mockImplementationOnce(
    (signal?: AbortSignal) =>
      new Promise((resolve) => {
        oldSignal = signal;
        release = () => resolve(true);
      }),
  );
  fireEvent.click(await savedReturn());
  expect(oldSignal?.aborted).toBe(false);
  type Connection = Awaited<ReturnType<typeof openAccountRestConnection>>;
  vi.mocked(openAccountRestConnection).mockResolvedValueOnce({
    ...account,
    rid: 10,
  } as unknown as Connection);
  act(() => enqueue("1", href(reply.id, nested)));
  await waitFor(() =>
    expect(acks).toEqual([{ id: "1", row: reply.id, thread: true }]),
  );
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => release?.());
  expect(vi.mocked(openAccountRestConnection).mock.calls).toEqual([
    [base, user],
    [nested, otherUser],
  ]);
  expect(account.readSavedPosts).toHaveBeenCalledTimes(1);
  expect(account.selectJoinedTeam.mock.calls).toEqual([[summer]]);
  expect(
    screen.queryByRole("button", { name: /back to saved messages/i }),
  ).toBeNull();
});

test("a late saved team write cannot replace the manually selected channel", async () => {
  const { account } = boot({ cross: true });
  await visitSavedReply();
  const selectTeam = account.selectJoinedTeam.getMockImplementation();
  let finish: (() => void) | undefined;
  account.selectJoinedTeam.mockImplementationOnce(
    (team) =>
      new Promise((resolve) => {
        finish = () => resolve(selectTeam?.(team) ?? false);
      }),
  );
  fireEvent.click(await savedReturn());
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: /^(# )?Other$/ }));
  await screen.findByRole("textbox", { name: "Message #Other…" });
  await act(async () => finish?.());
  await waitFor(() =>
    expect(account.selectSidebarChannel).toHaveBeenLastCalledWith(
      summer,
      other,
    ),
  );
  expect(account.selectJoinedTeam.mock.calls).toEqual([
    [summer],
    [winter],
    [summer],
  ]);
  expect((await account.readJoinedTeams())?.selectedTeam).toBe(summer);
  expect(account.selectSidebarChannel.mock.calls).toEqual([
    [summer, design],
    [summer, other],
  ]);
  expect(account.readSavedPosts).toHaveBeenCalledTimes(1);
});

test("stepping from a local saved post opens the cross-team reply and does not substitute a removed row on return", async () => {
  const { account, targetInfo } = boot({ cross: true });
  const local = { ...root, id: "l".repeat(26), channelId: home };
  account.readPostDestination.mockResolvedValueOnce({
    postId: local.id,
    channel: { ...targetInfo.channel, id: home, displayName: "Home" },
    team: { ...targetInfo.team, id: winter, displayName: "Winter" },
  });
  account.readPostAnchor.mockResolvedValueOnce({
    postId: local.id,
    channelId: home,
    rootId: null,
    post: local,
  });
  account.readSavedPosts.mockResolvedValueOnce({
    items: [
      {
        id: local.id,
        channelId: home,
        createAt: 999,
        message: "Local saved post",
      },
      { id: reply.id, channelId: design, rootId: root.id, createAt: 123 },
    ],
    firstInaccessiblePostTime: 0,
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Saved messages" }),
  );
  fireEvent.click(
    await within(await savedPanel()).findByRole("button", {
      name: /Local saved post/,
    }),
  );
  await screen.findByText("1 of 2");
  fireEvent.keyDown(document.body, {
    code: "KeyG",
    ctrlKey: !usesMacOSOverlay,
    metaKey: usesMacOSOverlay,
  });
  await savedReturn();
  expect(account.readPostAnchor.mock.calls.map(([id]) => id)).toEqual([
    local.id,
    reply.id,
  ]);
  fireEvent.keyDown(document.body, {
    code: "KeyG",
    ctrlKey: !usesMacOSOverlay,
    metaKey: usesMacOSOverlay,
  });
  await screen.findByText(/The list is in team “Winter”/);
  expect(account.readPostAnchor).toHaveBeenCalledTimes(2);
  account.readSavedPosts.mockResolvedValueOnce({
    items: [
      { id: local.id, channelId: home, message: "Remaining local saved post" },
    ],
    firstInaccessiblePostTime: 0,
  });
  account.readSavedPostPreferences.mockResolvedValueOnce({
    upperBound: 1,
    returnedPostSaved: false,
  });
  fireEvent.click(await savedReturn());
  const pane = await savedPanel();
  const previous = await within(pane).findByRole("button", {
    name: /Remaining local saved post/,
  });
  expect(pane.querySelector("[aria-current]")).toBeNull();
  expect(document.activeElement).toBe(previous);
  expect(
    within(pane)
      .getByText("This message is no longer saved")
      .getAttribute("role"),
  ).toBe("status");
  let completeRemoval: (() => void) | undefined;
  account.setPostSaved.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        completeRemoval = resolve;
      }),
  );
  fireEvent.click(
    within(pane).getByRole("button", { name: "Remove from saved" }),
  );
  await within(pane).findByText("Removing from saved…");
  expect(
    within(pane).queryByText("This message is no longer saved"),
  ).toBeNull();
  await act(async () => completeRemoval?.());
  await waitFor(() => expect(previous.isConnected).toBe(false));

  account.readSavedPosts.mockResolvedValueOnce({
    items: [
      {
        id: local.id,
        channelId: home,
        message: "Another client saved it again",
      },
    ],
    firstInaccessiblePostTime: 0,
  });
  fireEvent.click(within(pane).getByRole("button", { name: "Refresh" }));
  await within(pane).findByText("Saved messages updated");
  await within(pane).findByRole("button", {
    name: /Another client saved it again/,
  });
  expect(
    within(pane).queryByText("This message is no longer saved"),
  ).toBeNull();
});

test("returning after removal focuses the fresh row at the old index after the full list is known", async () => {
  const { account } = boot({ cross: true });
  const older = {
    id: root.id,
    channelId: design,
    message: "Older saved post",
    createAt: 123,
  };
  const newer = {
    id: "n".repeat(26),
    channelId: home,
    message: "Newer saved post",
    createAt: 999,
  };
  account.readSavedPosts.mockResolvedValueOnce({
    items: [
      newer,
      {
        id: reply.id,
        channelId: design,
        rootId: root.id,
        message: "Saved reply preview",
        createAt: 345,
      },
      older,
    ],
    firstInaccessiblePostTime: 0,
  });
  await visitSavedReply();
  account.readSavedPostPreferences.mockResolvedValueOnce({
    upperBound: 1201,
    returnedPostSaved: false,
  });
  account.readSavedPosts.mockResolvedValueOnce({
    items: [newer],
    firstInaccessiblePostTime: 0,
  });
  let finish: (() => void) | undefined;
  account.readSavedPostsAtOffset
    .mockRejectedValueOnce(new TypeError("Fixture unavailable page"))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({ items: [older], firstInaccessiblePostTime: 0 });
        }),
    );
  fireEvent.click(await savedReturn());
  const pane = await savedPanel();
  const retry = await within(pane).findByRole("button", {
    name: "Retry loading earlier saved messages",
  });
  expect(
    within(pane).queryByText("This message is no longer saved"),
  ).toBeNull();
  retry.focus();
  fireEvent.click(retry);
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(
    within(pane).queryByText("This message is no longer saved"),
  ).toBeNull();
  await act(async () => finish?.());
  const next = within(pane).getByRole("button", { name: /Older saved post/ });
  expect(document.activeElement).toBe(next);
  expect(pane.querySelector("[aria-current]")).toBeNull();
  expect(
    within(pane).getByText("This message is no longer saved"),
  ).toBeTruthy();
  expect(
    account.readSavedPostsAtOffset.mock.calls.map(([, offset]) => offset),
  ).toEqual([60, 60]);
  expect(account.readSavedPostPreferences).toHaveBeenLastCalledWith(
    expect.any(AbortSignal),
    reply.id,
  );
});

test("a still-flagged but inaccessible post does not report a removed bookmark", async () => {
  const { account } = boot({ cross: true });
  await visitSavedReply();
  account.readSavedPostPreferences.mockResolvedValueOnce({
    upperBound: 2,
    returnedPostSaved: true,
  });
  account.readSavedPosts.mockResolvedValueOnce({
    items: [
      { id: root.id, channelId: design, message: "Only visible saved post" },
    ],
    firstInaccessiblePostTime: 0,
  });
  fireEvent.click(await savedReturn());
  const pane = await savedPanel();
  await within(pane).findByRole("button", { name: /Only visible saved post/ });
  expect(
    within(pane).queryByText("This message is no longer saved"),
  ).toBeNull();
  expect(document.activeElement).toBe(
    within(pane).getByRole("heading", { name: "Saved messages" }),
  );
  expect(pane.querySelector("[aria-current]")).toBeNull();
});

test("a concurrently returned saved row takes precedence over an absent flag snapshot", async () => {
  const { account } = boot({ cross: true });
  await visitSavedReply();
  account.readSavedPostPreferences.mockResolvedValueOnce({
    upperBound: 1201,
    returnedPostSaved: false,
  });
  fireEvent.click(await savedReturn());
  const pane = await savedPanel();
  const exact = await within(pane).findByRole("button", {
    name: /Saved reply preview/,
  });
  expect(document.activeElement).toBe(exact);
  expect(exact.getAttribute("aria-current")).toBe("true");
  expect(
    within(pane).queryByText("This message is no longer saved"),
  ).toBeNull();
  expect(account.readSavedPostsAtOffset).not.toHaveBeenCalled();
});

test("manual reopening clears the previous return target and the next cross-team visit checks its own ID", async () => {
  const { account } = boot({ cross: true });
  await visitSavedReply();
  fireEvent.click(await savedReturn());
  const firstReturn = await savedPanel();
  const replyRow = await within(firstReturn).findByRole("button", {
    name: /Saved reply preview/,
  });
  expect(replyRow.getAttribute("aria-current")).toBe("true");
  expect(account.readSavedPostPreferences).toHaveBeenLastCalledWith(
    expect.any(AbortSignal),
    reply.id,
  );

  pressBack();
  expect(firstReturn.isConnected).toBe(false);
  const before = account.readSavedPostPreferences.mock.calls.length;
  fireEvent.click(
    await screen.findByRole("button", { name: "Saved messages" }),
  );
  const reopened = await savedPanel();
  const rootLink = await within(reopened).findByRole("button", {
    name: /Saved root preview/,
  });
  expect(reopened.querySelector("[aria-current]")).toBeNull();
  await waitFor(() =>
    expect(account.readSavedPostPreferences).toHaveBeenCalledTimes(before + 1),
  );
  expect(account.readSavedPostPreferences).toHaveBeenLastCalledWith(
    expect.any(AbortSignal),
    undefined,
  );

  fireEvent.click(rootLink);
  await screen.findByText(root.message);
  fireEvent.click(await savedReturn());
  const secondReturn = await savedPanel();
  const rootRow = await within(secondReturn).findByRole("button", {
    name: /Saved root preview/,
  });
  expect(rootRow.getAttribute("aria-current")).toBe("true");
  expect(secondReturn).not.toBe(firstReturn);
  expect(account.readSavedPostPreferences).toHaveBeenLastCalledWith(
    expect.any(AbortSignal),
    root.id,
  );
});

test("returning after removal of the only saved item focuses the empty heading", async () => {
  const { account } = boot({ cross: true });
  await visitSavedReply();
  account.readSavedPosts.mockResolvedValueOnce({
    items: [],
    firstInaccessiblePostTime: 0,
  });
  account.readSavedPostPreferences.mockResolvedValueOnce({
    upperBound: 0,
    returnedPostSaved: false,
  });
  fireEvent.click(await savedReturn());
  const pane = within(await savedPanel());
  const empty = await pane.findByRole("heading", { name: "No saved messages" });
  expect(document.activeElement).toBe(empty);
  expect(pane.queryByText("This message is no longer saved")).toBeNull();
});

test("published links share signed post navigation without consuming any system delivery", async () => {
  const { account } = boot();
  const source = {
    ...root,
    id: "v".repeat(26),
    channelId: home,
    message: `[Open reply](${href(reply.id)})`,
  };
  const linkedReply = { ...reply, message: `[Open root](${href(root.id)})` };
  account.readChannelWindow.mockImplementation(async (q) => ({
    posts:
      q.kind === "latest" && q.channelId === home
        ? [source]
        : q.kind === "around"
          ? [q.postId === root.id ? root : linkedReply]
          : [],
    newer: { kind: "end" },
    older: { kind: "end" },
    firstInaccessiblePostTime: 0,
  }));
  account.readPostAnchor.mockImplementation(async (postId) => ({
    postId,
    rootId: postId === reply.id ? root.id : null,
    channelId: design,
    post: postId === reply.id ? linkedReply : root,
  }));
  account.readThreadPage.mockResolvedValue({
    kind: "page",
    root: { ...root, messageSource: undefined, rootId: "", deleteAt: 0 },
    replies: [{ ...linkedReply, messageSource: undefined, deleteAt: 0 }],
    next: null,
  });
  const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
  fireEvent.click(await screen.findByRole("link", { name: "Open reply" }));
  const toRoot = await screen.findByRole("link", { name: "Open root" });
  expect(toRoot.closest(".thread-feed")).toBeTruthy();
  await waitFor(() =>
    expect(document.activeElement).toBe(toRoot.closest("[data-post-id]")),
  );
  // The visible destination can be activated before the next focused-frame receipt.
  hasFocus.mockReturnValue(true);
  fireEvent.click(toRoot);
  await waitFor(() => {
    expect((document.activeElement as HTMLElement).dataset.postId).toBe(
      root.id,
    );
    expect(document.activeElement?.closest(".thread-feed")).toBeNull();
  });
  expect(account.readPostAnchor.mock.calls.map(([id]) => id)).toEqual([
    reply.id,
    root.id,
  ]);
  expect(acks).toEqual([]);
});

test("a focused published link in the incoming destination allows its visible OS receipt and then opens the link", async () => {
  const nativeFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
  queue.push({ id: "1", href: href(root.id) });
  const { account } = boot();
  const linkedRoot = { ...root, message: `[Open reply](${href(reply.id)})` };
  account.readChannelWindow.mockImplementation(async (q) => ({
    posts: q.kind === "around" ? [linkedRoot] : [],
    newer: { kind: "end" },
    older: { kind: "end" },
    firstInaccessiblePostTime: 0,
  }));
  account.readPostAnchor.mockImplementation(async (postId) => ({
    postId,
    rootId: postId === reply.id ? root.id : null,
    channelId: design,
    post: postId === reply.id ? reply : linkedRoot,
  }));

  const link = await screen.findByRole("link", { name: "Open reply" });
  await waitFor(() =>
    expect(document.activeElement).toBe(link.closest("[data-post-id]")),
  );
  await userEvent.setup().click(link);
  expect(document.activeElement).toBe(link);
  expect(acks).toEqual([]);
  expect(account.readPostAnchor.mock.calls.map(([id]) => id)).toEqual([
    root.id,
  ]);

  Object.defineProperty(link, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(0, 550, 50, 20),
  });
  nativeFocus.mockReturnValue(true);
  fireEvent(window, new Event("focus"));
  await act(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  expect(acks).toEqual([]);
  Reflect.deleteProperty(link, "getBoundingClientRect");
  fireEvent.scroll(link);
  await waitFor(() => {
    expect(acks).toEqual([{ id: "1", row: root.id, thread: false }]);
    expect(document.activeElement?.closest(".thread-feed")).toBeTruthy();
    expect((document.activeElement as HTMLElement).dataset.postId).toBe(
      reply.id,
    );
  });
  expect(account.readPostAnchor.mock.calls.map(([id]) => id)).toEqual([
    root.id,
    reply.id,
  ]);
  expect(queue).toEqual([]);
});
