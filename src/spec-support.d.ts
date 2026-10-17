// Minimal node typings for file-based specs — the project ships no
// @types/node; vitest resolves the real builtins at runtime.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
declare const process: { cwd(): string };
