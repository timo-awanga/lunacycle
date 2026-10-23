import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, addDays, diffDays, groupPeriods, summarize, predictNext } from '../src/lib/cycle.js';

test('dates: DST, leap years and invalid input', () => {
  assert.equal(diffDays('2026-03-09', '2026-03-08'), 1);        // US DST change
  assert.equal(diffDays('2026-10-26', '2026-10-25'), 1);        // EU DST change
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  for (const bad of ['2026-02-30', '2026-13-01', '26-1-1', '', null]) assert.throws(() => parseDate(bad), RangeError);
});
test('groupPeriods merges adjacent days and tolerates a 1-day gap', () => {
  const p = groupPeriods(['2026-01-03', '2026-01-01', '2026-01-02', '2026-01-02', '2026-01-05', '2026-01-30']);
  assert.deepEqual(p.map((x) => [x.start, x.end, x.length]), [['2026-01-01', '2026-01-05', 5], ['2026-01-30', '2026-01-30', 1]]);
});
test('summarize excludes outliers and handles no data', () => {
  const P = ['2026-01-01', '2026-01-29', '2026-02-27', '2026-06-20'].map((d) => ({ start: d, end: d }));
  const s = summarize(P);
  assert.deepEqual(s.lengths, [28, 29]); assert.equal(s.excluded, 1); assert.equal(summarize([]).avg, null);
});
test('predictNext: null without data, range always, wider when irregular', () => {
  assert.equal(predictNext([]), null);
  const one = predictNext([{ start: '2026-01-01', end: '2026-01-05' }]);
  assert.equal(one.lowConfidence, true); assert.ok(one.from < one.center && one.center < one.to);
  const reg = ['2026-01-01', '2026-01-29', '2026-02-26', '2026-03-26'].map((d) => ({ start: d, end: d }));
  const irr = ['2026-01-01', '2026-01-23', '2026-02-27', '2026-03-31'].map((d) => ({ start: d, end: d }));
  assert.ok(predictNext(irr).uncertaintyDays > predictNext(reg).uncertaintyDays);
  assert.equal(predictNext(reg).center, '2026-04-23');
});
