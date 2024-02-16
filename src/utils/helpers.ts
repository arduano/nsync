import path from "path";

export function exists<T>(value: T | undefined | null): value is T {
  return value != null;
}

export function ensurePathAbsolute(pathname: string) {
  if (path.isAbsolute(pathname)) {
    return pathname;
  }

  return path.resolve(pathname);
}

export function unreachable(x: never): never {
  throw new Error("Unreachable");
}

type MappedTuple<T extends readonly any[], F extends (arg: any) => any> = {
  [P in keyof T]: F extends (arg: T[P]) => infer R ? R : never;
};

export function mapTuple<T extends readonly any[], F extends (arg: any) => any>(
  tuple: readonly [...T],
  mapFn: F,
): MappedTuple<T, F> {
  return tuple.map(mapFn) as MappedTuple<T, F>;
}
