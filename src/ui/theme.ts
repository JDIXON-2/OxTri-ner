/** Read a colour token from the stylesheet so charts (canvas) match the CSS theme. */
export function cssVar(name: string, fallback = '#888'): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
