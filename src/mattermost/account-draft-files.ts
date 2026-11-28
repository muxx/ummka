import { invoke } from "@tauri-apps/api/core";
import type { StagePost } from "./account-delivery.ts";
import type { DraftLocation } from "./native-rest.ts";

type UploadPolicy =
  | { kind: "allowed"; maxFileBytes: string }
  | { kind: "denied" | "unknown" };

type Document = { name: string; size: string | null; mimeType: string | null };
type Failure = {
  kind:
    | "permissionDenied"
    | "policyUnavailable"
    | "tooLarge"
    | "sourceUnavailable"
    | "empty"
    | "transport"
    | "server"
    | "invalidFile"
    | "invalidReceipt";
  canRetry: boolean;
  status: number | null;
};
type Transfer =
  | { kind: "selected" }
  | { kind: "reading"; bytesRead: string; length: string | null }
  | { kind: "processing"; bytesRead: string }
  | { kind: "failed"; failure: Failure }
  | { kind: "ready"; id: string; name: string; size: string };
type DraftFile = { id: string; document: Document; upload: Transfer };
type Selection =
  | { kind: "added"; file: DraftFile }
  | { kind: "unavailable" }
  | { kind: "empty" | "tooLarge" | "limitReached"; document: Document };
type Snapshot = {
  files: DraftFile[];
  channelDenial: { revision: string; status: number } | null;
};

function address({ channelId, rootId }: DraftLocation) {
  return { channelId, rootId: rootId ?? null };
}

function uploadPolicy(policy: UploadPolicy): UploadPolicy {
  return policy.kind === "allowed"
    ? { kind: "allowed", maxFileBytes: policy.maxFileBytes }
    : { kind: policy.kind };
}

export async function openDraftFileWorkspace(
  rid: number,
  whileOpen: <T>(operation: () => Promise<T>) => Promise<T>,
) {
  const workspace = await whileOpen(() =>
    invoke<number>("open_draft_file_workspace", { rid }),
  );
  function request<T>(command: string, args?: Record<string, unknown>) {
    return whileOpen(() => invoke<T>(command, { ...args, rid, workspace }));
  }
  return {
    choose(draft: DraftLocation, policy: UploadPolicy) {
      return request<Selection[]>("choose_draft_files", {
        draft: address(draft),
        policy: uploadPolicy(policy),
      });
    },
    read(draft: DraftLocation) {
      return request<Snapshot>("read_draft_files", { draft: address(draft) });
    },
    startUpload(draft: DraftLocation, file: string, policy: UploadPolicy) {
      return request<DraftFile>("start_draft_file_upload", {
        draft: address(draft),
        file,
        policy: uploadPolicy(policy),
      });
    },
    remove(draft: DraftLocation, file: string) {
      return request<void>("remove_draft_file", {
        draft: address(draft),
        file,
      });
    },
    confirmUploadPolicy(
      draft: DraftLocation,
      observedDenial: string,
      policy: UploadPolicy,
    ) {
      return request<boolean>("confirm_draft_file_upload_policy", {
        draft: address(draft),
        observedDenial,
        policy: uploadPolicy(policy),
      });
    },
    stage(
      draft: DraftLocation,
      expectedRevision: string | null,
      selected: readonly string[],
    ) {
      return request<StagePost>("stage_draft_post_with_files", {
        draft: address(draft),
        expectedRevision,
        selected,
      });
    },
    close() {
      return request<void>("close_draft_file_workspace");
    },
  };
}
