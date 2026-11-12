import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { hashString } from '../src/engine/rng';

export interface ServerOptions {
  world: string;
  seed: number;
  port: number;
  viewDistance: number;
  maxPlayers: number;
  delayMs: number;
  resetWorld: boolean;
}
export function parseOptions(args: readonly string[]): ServerOptions {
  const options: ServerOptions = {
    world: resolve('worlds/default'),
    seed: randomBytes(4).readUInt32LE(),
    port: 3001,
    viewDistance: 8,
    maxPlayers: 8,
    delayMs: 0,
    resetWorld: false,
  };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (flag === '--reset-world') {
      options.resetWorld = true;
      continue;
    }
    const value = args[++i];
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    if (flag === '--world') options.world = resolve(value);
    else if (flag === '--seed') options.seed = hashString(value);
    else {
      const n = Number(value);
      if (!Number.isSafeInteger(n) || n < 0) throw new Error(`Invalid ${flag}: ${value}`);
      switch (flag) {
        case '--port':
          if (n > 65535) throw new Error('Port out of range');
          options.port = n;
          break;
        case '--view-distance':
          if (n < 1 || n > 32) throw new Error('View distance must be 1–32');
          options.viewDistance = n;
          break;
        case '--max-players':
          if (n < 1 || n > 128) throw new Error('Max players must be 1–128');
          options.maxPlayers = n;
          break;
        case '--delay-ms':
          options.delayMs = n;
          break;
        default:
          throw new Error(`Unknown option ${flag}`);
      }
    }
  }
  return options;
}
