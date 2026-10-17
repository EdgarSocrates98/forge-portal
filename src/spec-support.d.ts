// Minimal node typings for file-based specs — the project ships no
// @types/node; vitest resolves the real builtins at runtime.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readdirSync(path: string): string[];
  export function readdirSync(
    path: string,
    opts: { withFileTypes: true },
  ): { name: string; isDirectory(): boolean; isFile(): boolean }[];
  export function statSync(path: string): { isDirectory(): boolean; isFile(): boolean };
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
declare const process: { cwd(): string };
