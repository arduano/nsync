import path from "path";
import fs from "fs";

export function exists<T>(value: T | undefined | null): value is T {
  return value != null;
}

export function ensurePathAbsolute(pathname: string) {
  if (path.isAbsolute(pathname)) {
    return pathname;
  }

  return path.resolve(pathname);
}
