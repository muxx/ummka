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
import { isMobile } from "../build-platform.ts";
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
            installations: saved,
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

function signInForPendingPost(options: Parameters<typeof boot>[0] = {}) {
  sessions.delete(base);
  queue.push({ id: "first", href: href(root.id) });
  vi.mocked(inspectInstallation).mockResolvedValue({
    serverUrl: base,
    siteName: "Winter",
    version: "10.10.1",
    passwordIdentifiers: [],
    ssoProviders: ["gitlab"],
    guestMagicLink: false,
  });
  vi.mocked(signInWithBrowser).mockImplementationOnce(
    async (_url, _provider, started) => {
      started("signed-link-fixture");
      sessions.set(base, user);
      return user;
    },
  );
  return boot(options);
}

async function openSignInForPost() {
  const provider = await screen.findByRole("button", {
    name: "Sign in with GitLab",
  });
  fireEvent.click(provider);
  return screen.findByRole("heading", { name: "Opening the message" });
}

test("successful linked sign-in shows one stage until the exact post can open", async () => {
  const { account, targetInfo } = signInForPendingPost({ initialTeam: winter });
  let release!: (value: typeof targetInfo) => void;
  account.readPostDestination.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const heading = await openSignInForPost();
  await waitFor(() => expect(release).toBeTypeOf("function"));
  expect(document.activeElement).toBe(heading);
  expect(screen.getByRole("status").textContent).toBe("Waiting for the server");
  expect(screen.getByTitle(base).textContent).toBe("example.test");
  expect(screen.getByText("Winter")).toBeTruthy();
  expect(document.querySelector(".system-post-notice")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Choose a team" })).toBeNull();
  expect(account.readPostAnchor).not.toHaveBeenCalled();
  expect(acks).toEqual([]);
  await act(async () => release(targetInfo));
  await waitFor(() =>
    expect(acks).toEqual([{ id: "first", row: root.id, thread: false }]),
  );
  expect(
    screen.queryByRole("heading", { name: "Opening the message" }),
  ).toBeNull();
});

test("dismissing a signed opening preserves sign-in, discards its late reply and allows the next delivery", async () => {
  const { account, targetInfo } = signInForPendingPost({ initialTeam: null });
  let release!: (value: typeof targetInfo) => void;
  account.readPostDestination.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await openSignInForPost();
  await waitFor(() => expect(release).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: "Don’t open this link" }));
  await screen.findByRole("heading", { name: "Choose a team" });
  expect(sessions.get(base)).toBe(user);
  await act(async () => release(targetInfo));
  expect(account.readPostAnchor).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(acks).toEqual([{ id: "first", row: undefined, thread: false }]),
  );
  act(() => enqueue("next", href(reply.id)));
  await waitFor(() => expect(acks.at(-1)?.row).toBe(reply.id));
  expect(acks.map(({ id }) => id)).toEqual(["first", "next"]);
  expect(signInWithBrowser).toHaveBeenCalledOnce();
});

test("offline signed opening retries the same pending delivery only after the user acts", async () => {
  let online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  const { account, targetInfo } = signInForPendingPost();
  let release!: (value: typeof targetInfo) => void;
  account.readPostDestination.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await openSignInForPost();
  await waitFor(() => expect(release).toBeTypeOf("function"));
  online = false;
  act(() => window.dispatchEvent(new Event("offline")));
  const retry = await screen.findByRole("button", { name: "Retry" });
  expect(document.activeElement).toBe(
    isMobile
      ? screen.getByRole("heading", { name: "Opening the message" })
      : retry,
  );
  expect(screen.getByRole("alert").textContent).toContain("You’re offline.");
  expect(
    screen.getByRole("button", { name: "Don’t open this link" }),
  ).toBeTruthy();
  expect(acks).toEqual([]);
  online = true;
  act(() => window.dispatchEvent(new Event("online")));
  await act(async () => release(targetInfo));
  expect(account.readPostDestination).toHaveBeenCalledTimes(1);
  expect(account.readPostAnchor).not.toHaveBeenCalled();
  fireEvent.click(retry);
  await waitFor(() =>
    expect(acks).toEqual([{ id: "first", row: root.id, thread: false }]),
  );
  expect(
    account.readPostDestination.mock.calls.map(([postId]) => postId),
  ).toEqual([root.id, root.id]);
  expect(signInWithBrowser).toHaveBeenCalledOnce();
});

