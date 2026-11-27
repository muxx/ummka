import type { savedChannelPermissions } from "../mattermost/channel-permissions.ts";
import type { TeamSidebar } from "../mattermost/team-sidebar.ts";
import type { ServerPolicy } from "../mattermost/workspace-preferences.ts";

type Channel = Pick<TeamSidebar["data"]["channels"][number], "kind" | "roles">;

type UploadCapability =
  | { kind: "denied" | "unknown" }
  | {
      kind: "allowed";
      maxFileBytes: string;
      checkSize(
        bytes: bigint | null,
      ): "withinLimit" | "tooLarge" | "unmeasured";
    };

export function channelUploadCapability(
  server: Pick<ServerPolicy, "fileUpload"> | null | undefined,
  permission: ReturnType<typeof savedChannelPermissions>,
  channel?: Channel,
): UploadCapability {
  const policy = server?.fileUpload;
  if (!policy) return { kind: "unknown" };
  if (policy.kind === "disabled") return { kind: "denied" };
  const grant = permission(channel, "upload_file");
  if (grant !== "allowed") return { kind: grant };

  const limit = BigInt(policy.maxFileBytes);
  return {
    kind: "allowed",
    maxFileBytes: policy.maxFileBytes,
    checkSize(bytes) {
      if (bytes === null) return "unmeasured";
      return bytes > limit ? "tooLarge" : "withinLimit";
    },
  };
}
