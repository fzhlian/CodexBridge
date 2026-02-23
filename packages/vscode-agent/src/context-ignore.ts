const IGNORED_CONTEXT_BASENAMES = new Set([
  "todolist.txt"
]);

export function isIgnoredContextPath(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.replaceAll("\\", "/").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  const base = normalized.split("/").pop() ?? normalized;
  return IGNORED_CONTEXT_BASENAMES.has(base);
}
