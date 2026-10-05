import { isTheme, type Theme } from './contracts';

export interface AppSettings {
  appearance: { theme: Theme; pageSize: 5 | 10 | 20; density: 'standard' | 'compact' };
  discovery: { scanOnLaunch: boolean; externalActivity: boolean };
  behavior: { autoOpenBrowser: boolean; rememberLastFilter: boolean; logAutoScroll: boolean };
}
export type SettingsPatch = { [K in keyof AppSettings]?: Partial<AppSettings[K]> };
export const projectFilters = ['all', 'pinned', 'recent', 'running', 'stopped', 'errors'] as const;
export type ProjectFilter = typeof projectFilters[number];
export type SavedFilter = { kind: 'status'; value: ProjectFilter } | { kind: 'root'; rootId: string };
export const allFilter = (): SavedFilter => ({ kind: 'status', value: 'all' });
export const defaultSettings = (): AppSettings => ({
  appearance: { theme: 'system', pageSize: 10, density: 'standard' }, discovery: { scanOnLaunch: true, externalActivity: true },
  behavior: { autoOpenBrowser: false, rememberLastFilter: false, logAutoScroll: true },
});
export function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function onlyKeys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('Unknown settings field.');
}
export function patchSettings(current: AppSettings, input: unknown): AppSettings {
  if (!record(input)) throw new Error('Invalid settings patch.');
  onlyKeys(input, ['appearance', 'discovery', 'behavior']);
  const next = structuredClone(current);
  for (const group of ['appearance', 'discovery', 'behavior'] as const) {
    const patch = input[group]; if (patch === undefined) continue;
    if (!record(patch)) throw new Error(`Invalid ${group} settings.`);
    onlyKeys(patch, Object.keys(next[group]));
    for (const [key, value] of Object.entries(patch)) {
      const valid = key === 'theme' ? isTheme(value) : key === 'pageSize' ? [5, 10, 20].includes(Number(value)) && typeof value === 'number'
        : key === 'density' ? ['standard', 'compact'].includes(String(value)) && typeof value === 'string' : typeof value === 'boolean';
      if (!valid) throw new Error(`Invalid setting: ${key}.`);
      Object.assign(next[group], { [key]: value });
    }
  }
  return next;
}
export function readSettings(input: unknown, repair = false): { settings: AppSettings; repaired: boolean } {
  const defaults = defaultSettings();
  if (!repair) {
    if (!record(input) || Object.keys(input).length !== 3) throw new Error('Incomplete settings.');
    for (const group of Object.keys(defaults) as (keyof AppSettings)[]) {
      const values = input[group];
      if (!record(values) || Object.keys(defaults[group]).some((key) => !(key in values) && !(group === 'discovery' && key === 'externalActivity'))) throw new Error('Incomplete settings.');
    }
    return { settings: patchSettings(defaults, input), repaired: false };
  }
  let settings = defaults; let repaired = false;
  for (const group of Object.keys(defaults) as (keyof AppSettings)[]) {
    for (const key of Object.keys(defaults[group])) {
      const value = record(input) && record(input[group]) ? input[group][key] : undefined;
      try { settings = patchSettings(settings, { [group]: { [key]: value } }); }
      catch { repaired = true; }
    }
  }
  return { settings, repaired };
}
export function filterFromString(value: unknown, rootIds: string[]): SavedFilter {
  if (typeof value !== 'string') throw new Error('Invalid project filter.');
  if (projectFilters.some((filter) => filter === value)) return { kind: 'status', value: value as ProjectFilter };
  if (rootIds.includes(value)) return { kind: 'root', rootId: value };
  throw new Error('Project filter no longer exists.');
}
export function filterString(value: SavedFilter): string { return value.kind === 'root' ? value.rootId : value.value; }

export interface ImportPreview {
  token: string; settings: AppSettings; preferencesChanged: string[];
  discovery?: { roots: { path: string; available: boolean }[]; exclusions: string[]; added: number; removed: number; cached: number };
}
export interface RuntimeCheck { status: 'available' | 'unavailable'; version?: string; code?: string }
export interface Diagnostics {
  reportId: string; version: string; platform: string; arch: string; electron: string; node: RuntimeCheck; npm: RuntimeCheck;
  sharing: RuntimeCheck; schema: number; recovered: boolean; roots: number; projects: number; active: number; previews: number;
  scan: string; report: string;
}
