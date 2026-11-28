import { invoke } from "@tauri-apps/api/core";
import {
  type DraftLocation,
  openAccountRestConnection,
} from "../../src/mattermost/native-rest.ts";
import { fixtureDeadline } from "./fixture-step.ts";

type Account = Awaited<ReturnType<typeof openAccountRestConnection>>;
type Workspace = Awaited<ReturnType<Account["openDraftFileWorkspace"]>>;
type Upload = Awaited<ReturnType<Workspace["startUpload"]>>["upload"];
type Control = (step: string, name: string) => Promise<void>;
const channel = { channelId: "draftfileworkspace".padEnd(26, "0") };
const otherChannel = { channelId: "draftfileworkspaceother".padEnd(26, "0") };
const thread = { ...channel, rootId: "y".repeat(26) };
const allowed = { kind: "allowed", maxFileBytes: "9007199254740993" } as const;

function check(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}

function failure(pending: Promise<unknown>) {
  return pending.then(
    () => undefined,
    (error: unknown) => error,
  );
}

async function rejects(pending: Promise<unknown>, expected: string) {
  const error = await failure(pending);
  check(error === expected, `expected ${expected}, received ${String(error)}`);
}

function prepare(
  choice: "pair" | "retry" | "denied" | "heldUpload" | "cancel" | "heldPicker",
) {
  return invoke<void>("prepare_draft_picker_fixture", { choice });
}

