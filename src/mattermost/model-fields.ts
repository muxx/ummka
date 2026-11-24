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
