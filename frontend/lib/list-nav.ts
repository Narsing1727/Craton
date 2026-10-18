// j / k to move through a list of rows, like Gmail and Linear. A row's main link carries
// data-list-item; moving "selects" it by focusing that link, so Enter opens it, Tab carries on from
// there, and screen readers announce it. No separate selection state to keep in step.

export const LIST_ITEM = "[data-list-item]";

/** The row link to focus after pressing j (forward) or k (back); null when there is no list on the page. */
export function nextListItem(direction: 1 | -1, root: ParentNode = document, active: Element | null = document.activeElement): HTMLElement | null {
  const items = [...root.querySelectorAll<HTMLElement>(LIST_ITEM)].filter((el) => el.offsetParent !== null);
  if (!items.length) return null;
  const at = active ? items.indexOf(active as HTMLElement) : -1;
  if (at === -1) return direction === 1 ? items[0] : items[items.length - 1]; // nothing selected yet: start at the top (j) or bottom (k)
  return items[Math.min(items.length - 1, Math.max(0, at + direction))];
}
