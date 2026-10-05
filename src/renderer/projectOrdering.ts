import type { Project } from '../shared/contracts';

export function recentProjects(projects: Project[]): Project[] {
  return projects.filter((project) => project.lastActiveAt).sort((a, b) =>
    Date.parse(b.lastActiveAt!) - Date.parse(a.lastActiveAt!) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).slice(0, 10);
}

export function orderUnpinned(projects: Project[], recentIds: Set<string>): Project[] {
  return projects.filter((project) => !project.pinned).sort((a, b) => {
    const aRecent = recentIds.has(a.id), bRecent = recentIds.has(b.id);
    return Number(bRecent) - Number(aRecent) || (aRecent && bRecent ? Date.parse(b.lastActiveAt!) - Date.parse(a.lastActiveAt!) : 0)
      || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}
