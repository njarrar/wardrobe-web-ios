import { useEffect, useRef } from "react";

// Shared modal stack so nested dialogs (for example EdgeEditor inside ItemViewer)
// handle Escape strictly top-down, ref-count body scroll locking, trap Tab focus,
// and restore focus to the trigger element when dismissed.
const dialogStack = [];
let nextId = 1;

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function syncBodyClass() {
  if (typeof document === "undefined") return;
  document.body.classList.toggle("viewer-open", dialogStack.some((entry) => entry.lockBody));
}

function getFocusable(container) {
  if (!container) return [];
  return [...container.querySelectorAll(FOCUSABLE)].filter((node) => {
    if (node.closest('[aria-hidden="true"], [hidden], [inert]')) return false;
    return node.offsetParent !== null || node.getClientRects().length > 0;
  });
}

export function isAnyDialogOpen() {
  return dialogStack.length > 0;
}

// lockBody: false keeps the page as is, for the import sheet, which must
// leave the import tray in view while it is open.
export function useDialog({ open = true, onClose, initialFocusRef, containerRef, lockBody = true } = {}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const initialFocusRefHolder = useRef(initialFocusRef);
  initialFocusRefHolder.current = initialFocusRef;

  const containerRefHolder = useRef(containerRef);
  containerRefHolder.current = containerRef;

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;

    const id = nextId++;
    const entry = { id, lockBody };
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    dialogStack.push(entry);
    syncBodyClass();

    const focusTimer = requestAnimationFrame(() => {
      if (dialogStack[dialogStack.length - 1] !== entry) return;
      const target = initialFocusRefHolder.current?.current;
      if (target && typeof target.focus === "function") {
        target.focus({ preventScroll: true });
        return;
      }
      const container = containerRefHolder.current?.current;
      const first = getFocusable(container)[0] || container;
      if (first && typeof first.focus === "function") {
        if (first === container && !container.hasAttribute("tabindex")) container.setAttribute("tabindex", "-1");
        first.focus({ preventScroll: true });
      }
    });

    const onKeyDown = (event) => {
      if (dialogStack[dialogStack.length - 1] !== entry) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }

      if (event.key === "Tab") {
        const container = containerRefHolder.current?.current;
        if (!container) return;
        const focusable = getFocusable(container);
        if (!focusable.length) {
          event.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (event.shiftKey) {
          if (active === first || !container.contains(active)) {
            event.preventDefault();
            last.focus();
          }
        } else if (active === last || !container.contains(active)) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      cancelAnimationFrame(focusTimer);
      document.removeEventListener("keydown", onKeyDown, true);
      const index = dialogStack.indexOf(entry);
      if (index !== -1) dialogStack.splice(index, 1);
      syncBodyClass();
      if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === "function") {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [open]);
}

// RTL-aware roving keyboard handler for ARIA tablists and radiogroups.
export function handleRovingKeys(event, { index, count, onSelect, rtl = false }) {
  if (count <= 0) return;
  let next = null;
  if (event.key === "ArrowRight") next = (index + (rtl ? -1 : 1) + count) % count;
  else if (event.key === "ArrowLeft") next = (index + (rtl ? 1 : -1) + count) % count;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = count - 1;
  if (next === null) return;
  event.preventDefault();
  onSelect(next);
  const group = event.currentTarget.parentElement;
  const controls = group ? [...group.querySelectorAll('[role="tab"], [role="radio"]')] : [];
  controls[next]?.focus();
}
