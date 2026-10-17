/**
 * Save format versioning and migration registry.
 * Latest format version is 1. Migrations transform format version n -> n+1.
 */

export const FORMAT_VERSION = 1;

export type MigrationFn<T = unknown> = (data: T) => T;

export class MigrationRegistry {
  private migrations = new Map<string, (data: unknown) => unknown>();

  private key(domain: string, fromVersion: number): string {
    return `${domain}:${fromVersion}`;
  }

  public register<T>(domain: string, fromVersion: number, fn: MigrationFn<T>): void {
    this.migrations.set(this.key(domain, fromVersion), fn as (data: unknown) => unknown);
  }

  public registerColumn(fromVersion: number, fn: MigrationFn<Uint8Array>): void {
    this.register('column', fromVersion, fn);
  }

  public registerWorld(fromVersion: number, fn: MigrationFn<Uint8Array>): void {
    this.register('world', fromVersion, fn);
  }

  public has(domain: string, fromVersion: number): boolean {
    return this.migrations.has(this.key(domain, fromVersion));
  }

  public migrate<T>(
    domain: string,
    data: T,
    fromVersion: number,
    targetVersion: number = FORMAT_VERSION,
  ): T {
    if (fromVersion === targetVersion) {
      return data;
    }
    if (fromVersion > targetVersion) {
      throw new Error(
        `Cannot migrate ${domain} from future version ${fromVersion} to ${targetVersion}`,
      );
    }
    let current: unknown = data;
    for (let v = fromVersion; v < targetVersion; v++) {
      const fn = this.migrations.get(this.key(domain, v));
      if (!fn) {
        throw new Error(`No migration registered for ${domain} version ${v} -> ${v + 1}`);
      }
      current = fn(current);
    }
    return current as T;
  }

  public clear(): void {
    this.migrations.clear();
  }
}

export const migrations = new MigrationRegistry();
