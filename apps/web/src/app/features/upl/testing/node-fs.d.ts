/** Минимальные объявления для spec-ов, читающих исходники с диска; в проекте нет @types/node. */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readdirSync(path: string, options: { recursive: true }): string[];
}
