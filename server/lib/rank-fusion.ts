/**
 * Reciprocal rank fusion: merge several ranked id lists into one.
 *
 * Each list votes 1 / (k + rank) for the ids it holds, so an id found by two
 * searches beats one found by a single search at a similar rank, and no score
 * scale (cosine similarity, text rank) has to be comparable across lists.
 */

/** Standard damping constant: keeps one list's first place from deciding everything. */
const RRF_K = 60;

export function reciprocalRankFusion(rankings: string[][], k: number = RRF_K): string[] {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    // A list that repeats an id only counts its best position.
    [...new Set(ranking)].forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1));
    });
  }
  // Array.sort is stable, so ties keep the order ids were first seen in:
  // put the ranking you trust most first.
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
