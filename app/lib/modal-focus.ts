const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]';

/** Keep keyboard focus in the active dialog and return it to its opener. */
export function containModalFocus(dialog: HTMLElement): () => void {
  const doc = dialog.ownerDocument;
  const opener = doc.activeElement as HTMLElement | null;
  const topmost = () => Array.from(doc.querySelectorAll('[aria-modal="true"]')).at(-1) === dialog;
  const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((node) =>
    node.tabIndex >= 0 && !node.matches(':disabled') && !node.closest('[hidden], [inert]') && node.getClientRects().length > 0,
  );
  const focusFirst = () => (controls()[0] ?? dialog).focus({ preventScroll: true });
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || !topmost()) return;
    const items = controls();
    const at = items.indexOf(doc.activeElement as HTMLElement);
    if (items.length === 0 || at < 0 || (event.shiftKey ? at === 0 : at === items.length - 1)) {
      event.preventDefault();
      (event.shiftKey ? items.at(-1) ?? dialog : items[0] ?? dialog).focus({ preventScroll: true });
    }
  };
  const onFocus = () => { if (topmost() && !dialog.contains(doc.activeElement)) focusFirst(); };
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('focusin', onFocus, true);
  focusFirst();
  return () => {
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('focusin', onFocus, true);
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  };
}
