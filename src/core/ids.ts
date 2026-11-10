/** Short, unique, readable-enough IDs like "lo-mh3k2x9a-4f7q". */
export function newId(): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `lo-${time}-${rand}`;
}
