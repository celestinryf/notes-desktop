export interface FocusableWindow { focus(): void; document: { hasFocus(): boolean } }

export function pullFocusFromPeer(w: FocusableWindow) {
  if (w.document.hasFocus()) w.focus();
}
