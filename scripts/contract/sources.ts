import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { type Fields, object } from "./objects.ts";

export function readSource(directory: string, file: string): Fields {
  const source: unknown = parse(readFileSync(join(directory, file), "utf8"));
  return object(source, file);
}

export function snapshotSources(directory: string) {
  const parsed = new Map<string, Fields>();
  return (file: string): Fields => {
    let source = parsed.get(file);
    if (!source) {
      source = readSource(directory, file);
      parsed.set(file, source);
    }
    // Each correction or test owns its copy, including nested values.
    return structuredClone(source);
  };
}
