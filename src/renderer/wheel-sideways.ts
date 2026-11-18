const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
export const WHEEL_LINE_PX = 40;

export interface WheelDelta { deltaX: number; deltaY: number; deltaMode: number }

export function sidewaysWheelDistance(wheel: WheelDelta, pageWidth: number) {
  if (Math.abs(wheel.deltaX) >= Math.abs(wheel.deltaY)) return 0;
  if (wheel.deltaMode === DOM_DELTA_LINE) return wheel.deltaY * WHEEL_LINE_PX;
  if (wheel.deltaMode === DOM_DELTA_PAGE) return wheel.deltaY * pageWidth;
  return wheel.deltaY;
}

export function wheelScrollsSideways(strip: HTMLElement) {
  strip.addEventListener('wheel', (e) => {
    if (e.ctrlKey || strip.scrollWidth <= strip.clientWidth) return;
    const distance = sidewaysWheelDistance(e, strip.clientWidth);
    if (!distance) return;
    e.preventDefault();
    strip.scrollLeft += distance;
  }, { passive: false });
}
