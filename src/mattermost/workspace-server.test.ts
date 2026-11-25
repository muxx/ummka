import { expect, test, vi } from "vitest";
import { Configuration } from "../../vendor/mattermost/index.js";
import { loadWorkspaceServerPolicy } from "./workspace-server.ts";

const basePath = "https://chat.example.test/teams/north";
test("projects only display policy from the old config and license endpoints", async () => {
  const fetchApi = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    expect(url.search).toBe("?format=old");
    const data = url.pathname.endsWith("/config/client")
      ? {
          CollapsedThreads: "always_on",
          ExperimentalGroupUnreadChannels: "default_on",
          TeammateNameDisplay: "full_name",
          LockTeammateNameDisplay: "true",
          Secret: "excluded",
        }
      : { LockTeammateNameDisplay: "false", Company: "excluded" };
    return Response.json(data);
  });
  const policy = await loadWorkspaceServerPolicy(
    new Configuration({ basePath, fetchApi }),
  );
  expect(fetchApi.mock.calls.map(([u]) => String(u)).sort()).toEqual(
    ["config", "license"].map(
      (name) => `${basePath}/api/v4/${name}/client?format=old`,
    ),
  );
  expect(policy).toEqual({
    collapsedThreads: "always_on",
    separateUnreads: true,
    nameFormat: "full_name",
    lockNameFormat: false,
  });
});

test("invalid fields and cancellation both release the outstanding sibling", async () => {
  const pending: AbortSignal[] = [];
  const fetchApi: typeof fetch = async (input, init) => {
    const signal = init?.signal;
    if (!signal) throw Error("missing signal");
    pending.push(signal);
    if (String(input).includes("/config/"))
      return Response.json({ CollapsedThreads: false });
    return new Promise((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      }),
    );
  };
  await expect(
    loadWorkspaceServerPolicy(new Configuration({ basePath, fetchApi })),
  ).rejects.toThrow(TypeError);
  expect(pending.length).toBe(2);
  expect(pending[1].aborted).toBe(true);
  const controller = new AbortController();
  const reason = Error("left account");
  controller.abort(reason);
  await expect(
    loadWorkspaceServerPolicy(
      new Configuration({ basePath, fetchApi }),
      controller.signal,
    ),
  ).rejects.toBe(reason);
  expect(pending.length).toBe(2);
});