test("changing accounts while opening a signed link prevents the old response from opening a post", async () => {
  const { account, targetInfo } = signInForPendingPost({ initialTeam: null });
  let release!: (value: typeof targetInfo) => void;
  let retire!: (cause: unknown) => void;
  account.readPostDestination.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  account.readSavedProfiles.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        retire = reject;
      }),
  );
  await openSignInForPost();
  await waitFor(() => expect(release).toBeTypeOf("function"));
  sessions.set(base, otherUser);
  await act(async () => retire("session_unavailable"));
  await screen.findByText(/linked message is waiting/);
  expect(openAccountRestConnection).toHaveBeenLastCalledWith(base, otherUser);
  await act(async () => release(targetInfo));
  expect(account.readPostAnchor).not.toHaveBeenCalled();
  expect(acks).toEqual([]);
});

test.each(["retry", "decline"] as const)(
  "a signed link shows a confirmed private join and never writes it again on %s",
  async (action) => {
    const { account, targetInfo } = signInForPendingPost();
    const pending = {
      ...targetInfo,
      channel: { ...targetInfo.channel, kind: "P" as const, joined: false },
    };
    account.readPostDestination
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending);
    const loaded = account.readChannelWindow.getMockImplementation();
    account.readChannelWindow.mockResolvedValue(null);
    account.refreshChannelHistory.mockRejectedValue(new TypeError("offline"));
    await openSignInForPost();
    fireEvent.click(
      await screen.findByRole("button", { name: "Join and open" }),
    );
    await screen.findByText("The message couldn’t open");
    expect(screen.getByRole("alert").textContent).toContain(
      "You joined the channel.",
    );
    expect(acks).toEqual([]);
    expect(account.changeOwnMembership).toHaveBeenCalledOnce();
    if (action === "retry") {
      if (!loaded) throw Error("Missing history fixture");
      account.readChannelWindow.mockImplementation(loaded);
      account.refreshChannelHistory.mockResolvedValue(true);
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await waitFor(() =>
        expect(acks).toEqual([{ id: "first", row: root.id, thread: false }]),
      );
    } else {
      fireEvent.click(
        screen.getByRole("button", { name: "Don’t open this link" }),
      );
      await waitFor(() =>
        expect(acks).toEqual([{ id: "first", row: undefined, thread: false }]),
      );
      expect(sessions.get(base)).toBe(user);
    }
    expect(account.changeOwnMembership).toHaveBeenCalledOnce();
  },
);

test.each([false, true])(
  "declining a signed DM’s required team chooser releases its scope (%s)",
  async (queued) => {
    const { account, targetInfo } = signInForPendingPost({
      direct: true,
      initialTeam: null,
    });
    const direct = {
      postId: root.id,
      channel: {
        id: design,
        kind: "D" as const,
        displayName: "",
        joined: true,
      },
      team: null,
    };
    let release!: (value: typeof direct) => void;
    account.readPostDestination.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await openSignInForPost();
    await waitFor(() => expect(release).toBeTypeOf("function"));
    await act(async () => release(direct));
    await screen.findByRole("button", { name: "Summer" });
    expect(acks).toEqual([]);
    expect(account.readPostAnchor).not.toHaveBeenCalled();
    let next!: (value: typeof targetInfo) => void;
    if (queued) {
      account.readPostDestination.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            next = resolve;
          }),
      );
      act(() => enqueue("next", href(reply.id)));
    }
    fireEvent.click(
      screen.getByRole("button", { name: "Don’t open this link" }),
    );
    await waitFor(() =>
      expect(acks).toEqual([{ id: "first", row: undefined, thread: false }]),
    );
    expect(account.selectJoinedTeam).not.toHaveBeenCalled();
    if (queued) {
      await waitFor(() => expect(next).toBeTypeOf("function"));
      expect(screen.queryByRole("button", { name: "Summer" })).toBeNull();
      await act(async () =>
        next({
          ...targetInfo,
          postId: reply.id,
          team: { id: winter, kind: "O", displayName: "Winter", joined: true },
        }),
      );
      await waitFor(() => expect(acks.at(-1)?.row).toBe(reply.id));
      expect(acks.map(({ id }) => id)).toEqual(["first", "next"]);
    } else {
      expect(document.querySelector(".entry-first-team-options")).toBeTruthy();
    }
  },
);
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
