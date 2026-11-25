import type { Preference } from "../../vendor/mattermost/index.js";

const idPattern = /^[A-Za-z0-9]{26}$/u;

export function isMattermostId(value: unknown): value is string {
  return (
    typeof value === "string" && value.length === 26 && idPattern.test(value)
  );
}

export function isMattermostTime(
  value: unknown,
  minimum: number,
): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
  );
}

export function assertAccountPreference(
  row: Preference,
  userId: string,
): asserts row is Required<Preference> {
  if (
    row.userId !== userId ||
    typeof row.category !== "string" ||
    typeof row.name !== "string" ||
    typeof row.value !== "string"
  ) {
    throw new TypeError("Invalid Mattermost account preference.");
  }
}
