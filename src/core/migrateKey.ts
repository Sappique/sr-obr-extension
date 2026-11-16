/**
 * The extension's earlier metadata keys looked like "<a>.<b>.vtt/<name>"; they
 * are recognised by that shape, so the old name doesn't need to be in the code.
 */
export const NAMESPACE = "sappique.sr-obr";
const OLD_KEY = /^[a-z0-9-]+\.[a-z0-9-]+\.vtt\/(.+)$/;

/** New key for an old one, or null. */
export function migratedKey(key: string): string | null {
  const m = OLD_KEY.exec(key);
  return m ? `${NAMESPACE}/${m[1]}` : null;
}
