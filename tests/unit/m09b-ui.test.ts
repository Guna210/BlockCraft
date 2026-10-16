import { describe, expect, it } from 'vitest';
import { items } from '../../src/gameplay/items';
import { Inventory } from '../../src/gameplay/inventory';
import { displayName, hasGlyph } from '../../src/ui/pixel-font';
import { UI, uiScaleFor } from '../../src/ui/ui-kit';
import { computeLayout, slotAt, PANEL_W, PANEL_H, SLOT_COUNT } from '../../src/ui/inventory-layout';
import { drawInventoryScreen } from '../../src/ui/inventory-screen';
import { FIGURE_COLORS } from '../../src/ui/preview-figure';
import type { IconSheet } from '../../src/ui/icons';

describe('M09b UI scale', () => {
  it('is the largest integer that keeps a 320×240 UI area in the window', () => {
    expect(uiScaleFor(1280, 720)).toBe(3);
    expect(uiScaleFor(800, 600)).toBe(2);
    expect(uiScaleFor(320, 240)).toBe(1);
    expect(uiScaleFor(200, 100)).toBe(1);
    expect(uiScaleFor(3840, 2160)).toBe(9);
    expect(uiScaleFor(1920, 1080)).toBe(4);
  });
});

describe('M09b inventory layout', () => {
  for (const [w, h] of [
    [1280, 720],
    [800, 600],
    [1920, 1080],
    [640, 480],
    [320, 240],
  ] as const) {
    it(`fits ${w}×${h} on whole pixels without overlapping slots`, () => {
      const layout = computeLayout(w, h);
      expect(Number.isInteger(layout.scale)).toBe(true);
      expect(layout.panel.w).toBe(PANEL_W * layout.scale);
      expect(layout.panel.h).toBe(PANEL_H * layout.scale);
      expect(layout.panel.x).toBeGreaterThanOrEqual(0);
      expect(layout.panel.y).toBeGreaterThanOrEqual(0);
      expect(layout.panel.x + layout.panel.w).toBeLessThanOrEqual(w);
      expect(layout.panel.y + layout.panel.h).toBeLessThanOrEqual(h);
      expect(layout.slots).toHaveLength(SLOT_COUNT);
      layout.slots.forEach((a, i) => {
        for (const v of [a.x, a.y, a.w, a.h]) expect(Number.isInteger(v)).toBe(true);
        expect(a.x).toBeGreaterThanOrEqual(layout.panel.x);
        expect(a.x + a.w).toBeLessThanOrEqual(layout.panel.x + layout.panel.w);
        expect(a.y + a.h).toBeLessThanOrEqual(layout.panel.y + layout.panel.h);
        expect(slotAt(layout, a.x + a.w / 2, a.y + a.h / 2)).toBe(i);
        layout.slots.slice(i + 1).forEach((b) => {
          const apart =
            a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
          expect(apart).toBe(true);
        });
      });
    });
  }
});

describe('M09b pixel font and palette', () => {
  it('can draw the name of every registered item', () => {
    for (const item of items.items.values())
      for (const char of displayName(item.id))
        expect(hasGlyph(char), `${item.id}: ${char}`).toBe(true);
  });

  it('uses at most 8 colors, all from the shared palette, on whole pixels', () => {
    expect(Object.keys(UI).length).toBeLessThanOrEqual(8);
    const colors = new Set<string>();
    const rects: number[][] = [];
    const ctx = {
      fillStyle: '',
      globalAlpha: 1,
      imageSmoothingEnabled: true,
      save() {},
      restore() {},
      translate() {},
      clearRect() {},
      drawImage(...args: number[]) {
        rects.push(args.slice(1));
      },
      fillRect(...args: number[]) {
        colors.add(this.fillStyle);
        rects.push(args);
      },
    };
    const inventory = new Inventory();
    inventory.insert('dirt', 64);
    inventory.insert('iron_helmet', 1);
    inventory.leftClick(0);
    const sheet: IconSheet = {
      width: 16,
      height: 16,
      data: new Uint8ClampedArray(16 * 16 * 4),
      rects: new Map([
        ['dirt', { x: 0, y: 0 }],
        ['iron_helmet', { x: 0, y: 0 }],
      ]),
    };
    const layout = computeLayout(1280, 720);
    drawInventoryScreen(
      ctx as unknown as CanvasRenderingContext2D,
      {
        layout,
        inventory,
        hoverSlot: 1,
        hoverClose: true,
        mouse: { x: 400, y: 300 },
        width: 1280,
        height: 720,
      },
      sheet,
      {} as CanvasImageSource,
    );
    // The preview figure draws in the in-game player and armor palettes; everything else is UI.
    const palette = new Set<string>([...Object.values(UI), ...FIGURE_COLORS]);
    for (const color of colors) expect(palette.has(color), color).toBe(true);
    expect(ctx.imageSmoothingEnabled).toBe(false);
    for (const r of rects) for (const v of r) expect(Number.isInteger(v)).toBe(true);
  });
});
