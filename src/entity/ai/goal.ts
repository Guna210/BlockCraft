/** Exclusive resources a goal claims while it runs. */
export type GoalFlag = 'move' | 'look' | 'jump' | 'target';

/**
 * One behaviour of a mob. The selector calls canStart() while the goal is idle and
 * shouldContinue() while it runs; start(), tick() and stop() bracket a run.
 */
export interface Goal {
  readonly name: string;
  readonly flags: readonly GoalFlag[];
  canStart(): boolean;
  shouldContinue(): boolean;
  start(): void;
  tick(): void;
  stop(): void;
}

/** Defaults: no flags, continue while canStart() holds, and empty start, tick and stop. */
export abstract class BaseGoal implements Goal {
  abstract readonly name: string;
  readonly flags: readonly GoalFlag[] = [];
  abstract canStart(): boolean;
  shouldContinue(): boolean {
    return this.canStart();
  }
  start(): void {}
  tick(): void {}
  stop(): void {}
}

interface Entry {
  priority: number;
  order: number;
  goal: Goal;
  running: boolean;
}

/**
 * Runs the goals of one mob. A lower priority number wins; equal priorities go to the goal
 * registered first, so selection is deterministic. Each tick a goal that can start takes its flags
 * from every running goal that ranks below it, which stops those goals.
 */
export class GoalSelector {
  private readonly entries: Entry[] = [];
  private readonly holders = new Map<GoalFlag, Entry>();

  add(priority: number, goal: Goal): this {
    const entry: Entry = { priority, order: this.entries.length, goal, running: false };
    let at = this.entries.length;
    while (at > 0 && this.entries[at - 1]!.priority > priority) at--;
    this.entries.splice(at, 0, entry);
    return this;
  }

  /** Running goals, highest rank first. */
  get running(): Goal[] {
    return this.entries.filter((entry) => entry.running).map((entry) => entry.goal);
  }

  /** The highest-ranked running goal, or null. */
  get current(): Goal | null {
    return this.entries.find((entry) => entry.running)?.goal ?? null;
  }

  tick(): void {
    for (const entry of this.entries)
      if (entry.running && !entry.goal.shouldContinue()) this.stopEntry(entry);
    for (const entry of this.entries) {
      if (entry.running || !this.flagsAvailable(entry) || !entry.goal.canStart()) continue;
      for (const flag of entry.goal.flags) {
        const holder = this.holders.get(flag);
        if (holder) this.stopEntry(holder);
      }
      entry.running = true;
      for (const flag of entry.goal.flags) this.holders.set(flag, entry);
      entry.goal.start();
    }
    for (const entry of this.entries) if (entry.running) entry.goal.tick();
  }

  /** Stops every running goal (death, removal). */
  stopAll(): void {
    for (const entry of this.entries) if (entry.running) this.stopEntry(entry);
  }

  /** Every flag is free or held by a goal ranked below this one. */
  private flagsAvailable(entry: Entry): boolean {
    for (const flag of entry.goal.flags) {
      const holder = this.holders.get(flag);
      if (holder && !GoalSelector.outranks(entry, holder)) return false;
    }
    return true;
  }

  private static outranks(a: Entry, b: Entry): boolean {
    return a.priority < b.priority || (a.priority === b.priority && a.order < b.order);
  }

  private stopEntry(entry: Entry): void {
    entry.running = false;
    for (const flag of entry.goal.flags)
      if (this.holders.get(flag) === entry) this.holders.delete(flag);
    entry.goal.stop();
  }
}
