import { type Configuration, UsersApi } from "../../vendor/mattermost/index.js";

export async function readSearchTimezone(
  config: Configuration,
  userId: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const user = await new UsersApi(config).getUser({ userId: "me" }, { signal });
  signal?.throwIfAborted();
  if (user.id !== userId)
    throw new TypeError("Unexpected search profile owner.");
  const timezone = user.timezone;
  const selected =
    timezone?.useAutomaticTimezone === "true"
      ? timezone.automaticTimezone
      : timezone?.manualTimezone;
  if (selected !== undefined && typeof selected !== "string")
    throw new TypeError("Invalid profile timezone.");
  return selected || "UTC";
}

export function searchTimezoneOffsetSeconds(timeZone: string, at = new Date()) {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  })
    .formatToParts(at)
    .find((value) => value.type === "timeZoneName");
  if (part?.value === "GMT") return 0;
  const offset = /^GMT([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    part?.value ?? "",
  );
  if (!offset) throw new RangeError("Unknown timezone offset.");
  const seconds =
    Number(offset[2]) * 3600 + Number(offset[3]) * 60 + Number(offset[4] ?? 0);
  return offset[1] === "-" ? -seconds : seconds;
}
