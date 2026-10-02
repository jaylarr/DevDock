import type { Manager } from '../../shared/contracts';

export interface Manifest {
  name?: string; scripts: Record<string, string>; packageManager?: string;
  dependencies: Record<string, string>; devDependencies: Record<string, string>;
  workspace: boolean;
}
export function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function strings(value: unknown): Record<string, string> {
  return object(value) ? Object.fromEntries(Object.entries(value).filter((pair): pair is [string, string] => typeof pair[1] === 'string')) : {};
}
export function manifest(value: unknown): Manifest {
  if (!object(value)) throw new Error('package.json must contain an object.');
  return { name: typeof value.name === 'string' ? value.name : undefined,
    packageManager: typeof value.packageManager === 'string' ? value.packageManager : undefined,
    scripts: strings(value.scripts), dependencies: strings(value.dependencies), devDependencies: strings(value.devDependencies),
    workspace: Array.isArray(value.workspaces) || object(value.workspaces) };
}
export function packageManager(pkg: Manifest, files: string[]): Manager {
  const declared = pkg.packageManager?.split('@')[0];
  if (declared === 'npm' || declared === 'pnpm' || declared === 'yarn' || declared === 'bun') return declared;
  if (files.includes('pnpm-lock.yaml')) return 'pnpm';
  if (files.includes('yarn.lock')) return 'yarn';
  if (files.includes('bun.lock') || files.includes('bun.lockb')) return 'bun';
  return 'npm';
}
export function framework(pkg: Manifest): string {
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const [key, label] of [['next', 'Next.js'], ['@sveltejs/kit', 'SvelteKit'], ['nuxt', 'Nuxt'], ['astro', 'Astro'],
    ['@angular/core', 'Angular'], ['vite', 'Vite'], ['react', 'React']] as const) {
    if (key in dependencies) return label;
  }
  const script = pkg.scripts.dev ?? '';
  if (/^vite(?:\s|$)/.test(script)) return 'Vite';
  if (/^next\s+dev(?:\s|$)/.test(script)) return 'Next.js';
  return 'Node';
}
