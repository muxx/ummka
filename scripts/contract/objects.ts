export type Fields = Record<string, unknown>;

export function object(value: unknown, name: string): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`Expected OpenAPI object ${name}`);
  return value as Fields;
}