function waitForUpload<K extends Upload["kind"]>(
  workspace: Workspace,
  draft: DraftLocation,
  id: string,
  kind: K,
): Promise<Extract<Upload, { kind: K }>> {
  return fixtureDeadline(`draft upload ${kind}`, async () => {
    for (;;) {
      const state = (await workspace.read(draft)).files.find(
        (file) => file.id === id,
      )?.upload;
      check(state, "the native draft file disappeared");
      if (state.kind === kind) return state as Extract<Upload, { kind: K }>;
      check(state.kind !== "failed", `upload failed waiting for ${kind}`);
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  });
}

export async function checkDraftFileWorkspace(
  account: Account,
  other: Account,
  anonymousRid: number,
  userId: string,
  control: Control,
) {
  await rejects(
    invoke("open_draft_file_workspace", { rid: anonymousRid }),
    "account_unavailable",
  );
  const handle = await invoke<number>("open_draft_file_workspace", {
    rid: account.rid,
  });
  await rejects(
    invoke("read_draft_files", {
      rid: other.rid,
      workspace: handle,
      draft: channel,
    }),
    "unknown_workspace",
  );
  await invoke("close_draft_file_workspace", {
    rid: account.rid,
    workspace: handle,
  });

  const workspace = await account.openDraftFileWorkspace();
  const peer = await account.openDraftFileWorkspace();
  await rejects(
    workspace.choose(channel, { kind: "denied" }),
    "permission_denied",
  );
  await rejects(
    workspace.choose(channel, { kind: "unknown" }),
    "policy_unavailable",
  );
  await rejects(
    workspace.choose(channel, {
      kind: "allowed",
      maxFileBytes: "9223372036854775808",
    }),
    "invalid_upload_policy",
  );
  await prepare("pair");
  const none = await workspace.choose(channel, {
    kind: "allowed",
    maxFileBytes: "0",
  });
  check(
    none.length === 2 && none.every((result) => result.kind === "tooLarge"),
    "zero byte limit",
  );
  await prepare("cancel");
  await rejects(workspace.choose(channel, allowed), "cancelled");
  check(
    (await workspace.read(channel)).files.length === 0,
    "cancel retained a selection",
  );

  await prepare("pair");
  const [slow, fast] = await workspace.choose(channel, allowed);
  check(
    slow?.kind === "added" && fast?.kind === "added",
    "both documents must be selected",
  );
  check(
    slow.file.document.name === "bridge-slow.txt" &&
      fast.file.document.name === "bridge-fast.txt",
    "selection order",
  );
  check(
    Object.keys(slow.file).sort().join(",") === "document,id,upload",
    "unexpected native data",
  );
  check(
    slow.file.document.size === "11" && slow.file.upload.kind === "selected",
    "selected snapshot",
  );
  const ordered = [slow.file.id, fast.file.id];
  check(
    (await workspace.read(thread)).files.length === 0 &&
      (await peer.read(channel)).files.length === 0,
    "draft identity leaked",
  );
  await rejects(
    peer.startUpload(channel, slow.file.id, allowed),
    "unknown_file",
  );
  await rejects(
    workspace.startUpload(thread, slow.file.id, allowed),
    "unknown_file",
  );
  await peer.close();

  await prepare("retry");
  const [interrupted] = await workspace.choose(thread, allowed);
  check(interrupted?.kind === "added", "retry source must be selected");

  const draft = await account.saveDraft({
    ...channel,
    expectedRevision: null,
    message: "Upload from the signed workspace",
  });
  check(draft.kind === "saved", "text revision must be saved");
  const starting = await workspace.startUpload(channel, slow.file.id, allowed);
  check(
    starting.upload.kind === "reading" && starting.upload.bytesRead === "0",
    "initial upload counter",
  );
  await workspace.startUpload(channel, fast.file.id, allowed);
  await control("received", "bridge-slow-1");
  check(
    (await workspace.read(otherChannel)).files.length === 0,
    "another channel must have its own draft",
  );
  const threadFiles = (await workspace.read(thread)).files;
  check(
    threadFiles.length === 1 &&
      threadFiles[0]?.id === interrupted.file.id &&
      threadFiles[0].upload.kind === "selected",
    "thread selection must remain independent of channel upload",
  );
  const fastReceipt = await waitForUpload(
    workspace,
    channel,
    fast.file.id,
    "ready",
  );
  check(
    fastReceipt.name === "confirmed-fast.txt" && fastReceipt.size === "11",
    "server receipt",
  );
  const slowProgress = await waitForUpload(
    workspace,
    channel,
    slow.file.id,
    "processing",
  );
  check(
    slowProgress.bytesRead === "11",
    "returning to the channel must preserve its in-flight upload and counter",
  );
  await rejects(
    workspace.stage(channel, draft.draft.revision, ordered),
    "files_not_ready",
  );
  await control("release-draft-upload", "bridge-slow-1");
  await waitForUpload(workspace, channel, slow.file.id, "ready");
  check(
    (await workspace.read(channel)).files.map((file) => file.id).join(",") ===
      ordered.join(","),
    "completion order changed the selection",
  );
  await rejects(
    workspace.stage(channel, draft.draft.revision, [...ordered].reverse()),
    "files_changed",
  );
  const staged = await workspace.stage(channel, draft.draft.revision, ordered);
  check(
    staged.kind === "created" && staged.draft.message === "",
    "stage must clear the draft",
  );
  const [row] = await account.readPendingPosts({ ...channel, limit: 1 });
  check(
    row?.pendingId === staged.post.pendingId &&
      row.message === "Upload from the signed workspace" &&
      row.files.map((file) => file.id).join(",") ===
        `${"s".repeat(26)},${"f".repeat(26)}` &&
      row.files[1]?.name === "confirmed-fast.txt",
    "reopening the queue did not preserve the selected receipts",
  );
  await rejects(
    workspace.stage(channel, draft.draft.revision, ordered),
    "files_changed",
  );
  check(
    (await workspace.read(channel)).files.length === 0,
    "queued files still in the draft",
  );

  await workspace.startUpload(thread, interrupted.file.id, allowed);
  const failed = await waitForUpload(
    workspace,
    thread,
    interrupted.file.id,
    "failed",
  );
  check(
    failed.failure.kind === "transport" && failed.failure.canRetry,
    "interrupted transfer must be retryable",
  );
  await workspace.startUpload(thread, interrupted.file.id, allowed);
  await waitForUpload(workspace, thread, interrupted.file.id, "ready");
  const reply = await workspace.stage(thread, null, [interrupted.file.id]);
  check(
    reply.kind === "created" &&
      reply.post.message === "" &&
      reply.post.rootId === thread.rootId,
    "queue a file-only reply",
  );

  await prepare("denied");
  const [refused] = await workspace.choose(thread, allowed);
  check(refused?.kind === "added", "denied source must be selected");
  await workspace.startUpload(thread, refused.file.id, allowed);
  const denial = await waitForUpload(
    workspace,
    thread,
    refused.file.id,
    "failed",
  );
  check(
    denial.failure.kind === "permissionDenied" &&
      !denial.failure.canRetry &&
      denial.failure.status === 403,
    "server denial",
  );
  const marker = (await workspace.read(channel)).channelDenial;
  check(
    marker?.status === 403 &&
      marker.revision ===
        (await workspace.read(thread)).channelDenial?.revision,
    "denial must cover the whole channel",
  );
  await rejects(workspace.choose(channel, allowed), "permission_denied");
  check(
    !(await workspace.confirmUploadPolicy(
      channel,
      "00000000-0000-0000-0000-000000000000",
      allowed,
    )),
    "stale denial was cleared",
  );
  check(
    await workspace.confirmUploadPolicy(thread, marker.revision, allowed),
    "verified upload policy should clear the denial",
  );
  check(
    (await workspace.read(channel)).channelDenial === null,
    "denial remained visible",
  );
  await workspace.remove(thread, refused.file.id);

  await prepare("heldUpload");
  const [removing] = await workspace.choose(channel, allowed);
  check(removing?.kind === "added", "cancellation source must be selected");
  await workspace.startUpload(channel, removing.file.id, allowed);
  await control("received", "bridge-hold-1");
  await workspace.remove(channel, removing.file.id);
  await control("closed", "bridge-hold-1");
  check(
    (await workspace.read(channel)).files.length === 0,
    "cancelled tile survived",
  );

  await prepare("heldPicker");
  const first = failure(workspace.choose(channel, allowed));
  const second = failure(workspace.choose(channel, allowed));
  check(
    (await Promise.race([first, second])) === "busy",
    "the pending picker did not reserve its slot",
  );
  await workspace.close();
  check(
    [await first, await second].includes("cancelled"),
    "workspace close did not cancel the picker",
  );
  await rejects(workspace.read(channel), "unknown_workspace");

  const closing = await openAccountRestConnection(account.basePath, userId);
  const uploading = await closing.openDraftFileWorkspace();
  await prepare("heldUpload");
  const [file] = await uploading.choose(channel, allowed);
  check(file?.kind === "added", "closing connection source must be selected");
  await uploading.startUpload(channel, file.file.id, allowed);
  await control("received", "bridge-hold-2");
  await closing.close();
  await control("closed", "bridge-hold-2");
  await rejects(uploading.read(channel), "unknown_connection");
}
