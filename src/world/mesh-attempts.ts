/**
 * The section meshes each column's current mesh attempt has uploaded (decisions/M04b-fade-and-memory.md).
 * An entry exists only while an attempt is open: from `begin` until the attempt `end`s or is `abandon`ed
 * (discarded before it completed, or its column's meshes or data were freed). Nothing is left behind for
 * a column that is not being meshed.
 */
export class MeshAttempts {
  // Per column key ("cx,cz"): the section keys ("sx,sy,sz") uploaded so far by the open attempt.
  private readonly attempts = new Map<string, Set<string>>();

  /** A mesh attempt of the column starts. Replaces an entry left by an earlier attempt. */
  begin(column: string): void {
    this.attempts.set(column, new Set());
  }

  /** A section of the column was uploaded by its open attempt. Ignored when no attempt is open. */
  uploaded(column: string, section: string): void {
    this.attempts.get(column)?.add(section);
  }

  /** The attempt completed: returns the sections it uploaded and forgets it. */
  end(column: string): ReadonlySet<string> {
    const uploaded = this.attempts.get(column) ?? new Set<string>();
    this.attempts.delete(column);
    return uploaded;
  }

  /**
   * The open attempt was discarded before it completed, or the column's meshes or data were freed:
   * forgets the attempt and what it uploaded.
   */
  abandon(column: string): void {
    this.attempts.delete(column);
  }

  clear(): void {
    this.attempts.clear();
  }

  /** Columns with an entry. Zero when no attempt is open. */
  get size(): number {
    return this.attempts.size;
  }
}
