import { FetchError, ResponseError } from "../../vendor/mattermost/index.js";

type Step =
  | "teams"
  | "memberships"
  | "preferences"
  | "sidebar"
  | "begin"
  | "publish"
  | "select"
  | "snapshot";
type Field =
  | "teams.row"
  | "memberships.row"
  | "preferences.owner"
  | "preferences.fields"
  | "sidebar.direct-id"
  | "sidebar.group-id"
  | "sidebar.limit"
  | "sidebar.time-value";

export class DirectoryValueError extends TypeError {
  readonly field: Field;
  constructor(field: Field, message: string) {
    super(message);
    this.field = field;
  }
}
class DirectoryStepError extends Error {
  readonly step: Step;
  constructor(step: Step, cause: unknown) {
    super(step, { cause });
    this.step = step;
  }
}

function releaseErrorBody(error: ResponseError) {
  if (!error.response.bodyUsed)
    void error.response.body?.cancel().catch(() => {});
}

export async function atDirectoryStep<T>(
  step: Step,
  operation: () => T | Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    // A failed sibling may finish after Promise.all has already rejected.
    if (cause instanceof ResponseError) releaseErrorBody(cause);
    throw new DirectoryStepError(step, cause);
  }
}

type Problem = {
  issue: "storage" | "network" | "server" | "data" | "failed";
  code: string;
};

// The support code contains only constants from the client and the HTTP status.
export function directoryProblem(
  error: unknown,
): Problem | "session" | "unauthorized" {
  const step = error instanceof DirectoryStepError ? error.step : "directory";
  const original = error instanceof DirectoryStepError ? error.cause : error;
  if (original instanceof ResponseError) {
    releaseErrorBody(original);
    const status = original.response.status;
    if (status === 401) return "unauthorized";
    return { issue: "server", code: `${step}.http-${status}` };
  }
  if (original instanceof DirectoryValueError)
    return { issue: "data", code: original.field };
  const native = original instanceof FetchError ? original.cause : original;
  const reason = native instanceof TypeError ? native.cause : native;
  switch (reason) {
    case "session_unavailable":
    case "cancelled":
    case "unknown_connection":
      return "session";
    case "network":
      return { issue: "network", code: `${step}.network` };
    case "history_storage_unavailable":
    case "credential_storage_unavailable":
    case "invalid_stored_credential":
      return { issue: "storage", code: `${step}.${reason}` };
    case "invalid_directory":
      return { issue: "data", code: `${step}.invalid` };
    case "redirect":
    case "operation_denied":
    case "outside_installation":
    case "cleartext_denied":
    case "ipc":
    case "unknown_directory_load":
    case "invalid_exchange_state":
    case "unknown_exchange":
      return { issue: "failed", code: `${step}.${reason}` };
  }
  if (original instanceof SyntaxError)
    return { issue: "data", code: `${step}.json` };
  if (original instanceof TypeError && step !== "begin" && step !== "publish")
    return { issue: "data", code: `${step}.format` };
  return { issue: "failed", code: `${step}.failed` };
}
