import { api } from './core';
type Stats = {
  connected: boolean;
  rttMs: number;
  playerCount: number;
  predictionCorrections: number;
};
let stats: (() => Stats) | null = null;
let finish: ((x: number, y: number, z: number) => void) | null = null;
export function installNetDebug(read: (() => Stats) | null, rawFinish: typeof finish): void {
  stats = read;
  finish = rawFinish;
}
api.getNetStats = () =>
  stats?.() ?? { connected: false, rttMs: 0, playerCount: 0, predictionCorrections: 0 };
api.netFinishBreak = (x, y, z) => {
  if (!finish) throw new Error('Connect to a server first');
  finish(x, y, z);
};
