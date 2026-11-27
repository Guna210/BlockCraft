import { settings } from '../engine/settings';
import { SOUND_CAPTIONS } from './captions';

export type SubtitleDirection = 'ahead' | 'right' | 'behind' | 'left';

export interface SubtitleLine {
  text: string;
  direction: SubtitleDirection | null;
  ageMs: number;
}

interface StoredSubtitle {
  text: string;
  direction: SubtitleDirection | null;
  createdAt: number;
}

const MAX_SUBTITLE_LINES = 5;
const SUBTITLE_LIFETIME_MS = 3000;
const FADE_START_MS = 2400;

export function directionForSound(
  sourceX: number,
  sourceZ: number,
  listenerX: number,
  listenerZ: number,
  yaw: number,
): SubtitleDirection {
  const dx = sourceX - listenerX;
  const dz = sourceZ - listenerZ;
  if (Math.hypot(dx, dz) < 1e-6) return 'ahead';
  let relative = Math.atan2(dz, dx) - yaw;
  while (relative > Math.PI) relative -= Math.PI * 2;
  while (relative <= -Math.PI) relative += Math.PI * 2;
  if (relative > -Math.PI / 4 && relative <= Math.PI / 4) return 'ahead';
  if (relative > Math.PI / 4 && relative <= (3 * Math.PI) / 4) return 'right';
  if (relative > (3 * Math.PI) / 4 || relative <= (-3 * Math.PI) / 4) return 'behind';
  return 'left';
}

export class SubtitleTracker {
  private lines: StoredSubtitle[] = [];

  add(text: string, direction: SubtitleDirection | null, now: number): void {
    this.lines = this.lines.filter((line) => line.text !== text);
    this.lines.push({ text, direction, createdAt: now });
    if (this.lines.length > MAX_SUBTITLE_LINES) this.lines.shift();
  }

  current(enabled: boolean, now: number): SubtitleLine[] {
    if (!enabled) {
      this.lines = [];
      return [];
    }
    this.lines = this.lines.filter((line) => now - line.createdAt < SUBTITLE_LIFETIME_MS);
    return this.lines.map((line) => ({
      text: line.text,
      direction: line.direction,
      ageMs: Math.max(0, Math.floor(now - line.createdAt)),
    }));
  }
}

export const subtitleTracker = new SubtitleTracker();

export function recordSubtitle(
  id: string,
  source: {
    pos?: ArrayLike<number>;
    x?: number;
    y?: number;
    z?: number;
  },
  listener: { x: number; y: number; z: number; yaw: number },
): void {
  if (!settings.subtitles) return;
  const caption = SOUND_CAPTIONS[id];
  if (!caption) return;
  const positional =
    source.pos !== undefined ||
    source.x !== undefined ||
    source.y !== undefined ||
    source.z !== undefined;
  if (!positional) {
    subtitleTracker.add(caption.text, null, performance.now());
    return;
  }
  const x = source.x ?? source.pos?.[0] ?? 0;
  const y = source.y ?? source.pos?.[1] ?? 0;
  const z = source.z ?? source.pos?.[2] ?? 0;
  if (Math.hypot(x - listener.x, y - listener.y, z - listener.z) > caption.audibleDistance) return;
  subtitleTracker.add(
    caption.text,
    directionForSound(x, z, listener.x, listener.z, listener.yaw),
    performance.now(),
  );
}

export function getSubtitles(): SubtitleLine[] {
  return subtitleTracker.current(settings.subtitles, performance.now());
}

export function subtitleOpacity(ageMs: number): number {
  return Math.max(
    0,
    Math.min(1, (SUBTITLE_LIFETIME_MS - ageMs) / (SUBTITLE_LIFETIME_MS - FADE_START_MS)),
  );
}
