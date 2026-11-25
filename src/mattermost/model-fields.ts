import type { Preference } from "../../vendor/mattermost/index.js";

import { DirectoryValueError } from "./account-directory-error.ts";

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
    !row ||
    typeof row.category !== "string" ||
    typeof row.name !== "string" ||
    typeof row.value !== "string"
  ) {
    throw new DirectoryValueError(
      "preferences.fields",
      "Invalid Mattermost account preference.",
    );
  }
  if (row.userId !== userId)
    throw new DirectoryValueError(
      "preferences.owner",
      "Invalid Mattermost account preference owner.",
    );
}
