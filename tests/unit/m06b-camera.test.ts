import { afterEach, describe, expect, it } from 'vitest';
import { World } from '../../src/world/world';
import { Camera } from '../../src/render/camera';
import { PlayerController } from '../../src/engine/player-controller';
import { InputEngine } from '../../src/engine/input';
import { settings } from '../../src/engine/settings';
import { UnderwaterView } from '../../src/render/underwater';
import {
  genPlayerHead,
  genPlayerHair,
  genPlayerCoat,
  genPlayerLeg,
  PAL_PLAYER_HEAD,
  PAL_PLAYER_COAT,
  PAL_PLAYER_LEG,
} from '../../src/render/textures/player';

function scene() {
  const world = new World(false);
  world.fill(-10, 64, -10, 30, 64, 10, 'stone');
  const camera = new Camera(16 / 9);
  const input = new InputEngine(document.createElement('canvas'));
  const controller = new PlayerController(camera, input, () => true);
  controller.spawn(world, 0.5, 65, 0.5, 'survival');
  controller.loop.pause();
  return { world, camera, input, controller };
}
afterEach(() => {
  settings.fov = 70;
  settings.viewBobbing = true;
});

describe('M06b camera', () => {
  it('eases sprint FOV over five ticks, interpolates and returns to settings FOV', () => {
    const { controller, camera } = scene();
    controller.setInput('forward', true);
    controller.setInput('sprint', true);
    const fovs = [];
    for (let i = 0; i < 5; i++) {
      controller.tick(1);
      fovs.push((camera.fov * 180) / Math.PI);
    }
    expect(fovs).toEqual(
      [71.4, 72.8, 74.2, 75.60000000000001, 77].map((n) => expect.closeTo(n, 6)),
    );
    controller.render(0.5);
    expect((camera.fov * 180) / Math.PI).toBeCloseTo(76.3);
    controller.setInput('sprint', false);
    controller.tick(5);
    expect((camera.fov * 180) / Math.PI).toBeCloseTo(70);
    settings.fov = 80;
    controller.render(1);
    expect((camera.fov * 180) / Math.PI).toBeCloseTo(80);
  });
  it('F5 perspective action cycles back/front/first once per press and is rebindable', () => {
    const { controller, camera, input } = scene();
    expect(input.keyBindings.get('F5')).toBe('perspective');
    controller.setInput('perspective', true);
    expect(controller.perspective).toBe(1);
    expect(camera.position[0]).toBeCloseTo(-3.5);
    controller.setInput('perspective', true);
    expect(controller.perspective).toBe(1);
    controller.setInput('perspective', false);
    controller.setInput('perspective', true);
    expect(controller.perspective).toBe(2);
    expect(camera.position[0]).toBeCloseTo(4.5);
    expect(camera.yaw).toBeCloseTo(Math.PI);
    controller.setInput('perspective', false);
    controller.setInput('perspective', true);
    expect(controller.perspective).toBe(0);
    expect(camera.position[0]).toBeCloseTo(0.5);
    controller.setInput('perspective', false);
    input.unbindKey('F5');
    input.bindKey('KeyV', 'perspective');
    input.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyV' }));
    expect(controller.perspective).toBe(1);
    input.detach();
  });
  it('ray stops .2 short of walls including oblique rays and slab shapes', () => {
    const { controller, world, camera } = scene();
    world.fill(-2, 65, -3, -2, 69, 3, 'stone');
    controller.setInput('perspective', true);
    expect(camera.position[0]).toBeCloseTo(-0.8);
    const collision = controller.player!.collision;
    expect(collision.cameraDistance(0.5, 67, 0.5, -Math.SQRT1_2, 0, Math.SQRT1_2)).toBeCloseTo(
      1.5 * Math.SQRT2 - 0.2,
    );
    world.setBlock(0, 68, 0, 'stone_slab', { half: 'top' });
    expect(collision.cameraDistance(0.5, 67, 0.5, 0, 1, 0)).toBeCloseTo(1.3);
    expect(collision.cameraDistance(0.5, 68.2, 0.5, 1, 0, 0)).toBe(4);
  });
  it('bobs with ground distance, stops when disabled and suppresses water/climb/flight', () => {
    const { controller, camera } = scene();
    controller.setInput('forward', true);
    controller.tick(2);
    expect(Math.abs(camera.roll)).toBeGreaterThan(0.001);
    expect(Math.abs(camera.position[1] - 66.62)).toBeGreaterThan(0.005);
    settings.viewBobbing = false;
    controller.render(1);
    expect(camera.roll).toBe(0);
    expect(camera.position[1]).toBeCloseTo(66.62, 4);
    settings.viewBobbing = true;
    const p = controller.player!;
    for (const medium of ['water', 'climbing', 'flight']) {
      p.inFluid = medium === 'water' ? 'water' : null;
      p.climbing = medium === 'climbing';
      p.flying = medium === 'flight';
      controller.render(0.5);
      expect(camera.roll).toBe(0);
    }
  });
});

describe('M06b underwater camera medium and skin', () => {
  it('floor and fog are camera-only, decrease at night, and clear above water', () => {
    const { world } = scene();
    world.fill(-2, 65, -2, 2, 85, 2, 'water');
    const view = new UnderwaterView();
    view.update(world, [0.5, 84.5, 0.5], 1);
    expect(view.submerged).toBe(true);
    expect(view.fogStart).toBe(2);
    expect(view.fogEnd).toBe(24);
    expect(view.brightnessFloor).toBe(0.28);
    const noon = [...view.fogColor];
    view.update(world, [0.5, 84.5, 0.5], 0.1);
    expect(view.brightnessFloor).toBeCloseTo(0.028);
    expect(view.fogColor[2]).toBeCloseTo(noon[2]! * 0.1);
    view.update(world, [0.5, 86, 0.5], 1);
    expect(view.submerged).toBe(false);
    expect(view.brightnessFloor).toBe(0);
  });
  it('original skin pixels follow declared palettes and contrast', () => {
    for (const [gen, palette] of [
      [genPlayerHead, PAL_PLAYER_HEAD],
      [genPlayerHair, PAL_PLAYER_HEAD],
      [genPlayerCoat, PAL_PLAYER_COAT],
      [genPlayerLeg, PAL_PLAYER_LEG],
    ] as const) {
      const tile = gen(42),
        colors = palette.map((c) => c.join(','));
      expect(tile).toEqual(gen(42));
      expect(palette.length).toBeLessThanOrEqual(12);
      const luma = [];
      for (let i = 0; i < tile.length; i += 4) {
        expect(colors).toContain(Array.from(tile.slice(i, i + 4)).join(','));
        luma.push(tile[i]! * 0.2126 + tile[i + 1]! * 0.7152 + tile[i + 2]! * 0.0722);
      }
      expect(Math.max(...luma) - Math.min(...luma)).toBeGreaterThanOrEqual(60);
    }
  });
});
