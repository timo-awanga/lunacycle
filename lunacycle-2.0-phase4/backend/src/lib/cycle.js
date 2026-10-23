// Pure, timezone-safe cycle maths. Dates are 'YYYY-MM-DD' strings handled in UTC, so DST and the
// viewer's timezone can never shift a day.
const RE = /^\d{4}-\d{2}-\d{2}$/;
export function parseDate(s) {
  if (typeof s !== 'string' || !RE.test(s)) throw new RangeError(`Invalid date: ${s}`);
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(+d) || d.toISOString().slice(0, 10) !== s) throw new RangeError(`Invalid date: ${s}`);
  return d;
}
export const addDays = (s, n) => new Date(+parseDate(s) + n * 864e5).toISOString().slice(0, 10);
export const diffDays = (a, b) => Math.round((+parseDate(a) - +parseDate(b)) / 864e5);

// Consecutive bleeding days (allowing a gap of up to `gap` days) form one period.
export function groupPeriods(dates, gap = 2) {
  const out = [];
  for (const d of [...new Set(dates)].sort()) {
    const l = out[out.length - 1];
    if (l && diffDays(d, l.end) <= gap) l.end = d; else out.push({ start: d, end: d });
  }
  return out.map((p) => ({ ...p, length: diffDays(p.end, p.start) + 1 }));
}

// Cycle lengths outside [min,max] (e.g. a forgotten month) are excluded instead of skewing the average.
export function summarize(periods, { min = 15, max = 90, window = 6 } = {}) {
  const all = [];
  for (let i = 1; i < periods.length; i++) all.push(diffDays(periods[i].start, periods[i - 1].start));
  const valid = all.filter((x) => x >= min && x <= max), lengths = valid.slice(-window), n = lengths.length;
  const avg = n ? lengths.reduce((a, b) => a + b, 0) / n : null;
  const sd = n > 1 ? Math.sqrt(lengths.reduce((a, b) => a + (b - avg) ** 2, 0) / (n - 1)) : 0;
  return { lengths, n, avg, sd, excluded: all.length - valid.length };
}

// Always a RANGE; wider when history is short or irregular. Never a guarantee.
export function predictNext(periods, { fallback = 28 } = {}) {
  if (!periods.length) return null;
  const s = summarize(periods), len = s.n ? s.avg : fallback;
  const unc = s.n >= 3 ? Math.max(2, Math.round(s.sd * 1.5)) : s.n >= 1 ? 4 : 5;
  const center = addDays(periods[periods.length - 1].start, Math.round(len));
  return { center, from: addDays(center, -unc), to: addDays(center, unc), basedOnCycles: s.n, uncertaintyDays: unc, lowConfidence: s.n < 3 };
}
