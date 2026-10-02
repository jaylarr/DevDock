import path from 'node:path';

export const staticMime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf',
};
const privateNames = /^(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock|bun\.lockb?|(?:tsconfig|jsconfig)(?:\.[^.]+)?\.json|.*\.(?:config|lock)\.[^.]+|(?:config|credentials|secrets?)(?:\.[^.]+)?|.*\.(?:pem|key|p12|pfx))$/i;
export function publicSegments(segments: string[]): boolean {
  return segments.every((segment) => !!segment && segment !== '.' && segment !== '..' && !segment.startsWith('.') &&
    !/[\\:\x00-\x1f]/.test(segment) && !/[. ]$/.test(segment) &&
    !/^(?:node_modules|vendor|dist|build|coverage|out|con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment) && !privateNames.test(segment));
}
export function validEntry(value: unknown): value is string {
  return typeof value === 'string' && !/[\/\\]/.test(value) && publicSegments([value]) && /\.html?$/i.test(value);
}
export function entryPage(files: string[]): string | undefined {
  const candidates = files.filter(validEntry).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en') || a.localeCompare(b, 'en'));
  return candidates.find((file) => file.toLowerCase() === 'index.html') ?? candidates.find((file) => file.toLowerCase() === 'index.htm') ?? candidates[0];
}
export function publicFile(filename: string): boolean { return !!staticMime[path.extname(filename).toLowerCase()]; }
