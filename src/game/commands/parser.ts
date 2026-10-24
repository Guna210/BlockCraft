export const COMMAND_NAMES = [
  'tp',
  'time',
  'weather',
  'give',
  'gamemode',
  'seed',
  'fill',
  'locate',
  'summon',
] as const;
export const FILL_CAP = 4096;
export type Position = [number, number, number];

export function parseCommand(line: string): { name: string; args: string[] } {
  const text = line.trim();
  if (!text.startsWith('/')) throw new Error('Commands start with /');
  const [name = '', ...args] = text.slice(1).split(/\s+/);
  if (!name) throw new Error('Enter a command name');
  return { name: name.toLowerCase(), args };
}

export function resolveSelector(selector: string): 'player' {
  if (selector !== '@s' && selector !== '@p')
    throw new Error(`Unknown selector: ${selector}. Use @s or @p`);
  return 'player';
}

export function numberArgument(value: string | undefined, label: string): number {
  if (!value || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))
    throw new Error(`${label} must be a finite number`);
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > 30_000_000)
    throw new Error(`${label} is out of range`);
  return number;
}

export function positionArguments(args: string[]): Position {
  if (args.length !== 3) throw new Error('Expected x y z');
  return args.map((arg, i) => numberArgument(arg, ['X', 'Y', 'Z'][i]!)) as Position;
}

export function fillBounds(
  from: Position,
  to: Position,
): { min: Position; max: Position; volume: number } {
  if (![...from, ...to].every(Number.isSafeInteger))
    throw new Error('Fill coordinates must be whole numbers');
  const min = from.map((n, i) => Math.min(n, to[i]!)) as Position;
  const max = from.map((n, i) => Math.max(n, to[i]!)) as Position;
  if (min[1] < 0 || max[1] > 319) throw new Error('Fill Y must be between 0 and 319');
  const volume = (max[0] - min[0] + 1) * (max[1] - min[1] + 1) * (max[2] - min[2] + 1);
  if (!Number.isSafeInteger(volume) || volume > FILL_CAP)
    throw new Error(`Fill volume ${volume} exceeds the ${FILL_CAP} block cap`);
  return { min, max, volume };
}

export interface CompletionCatalog {
  items: readonly string[];
  blocks: readonly string[];
  entities: readonly string[];
  structures: readonly string[];
  ores: readonly string[];
}

/** Full replacement strings, ordered for stable Tab / Shift+Tab cycling. */
export function completeCommand(line: string, catalog: CompletionCatalog): string[] {
  if (!line.startsWith('/')) return [];
  const tokens = line.slice(1).split(/\s+/);
  const prefix = tokens.pop() ?? '';
  const [name, ...args] = tokens;
  let choices: readonly string[] = [];
  if (!name) choices = COMMAND_NAMES;
  else if (name === 'give')
    choices = args.length === 0 ? ['@s', '@p'] : args.length === 1 ? catalog.items : [];
  else if (name === 'tp' && args.length === 0) choices = ['@s', '@p'];
  else if (name === 'time')
    choices =
      args.length === 0 ? ['set'] : args.length === 1 ? ['day', 'noon', 'night', 'midnight'] : [];
  else if (name === 'weather' && !args.length) choices = ['clear', 'rain', 'thunder'];
  else if (name === 'gamemode')
    choices = args.length === 0 ? ['survival', 'creative'] : args.length === 1 ? ['@s', '@p'] : [];
  else if (name === 'summon' && !args.length) choices = catalog.entities;
  else if (name === 'fill' && args.length === 6) choices = catalog.blocks;
  else if (name === 'locate')
    choices = !args.length
      ? ['structure', 'ore']
      : args.length === 1
        ? args[0] === 'structure'
          ? catalog.structures
          : args[0] === 'ore'
            ? catalog.ores
            : []
        : [];
  const start = tokens.length ? `/${tokens.join(' ')} ` : '/';
  return [...new Set(choices)]
    .filter((id) => id.startsWith(prefix))
    .sort()
    .map((id) => start + id);
}
