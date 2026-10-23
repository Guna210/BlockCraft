import {
  fillBounds,
  numberArgument,
  parseCommand,
  positionArguments,
  resolveSelector,
  type Position,
} from './parser';

export interface CommandContext {
  position(): Position;
  teleport(position: Position): void;
  give(id: string, count: number): boolean;
  setTime(ticks: number): void;
  setWeather(state: 'clear' | 'rain' | 'thunder'): void;
  setMode(mode: 'creative' | 'survival'): void;
  seed(): string;
  hasItem(id: string): boolean;
  hasBlock(id: string): boolean;
  fill(from: Position, to: Position, id: string): Promise<void>;
  locate(kind: 'structure' | 'ore', id: string): Promise<Position | null>;
  summon(type: string, position: Position): void;
}
export interface CommandResult {
  text: string;
  error: boolean;
}
function arity(args: string[], min: number, max: number, usage: string): void {
  if (args.length < min || args.length > max) throw new Error(`Usage: /${usage}`);
}

/** All failures, including downstream capacity errors, become local HUD messages. */
export async function executeCommand(line: string, ctx: CommandContext): Promise<CommandResult> {
  try {
    const { name, args } = parseCommand(line);
    let text: string;
    switch (name) {
      case 'tp': {
        arity(args, 3, 4, 'tp [@s|@p] x y z');
        if (args.length === 4) resolveSelector(args.shift()!);
        const position = positionArguments(args);
        ctx.teleport(position);
        text = `Teleported to ${position.join(' ')}`;
        break;
      }
      case 'give': {
        arity(args, 2, 3, 'give @s|@p item [count]');
        resolveSelector(args[0]!);
        const id = args[1]!;
        if (!ctx.hasItem(id)) throw new Error(`Unknown item: ${id}`);
        const count = args[2] === undefined ? 1 : numberArgument(args[2], 'Count');
        if (!Number.isSafeInteger(count) || count <= 0)
          throw new Error('Count must be a positive whole number');
        if (!ctx.give(id, count)) throw new Error('Inventory is full');
        text = `Gave ${count} ${id}`;
        break;
      }
      case 'time': {
        arity(args, 2, 2, 'time set day|noon|night|midnight|ticks');
        if (args[0] !== 'set') throw new Error('Usage: /time set ticks');
        const names: Record<string, number> = { day: 0, noon: 6000, night: 12000, midnight: 18000 };
        const ticks = names[args[1]!] ?? numberArgument(args[1], 'Time');
        if (!Number.isSafeInteger(ticks) || ticks < 0)
          throw new Error('Time must be a nonnegative whole number');
        ctx.setTime(ticks);
        text = `Time set to ${ticks}`;
        break;
      }
      case 'weather': {
        arity(args, 1, 1, 'weather clear|rain|thunder');
        const state = args[0];
        if (state !== 'clear' && state !== 'rain' && state !== 'thunder')
          throw new Error('Weather must be clear, rain or thunder');
        ctx.setWeather(state);
        text = `Weather set to ${state}`;
        break;
      }
      case 'gamemode': {
        arity(args, 1, 2, 'gamemode survival|creative [@s|@p]');
        if (args[1]) resolveSelector(args[1]);
        const mode = args[0];
        if (mode !== 'survival' && mode !== 'creative')
          throw new Error('Mode must be survival or creative');
        ctx.setMode(mode);
        text = `Game mode: ${mode}`;
        break;
      }
      case 'seed':
        arity(args, 0, 0, 'seed');
        text = `Seed: ${ctx.seed()}`;
        break;
      case 'fill': {
        arity(args, 7, 7, 'fill x1 y1 z1 x2 y2 z2 block');
        const from = positionArguments(args.slice(0, 3)),
          to = positionArguments(args.slice(3, 6));
        const bounds = fillBounds(from, to),
          id = args[6]!;
        if (!ctx.hasBlock(id)) throw new Error(`Unknown block: ${id}`);
        await ctx.fill(bounds.min, bounds.max, id);
        text = `Filled ${bounds.volume} blocks with ${id}`;
        break;
      }
      case 'locate': {
        arity(args, 2, 2, 'locate structure|ore id');
        const kind = args[0];
        if (kind !== 'structure' && kind !== 'ore')
          throw new Error('Locate kind must be structure or ore');
        const position = await ctx.locate(kind, args[1]!);
        text = position
          ? `${args[1]} at ${position.join(' ')}`
          : `No ${args[1]} found in search range`;
        break;
      }
      case 'summon': {
        if (args.length !== 1 && args.length !== 4) throw new Error('Usage: /summon type [x y z]');
        const position = args.length === 1 ? ctx.position() : positionArguments(args.slice(1));
        ctx.summon(args[0]!, position);
        text = `Summoned ${args[0]} at ${position.join(' ')}`;
        break;
      }
      default:
        throw new Error(`Unknown command: /${name}`);
    }
    return { text, error: false };
  } catch (error) {
    return { text: error instanceof Error ? error.message : 'Command failed', error: true };
  }
}
