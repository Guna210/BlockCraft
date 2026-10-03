import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { detSin, detCos } from '../../src/gen/detmath';

describe('M03d-fix — deterministic sin/cos for generation', () => {
  it('stays within 1e-8 of Math.sin / Math.cos over a wide range', () => {
    let worst = 0;
    for (let x = -200; x <= 200; x += 0.0137) {
      worst = Math.max(worst, Math.abs(detSin(x) - Math.sin(x)), Math.abs(detCos(x) - Math.cos(x)));
    }
    expect(worst).toBeLessThan(1e-8);
  });

  it('handles the exact points generation relies on', () => {
    expect(detSin(0)).toBe(0);
    expect(Math.abs(detCos(0) - 1)).toBeLessThan(1e-9);
    expect(Math.abs(detSin(Math.PI / 2) - 1)).toBeLessThan(1e-9);
    expect(Math.abs(detCos(Math.PI) + 1)).toBeLessThan(1e-9);
    // sin² + cos² = 1 across the yaw range the worm carver uses
    for (let yaw = -4; yaw <= 14; yaw += 0.173) {
      const s = detSin(yaw);
      const c = detCos(yaw);
      expect(Math.abs(s * s + c * c - 1)).toBeLessThan(1e-8);
    }
  });

  it('returns pinned bit-exact values (only IEEE +, -, *, floor are involved)', () => {
    // Every JS engine must produce these exact doubles: the implementation uses no
    // implementation-approximated function.
    expect(detSin(0.5)).toBe(0.479425538604203);
    expect(detSin(1)).toBe(0.8414709848086585);
    expect(detSin(1.2345)).toBe(0.9439833239624353);
    expect(detSin(-2.5)).toBe(-0.5984721441039573);
    expect(detSin(10)).toBe(-0.5440211108893703);
    expect(detSin(123.456)).toBe(-0.8039373685730999);
    expect(detCos(1)).toBe(0.5403023058681399);
    expect(detCos(1.2345)).toBe(0.32999315767856796);
    expect(detCos(10)).toBe(-0.8390715290771652);
    expect(detCos(-77.7)).toBe(-0.6675995759288541);
  });

  it('cave generation code never calls an implementation-approximated math function', () => {
    const forbidden =
      /Math\.(sin|cos|tan|asin|acos|atan2?|sinh|cosh|tanh|exp|expm1|log\d*|log1p|pow|cbrt|hypot|random)\b|\*\*/;
    for (const file of ['src/gen/caves.ts', 'src/gen/detmath.ts']) {
      const code = fs
        .readFileSync(path.resolve(process.cwd(), file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(forbidden.test(code), `${file} uses an implementation-approximated function`).toBe(
        false,
      );
    }
  });
});
