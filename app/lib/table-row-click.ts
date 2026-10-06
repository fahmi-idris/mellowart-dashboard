const INTERACTIVE_SELECTOR =
  'a,button,input,select,textarea,label,[role="button"],[role="checkbox"],[role="combobox"],[role="menuitem"],[role="dialog"],[data-row-click-ignore]';

/** React portal events bubble to the row even though their DOM lives elsewhere. */
export function shouldActivateTableRow(
  event: {
    defaultPrevented: boolean;
    target: EventTarget | null;
    currentTarget: Pick<Element, "contains">;
  },
  selectedText = "",
): boolean {
  if (event.defaultPrevented || selectedText) return false;
  const target = event.target as Element | null;
  if (!target || !event.currentTarget.contains(target)) return false;
  return typeof target.closest === "function" && !target.closest(INTERACTIVE_SELECTOR);
}
