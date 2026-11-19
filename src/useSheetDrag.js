import { useCallback, useRef, useState } from "react";

// Lightweight touch swipe-down-to-dismiss gesture for mobile bottom sheets.
// Bind `handleProps` onto the grabber or header bar, and `sheetStyle` onto the
// sheet element itself so the sheet follows the finger smoothly.
export function useSheetDrag(onClose, { threshold = 90 } = {}) {
  const startY = useRef(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  const onTouchStart = useCallback((event) => {
    if (event.touches.length !== 1) return;
    startY.current = event.touches[0].clientY;
    setDragging(true);
  }, []);

  const onTouchMove = useCallback((event) => {
    if (startY.current === null || event.touches.length !== 1) return;
    const delta = event.touches[0].clientY - startY.current;
    if (delta > 0) setOffset(delta);
  }, []);

  const finish = useCallback(() => {
    if (startY.current === null) return;
    const shouldClose = offset >= threshold;
    startY.current = null;
    setDragging(false);
    setOffset(0);
    if (shouldClose) onClose?.();
  }, [offset, threshold, onClose]);

  const sheetStyle = offset > 0
    ? { transform: `translateY(${offset}px)`, transition: dragging ? "none" : "transform 220ms var(--ease)" }
    : undefined;

  return {
    handleProps: {
      onTouchStart,
      onTouchMove,
      onTouchEnd: finish,
      onTouchCancel: finish,
    },
    sheetStyle,
  };
}
