export type GitRev = {
  kind: "rev";
  value: string;
};

export type GitRef = {
  kind: "ref";
  value: string;
};

export type GitPointer = GitRev | GitRef;

const possibleGitRev = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;

export function looksLikeGitRev(value: string): boolean {
  return possibleGitRev.test(value);
}

export function makeGitRev(value: string): GitRev {
  return { kind: "rev", value };
}

export function makeGitRef(value: string): GitRef {
  return { kind: "ref", value };
}

export function parseGitPointer(value: string): GitPointer {
  return looksLikeGitRev(value) ? makeGitRev(value) : makeGitRef(value);
}

export function isGitRev(pointer: GitPointer): pointer is GitRev {
  return pointer.kind === "rev";
}

export function isGitRef(pointer: GitPointer): pointer is GitRef {
  return pointer.kind === "ref";
}
