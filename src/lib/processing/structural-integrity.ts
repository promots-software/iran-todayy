/** JSON identity is independent of database/object property insertion order. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}
export function structurallyEqual(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}
