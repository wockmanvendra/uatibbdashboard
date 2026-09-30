import '@testing-library/jest-dom/vitest';

// jsdom implements neither of these, and ECharts and the reduced-motion check
// both reach for them on mount.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

/**
 * jsdom has no canvas implementation, so getContext('2d') returns null and
 * ECharts' renderer throws on the first paint. These tests assert DOM output —
 * KPI text, table contents, ARIA — not pixels, so a no-op 2D context is enough
 * to let the charts mount without pulling in the `canvas` native dependency.
 */
const noop = () => {};
const stubContext = {
  canvas: null as unknown,
  clearRect: noop, fillRect: noop, strokeRect: noop, beginPath: noop, closePath: noop,
  moveTo: noop, lineTo: noop, bezierCurveTo: noop, quadraticCurveTo: noop, arc: noop,
  arcTo: noop, ellipse: noop, rect: noop, fill: noop, stroke: noop, clip: noop,
  save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
  transform: noop, setTransform: noop, resetTransform: noop,
  drawImage: noop, createLinearGradient: () => ({ addColorStop: noop }),
  createRadialGradient: () => ({ addColorStop: noop }),
  createPattern: () => null,
  measureText: (t: string) => ({ width: t.length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
  fillText: noop, strokeText: noop,
  getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  putImageData: noop, createImageData: () => ({ data: new Uint8ClampedArray(4) }),
  setLineDash: noop, getLineDash: () => [],
  isPointInPath: () => false, isPointInStroke: () => false,
};

HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement) {
  return { ...stubContext, canvas: this };
} as unknown as HTMLCanvasElement['getContext'];
