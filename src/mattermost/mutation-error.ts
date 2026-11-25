import {
  AppErrorFromJSON,
  FetchError,
  ResponseError,
} from "../../vendor/mattermost/index.js";

export type MutationRefusal = {
  status: number;
  code: string;
  message: string | null;
};
type Failure =
  | { kind: "refused"; refusal: MutationRefusal }
  | { kind: "unauthorized" }
  | { kind: "unconfirmed" };

/** Only a matching Mattermost 4xx error confirms that the server refused the mutation. */
export async function mutationFailure(error: unknown): Promise<Failure> {
  if (error instanceof ResponseError) {
    const response = error.response;
    if (
      response.status === 401 ||
      response.status < 400 ||
      response.status >= 500
    ) {
      void response.body?.cancel().catch(() => {});
      return { kind: response.status === 401 ? "unauthorized" : "unconfirmed" };
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: "unconfirmed" };
    }
    const appError = AppErrorFromJSON(body);
    if (
      appError?.statusCode !== response.status ||
      typeof appError.id !== "string" ||
      !appError.id.trim()
    )
      return { kind: "unconfirmed" };
    return {
      kind: "refused",
      refusal: {
        status: response.status,
        code: appError.id,
        message: typeof appError.message === "string" ? appError.message : null,
      },
    };
  }
  if (error instanceof FetchError && error.cause instanceof Error) {
    const reason = error.cause.cause;
    if (
      reason === "cancelled" ||
      reason === "unknown_connection" ||
      reason === "session_unavailable"
    )
      throw reason;
  }
  if (
    error instanceof FetchError ||
    error instanceof SyntaxError ||
    error instanceof TypeError
  )
    return { kind: "unconfirmed" };
  throw error;
}
