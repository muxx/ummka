import "./empty-link-inbox.test-utils";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ResponseError } from "../vendor/mattermost/index.js";
import { isMobile } from "./build-platform";
import { entryLanguage } from "./entry/language";
import { ServerSignIn } from "./entry/ServerSignIn";
import { getDeviceLaunchContext } from "./mattermost/device-launch";
import {
  InstallationAddressError,
  inspectInstallation,
} from "./mattermost/inspect-installation";
import { connectInstallation } from "./mattermost/installation-registry";

vi.mock("./mattermost/inspect-installation", async (original) => ({
  ...(await original<typeof import("./mattermost/inspect-installation")>()),
  inspectInstallation: vi.fn(),
}));

vi.mock("./mattermost/installation-registry", () => ({
  connectInstallation: vi.fn(),
}));
vi.mock("./mattermost/device-launch", () => ({
  getDeviceLaunchContext: vi.fn(),
}));
const changed = vi.fn();
const inspect = vi.mocked(inspectInstallation);
const profile: Awaited<ReturnType<typeof inspectInstallation>> = {
  serverUrl: "https://chat.example.org/Team",
  siteName: "Северное сияние",
  version: "10.10.1",
  passwordIdentifiers: [],
  ssoProviders: ["gitlab"],
  guestMagicLink: false,
};
beforeEach(() => {
  inspect.mockReset();
  vi.mocked(connectInstallation).mockReset().mockResolvedValue();
  vi.mocked(getDeviceLaunchContext)
    .mockReset()
    .mockResolvedValue({
      status: "sign_in_required",
      serverUrl: profile.serverUrl,
      installations: [profile.serverUrl],
    });
  changed.mockReset();
});
afterEach(cleanup);

function enter(address: string) {
  const field = screen.getByRole<HTMLInputElement>("textbox");
  fireEvent.change(field, { target: { value: address } });
  const form = field.form;
  if (!form) throw Error("missing connection form");
  fireEvent.submit(form);
  return { field, form };
}

test("opens offline in the preferred supported language", () => {
  expect(entryLanguage(["de", "ru-RU", "en"])).toBe("ru");
  expect(entryLanguage(["en-US", "ru"])).toBe("en");
  expect(entryLanguage(["fr-FR"])).toBe("en");
  render(
    <ServerSignIn
      connect={connectInstallation}
      onAccountChanged={changed}
      language="ru"
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Подключите сервер Mattermost" }),
  ).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Адрес сервера" })).toBeTruthy();
  expect(inspect).not.toHaveBeenCalled();
});

test("submits once, shows only the verified methods and restores the typed address on Back", async () => {
  let finish!: (value: typeof profile) => void;
  inspect.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <ServerSignIn
      connect={connectInstallation}
      onAccountChanged={changed}
      language="en"
    />,
  );
  const { field, form } = enter("Chat.example.org/Team/");
  expect(field.readOnly).toBe(true);
  expect(
    screen
      .getByRole("button", { name: "Checking…" })
      .getAttribute("aria-disabled"),
  ).toBe("true");
  fireEvent.submit(form);
  expect(inspect).toHaveBeenCalledTimes(1);
  expect(inspect.mock.calls[0][0]).toBe("Chat.example.org/Team/");
  await act(async () => finish(profile));
  const heading = screen.getByRole("heading", {
    name: "How would you like to sign in?",
  });
  const provider = screen.getByRole("button", { name: "Sign in with GitLab" });
  expect(document.activeElement).toBe(isMobile ? heading : provider);
  expect(screen.getByText(profile.siteName)).toBeTruthy();
  expect(screen.getByTitle(profile.serverUrl).textContent).toBe(
    "chat.example.org/Team",
  );
  expect(provider.getAttribute("aria-describedby")).toBe(
    screen.getByText(/opens in your browser/).id,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Change server address" }),
  );
  const restored = screen.getByRole<HTMLInputElement>("textbox");
  expect(restored.value).toBe("Chat.example.org/Team/");
  expect(document.activeElement).toBe(restored);
  expect(inspect).toHaveBeenCalledTimes(1);
});

test.each(["empty", "protocol", "extra-parts", "invalid"] as const)(
  "marks the %s address error and clears it on editing",
  async (issue) => {
    inspect.mockRejectedValueOnce(new InstallationAddressError(issue));
    render(
      <ServerSignIn
        connect={connectInstallation}
        onAccountChanged={changed}
        language="ru"
      />,
    );
    const { field } = enter("http:/chat");
    await screen.findByRole("alert");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toContain("entry-error");
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: "chat" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(field.hasAttribute("aria-invalid")).toBe(false);
  },
);

test.each([
  [new Error("private diagnostic"), "Couldn’t connect."],
  [
    new ResponseError(
      new Response(null, { status: 404 }),
      "private diagnostic",
    ),
    "Mattermost was not found",
  ],
] as const)(
  "keeps the address after a failure and retries on request",
  async (error, message) => {
    inspect.mockRejectedValueOnce(error).mockResolvedValueOnce({
      ...profile,
      siteName: "",
      passwordIdentifiers: ["ldap"],
      ssoProviders: ["office365", "openid", "saml", "google"],
      guestMagicLink: true,
    });
    render(
      <ServerSignIn
        connect={connectInstallation}
        onAccountChanged={changed}
        language="en"
      />,
    );
    const { field, form } = enter("chat.example.org/Team");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(message);
    expect(alert.textContent).not.toContain("private diagnostic");
    expect(field.value).toBe("chat.example.org/Team");
    expect(inspect).toHaveBeenCalledTimes(1);
    fireEvent.submit(form);
    await screen.findByRole("heading", {
      name: "How would you like to sign in?",
    });
    expect(
      screen.getByTitle(profile.serverUrl).previousElementSibling?.textContent,
    ).toBe("chat.example.org");
    expect(
      screen
        .getAllByRole("button")
        .map((item) => item.getAttribute("aria-label") ?? item.textContent),
    ).toEqual([
      "Change server address",
      "Office 365",
      "OpenID Connect",
      "SAML",
      "Google",
      "Cancel",
    ]);
    expect(screen.getAllByText("Unavailable in ummka")).toHaveLength(2);
  },
);

test("reports a server with no methods and cancels an in-flight inspection when the window closes", async () => {
  inspect.mockResolvedValueOnce({ ...profile, ssoProviders: [] });
  const view = render(
    <ServerSignIn
      connect={connectInstallation}
      onAccountChanged={changed}
      language="en"
    />,
  );
  enter("chat/Team");
  expect(
    (await screen.findByText(/no sign-in methods enabled/)).textContent,
  ).toContain("administrator");
  fireEvent.click(
    screen.getByRole("button", { name: "Change server address" }),
  );
  let finish!: (value: typeof profile) => void;
  inspect.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  enter("chat/Other");
  const signal = inspect.mock.calls[1][1];
  view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(profile));
  await waitFor(() => expect(screen.queryByRole("main")).toBeNull());
});
