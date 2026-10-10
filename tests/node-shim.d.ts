/** The few Node functions the tests use (the project does not install @types/node). */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
