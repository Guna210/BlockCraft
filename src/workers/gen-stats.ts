/**
 * One generated column: the worker-side wall time of the whole job and how many 16³ sections it
 * produced (every section that exists in the column, uniform or not, because each one is shipped).
 */
export interface GenSample {
  columnMs: number;
  sections: number;
}

/**
 * Nearest-rank percentile over 16³ sections. A column is a batch of `sections` sections that share
 * one per-section cost (columnMs / sections), so each column counts once per section it produced.
 * This is the SPEC §2.3 unit ("per 16³ section") and lets tall columns weigh more than short ones.
 */
export function sectionPercentile(samples: readonly GenSample[], q: number): number {
  let totalSections = 0;
  for (const s of samples) totalSections += Math.max(1, s.sections);
  if (totalSections === 0) return 0;

  const perSection = samples
    .map((s) => ({ cost: s.columnMs / Math.max(1, s.sections), weight: Math.max(1, s.sections) }))
    .sort((a, b) => a.cost - b.cost);

  const rank = Math.max(1, Math.ceil(q * totalSections));
  let seen = 0;
  for (const entry of perSection) {
    seen += entry.weight;
    if (seen >= rank) return entry.cost;
  }
  return perSection[perSection.length - 1]!.cost;
}

/** Nearest-rank percentile over columns (each column counts once, whatever its height). */
export function columnPercentile(samples: readonly GenSample[], q: number): number {
  if (samples.length === 0) return 0;
  const sorted = samples.map((s) => s.columnMs).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;
}
