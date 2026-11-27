import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PublishedPostBody } from "../channels/PublishedPostBody";
import { PublishedLinkNavigation } from "../channels/PublishedPostLink";
import { openExternalPostLink } from "../mattermost/external-post-link";
import {
  listInstallations,
  readInstallationSelection,
  selectInstallation,
} from "../mattermost/installation-registry";
import { getCurrentAccountId } from "../mattermost/native-rest";
import { watchSystemChannelsLinks } from "../mattermost/system-channels-links";
import { useSystemPermalink } from "./use-system-permalink";

vi.mock("../mattermost/external-post-link");
vi.mock("../mattermost/native-rest");
vi.mock("../mattermost/installation-registry");
vi.mock("../mattermost/system-channels-links");

const server = "https://community.example/mm";
const nested = server + "/other";
const post = "p".repeat(26);
const message = `[**post**](/mm/team/pl/${post}) [outside](https://web.example/page?q=x#fragment) [mail](mailto:user@example.org) [![picture](https://images.example/a.png)](/mm/other/team/pl/${post}) [bad](file:///private/test)`;
const reopen = vi.fn();
let receive: Parameters<typeof watchSystemChannelsLinks>[0];
let osLife: AbortSignal;
let reportInboxError: Parameters<typeof watchSystemChannelsLinks>[1];
const dismissInbox = vi.fn();
function Window({
  show = true,
  body = message,
}: {
  show?: boolean;
  body?: string;
}) {
  const links = useSystemPermalink("en", reopen);
  return (
    <>
      {show && (
        <PublishedLinkNavigation.Provider
          value={{ serverUrl: server, open: links.openPost }}
        >
          <PublishedPostBody message={body} locale="en" authorName="Ada" />
        </PublishedLinkNavigation.Provider>
      )}
      {links.notice(false, false)}
      {links.request && (
        <>
          <button
            type="button"
            onClick={() => links.request?.stop("unavailable")}
          >
            Refuse
          </button>
          <button
            type="button"
            onClick={() => {
              links.request?.shown(post);
            }}
          >
            Show target
          </button>
        </>
      )}
    </>
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listInstallations).mockResolvedValue([server, nested]);
  vi.mocked(readInstallationSelection).mockResolvedValue({
    installations: [server, nested],
    selected: server,
  });
  vi.mocked(getCurrentAccountId).mockResolvedValue("user");
  vi.mocked(watchSystemChannelsLinks).mockImplementation(
    async (navigate, _error, signal, observers) => {
      receive = navigate;
      reportInboxError = _error;
      osLife = signal;
      observers?.onEmpty?.();
      return { retry: vi.fn(), dismiss: dismissInbox };
    },
  );
});
afterEach(cleanup);
test("Tab and Enter activate the exact signed permalink; dismissal restores the link", async () => {
  const user = userEvent.setup();
  render(<Window />);
  const anchor = screen.getByRole("link", { name: "post" });
  expect(anchor.getAttribute("href")).toBe(`${server}/team/pl/${post}`);
  expect(screen.getAllByRole("link")).toHaveLength(4);
  expect(listInstallations).not.toHaveBeenCalled();
  await user.tab();
  expect(document.activeElement).toBe(anchor);
  await user.keyboard("{Enter}");
  await user.click(await screen.findByText("Refuse"));
  await screen.findByText("This message is unavailable.");
  await user.click(screen.getByText("Don’t open this link"));
  expect(document.activeElement).toBe(anchor);
  expect(openExternalPostLink).not.toHaveBeenCalled();
});
test("a linked image routes once through the matching nested installation", async () => {
  render(<Window />);
  const image = screen.getByRole("link", { name: "picture" });
  expect(image.querySelector("a,img")).toBeNull();
  fireEvent.click(image);
  fireEvent.click(image);
  await screen.findByText("Show target");
  expect(selectInstallation).toHaveBeenCalledExactlyOnceWith(nested);
  expect(getCurrentAccountId).toHaveBeenCalledExactlyOnceWith(nested);
  expect(openExternalPostLink).not.toHaveBeenCalled();
});
test("external handler failure offers retry with the original URL and mail skips installation lookup", async () => {
  const user = userEvent.setup();
  vi.mocked(openExternalPostLink)
    .mockRejectedValueOnce("handler_unavailable")
    .mockResolvedValue(undefined);
  render(<Window />);
  await user.click(screen.getByRole("link", { name: "outside" }));
  await screen.findByText("Couldn’t open this link on your device.");
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(vi.mocked(openExternalPostLink).mock.calls).toEqual([
    ["https://web.example/page?q=x#fragment"],
    ["https://web.example/page?q=x#fragment"],
  ]);
  vi.mocked(listInstallations).mockClear();
  await user.click(screen.getByRole("link", { name: "mail" }));
  expect(openExternalPostLink).toHaveBeenLastCalledWith(
    "mailto:user@example.org",
  );
  expect(listInstallations).not.toHaveBeenCalled();
});
test("an OS delivery waits for the source link and is acknowledged only by its own action", async () => {
  render(<Window />);
  fireEvent.click(screen.getByRole("link", { name: "post" }));
  await screen.findByText("Show target");
  const acknowledged = vi.fn();
  await act(async () => {
    void Promise.resolve(
      receive(
        { id: "system", href: "https://unknown.example/", route: null },
        osLife,
      ),
    ).then(acknowledged);
  });
  fireEvent.click(screen.getByText("Show target"));
  await screen.findByText(
    "This link does not match a supported address on a saved server.",
  );
  expect(acknowledged).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Don’t open this link"));
  await waitFor(() => expect(acknowledged).toHaveBeenCalledOnce());
});
test("a source removed while routing cannot open an external application", async () => {
  let finishLookup!: (saved: string[]) => void;
  vi.mocked(listInstallations).mockReturnValue(
    new Promise((resolve) => {
      finishLookup = resolve;
    }),
  );
  const view = render(<Window />);
  fireEvent.click(screen.getByRole("link", { name: "post" }));
  view.rerender(<Window show={false} />);
  await act(async () => finishLookup([]));
  expect(openExternalPostLink).not.toHaveBeenCalled();
  expect(selectInstallation).not.toHaveBeenCalled();
});
test("superseding a pending source never restores its focus after the next link succeeds", async () => {
  let finishLookup!: (saved: string[]) => void;
  vi.mocked(listInstallations).mockReturnValueOnce(
    new Promise((resolve) => {
      finishLookup = resolve;
    }),
  );
  render(<Window />);
  fireEvent.click(screen.getByRole("link", { name: "picture" }));
  await waitFor(() => expect(listInstallations).toHaveBeenCalledOnce());
  const next = screen.getByRole("link", { name: "post" });
  next.focus();
  fireEvent.click(next);
  fireEvent.click(await screen.findByText("Show target"));
  await act(async () => finishLookup([]));
  expect(document.activeElement).toBe(next);
  expect(openExternalPostLink).not.toHaveBeenCalled();
});
test("an inbox read failure survives opening and dismissing a post link", async () => {
  render(<Window />);
  act(() => reportInboxError("read_failed", "native-id"));
  await screen.findByText("Couldn’t process the incoming link.");
  fireEvent.click(screen.getByRole("link", { name: "post" }));
  await screen.findByText("Show target");
  fireEvent.click(screen.getByText("Refuse"));
  await screen.findByText("This message is unavailable.");
  fireEvent.click(screen.getByText("Don’t open this link"));
  await screen.findByText("Couldn’t process the incoming link.");
  expect(dismissInbox).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Don’t open this link"));
  expect(dismissInbox).toHaveBeenCalledExactlyOnceWith("native-id");
});

test.each([
  "/mm/team/channels/design",
  "/mm/team/messages/@alice",
  "/mm/team/threads",
])(
  "a recognized route %s stays inside the app even while its destination is unsupported",
  async (href) => {
    render(<Window body={`[destination](${href})`} />);
    const link = screen.getByRole("link", { name: "destination" });
    fireEvent.click(link);
    await screen.findByText("This type of link is not supported yet.");
    fireEvent.click(
      screen.getByRole("button", { name: "Don’t open this link" }),
    );
    expect(document.activeElement).toBe(link);
    expect(openExternalPostLink).not.toHaveBeenCalled();
  },
);

test("a registry read failure does not hand the link to the operating system", async () => {
  vi.mocked(listInstallations).mockRejectedValue("storage");
  render(<Window />);
  fireEvent.click(screen.getByRole("link", { name: "post" }));
  await screen.findByText("Couldn’t open the linked message.");
  expect(openExternalPostLink).not.toHaveBeenCalled();
});
