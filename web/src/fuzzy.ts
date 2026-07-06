/**
 * Tiny fuzzy matcher. Returns a score (higher = better) or -1 for no match.
 * Empty queries match everything with score 0 so lists show unfiltered.
 *
 * Multi-word queries are tokenized: EVERY word must match somewhere in the
 * target (in any order), so "nursing drafts career" finds
 * "School of Nursing/02-drafts/career-paths.md".
 */
export function fuzzyMatch(query: string, target: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = target.toLowerCase();

  const tokens = q.split(/\s+/);
  let total = 0;
  for (const token of tokens) {
    const s = scoreToken(token, t);
    if (s === -1) return -1; // every word must match
    total += s;
  }
  // Small bonus when the whole query appears verbatim.
  if (tokens.length > 1 && t.includes(q)) total += 100;
  return total;
}

function scoreToken(token: string, t: string): number {
  if (t === token) return 1000;
  if (t.startsWith(token)) return 500 + token.length;
  const idx = t.indexOf(token);
  // Word-boundary hits beat mid-word hits.
  if (idx !== -1) {
    const boundary = idx === 0 || /[\s\-_/.]/.test(t[idx - 1]);
    return (boundary ? 300 : 200) - Math.min(idx, 100) / 2 + token.length * 4;
  }

  // Subsequence match: all token chars appear in order.
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (const ch of token) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return -1;
    streak = found === ti ? streak + 1 : 1;
    score += streak; // consecutive hits score more
    ti = found + 1;
  }
  return Math.min(score, 100); // subsequence never beats a real substring hit
}
