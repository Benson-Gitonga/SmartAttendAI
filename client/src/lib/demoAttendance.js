/**
 * Sample attendance for the demo import: 21 students, each with a known story
 * (perfect, a Monday habit, a slow slide, a dropout...), over about six months
 * of school days ending the day before `end`'s date. Generated fresh, so the
 * history always reaches yesterday: the risk model counts a school day with no
 * mark as an absence, so an old file would make everyone look absent.
 *
 * Same seed every time, so the same day always gets the same mark.
 * `isSchoolDay(iso)` decides which days get a mark (the page passes the Kenya
 * calendar: term-time weekdays, no public holidays).
 *
 * Also used by tools/model-test/model-test.mjs to score the stories offline.
 */

const HISTORY_DAYS = 183;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const weekday = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
};

/**
 * `mark({ d, ago, r })` gives the mark for school day `d`, where `ago` is how
 * many school days before the last one it is (0 = the last). Returns
 * 'present', 'absent', ['absent', reason], or null (not enrolled yet).
 * `expect` is the flag a teacher would want; `ok` the flags still acceptable.
 */
export const DEMO_STUDENTS = [
  // Should stay green
  { name: 'Amina Wanjiru', story: 'Perfect attendance', expect: 'green', ok: ['green'], mark: () => 'present' },
  { name: 'Brian Kamau', story: 'Perfect attendance', expect: 'green', ok: ['green'], mark: () => 'present' },
  { name: 'Cynthia Atieno', story: 'Good: about 96%, odd single days off', expect: 'green', ok: ['green'],
    mark: ({ r }) => (r() < 0.04 ? 'absent' : 'present') },
  { name: 'David Ochieng', story: 'Good: about 95%, odd single days off', expect: 'green', ok: ['green'],
    mark: ({ r }) => (r() < 0.05 ? 'absent' : 'present') },
  { name: 'Esther Njeri', story: 'Good: about 94%, odd single days off', expect: 'green', ok: ['green', 'amber'],
    mark: ({ r }) => (r() < 0.06 ? 'absent' : 'present') },
  { name: 'Felix Mutua', story: 'Off sick for a week about four months ago, perfect since', expect: 'green', ok: ['green'],
    mark: ({ ago }) => (ago >= 80 && ago <= 84 ? ['absent', 'health'] : 'present') },
  { name: 'Gladys Chebet', story: 'One 3-day absence about three weeks ago, otherwise perfect', expect: 'green', ok: ['green', 'amber'],
    mark: ({ ago }) => (ago >= 14 && ago <= 16 ? 'absent' : 'present') },

  // Worth a look (amber)
  { name: 'Hassan Omar', story: 'Misses most Mondays for the last six weeks', expect: 'amber', ok: ['amber', 'red'],
    mark: ({ d, ago, r }) => (ago < 30 && weekday(d) === 1 && r() < 0.85 ? 'absent' : 'present') },
  { name: 'Irene Wambui', story: 'Friday habit lately (3 of the last 4 Fridays)', expect: 'amber', ok: ['amber', 'red'],
    mark: ({ d, ago, r }) => (ago < 20 && weekday(d) === 5 && ago > 4 ? 'absent' : r() < 0.04 ? 'absent' : 'present') },
  { name: 'James Kiprop', story: 'Slow slide: about 95% until a month ago, about 75% since', expect: 'amber', ok: ['amber', 'red'],
    mark: ({ ago, r }) => (r() < (ago < 20 ? 0.25 : 0.05) ? 'absent' : 'present') },
  { name: 'Kevin Odhiambo', story: 'Steady but weak: about 82% all along', expect: 'amber', ok: ['amber', 'red'],
    mark: ({ r }) => (r() < 0.18 ? 'absent' : 'present') },
  { name: 'Lucy Akinyi', story: 'Sent home over fees for 3 days every month', expect: 'amber', ok: ['amber', 'red'],
    mark: ({ ago }) => (ago % 20 >= 2 && ago % 20 <= 4 ? ['absent', 'fee'] : 'present') },

  // Act now (red)
  { name: 'Moses Kariuki', story: 'Chronic: about 60% attendance all along', expect: 'red', ok: ['red'],
    mark: ({ r }) => (r() < 0.4 ? 'absent' : 'present') },
  { name: 'Nancy Wairimu', story: 'Fine until two weeks ago, absent most days since', expect: 'red', ok: ['red'],
    mark: ({ ago, r }) => (ago < 10 ? (r() < 0.8 ? 'absent' : 'present') : r() < 0.04 ? 'absent' : 'present') },
  { name: 'Oscar Kipchoge', story: 'Good record, but absent the last 5 school days in a row', expect: 'red', ok: ['red'],
    mark: ({ ago }) => (ago < 5 ? 'absent' : 'present') },
  { name: 'Purity Mwende', story: 'Looks like a dropout: absent every day for three weeks', expect: 'red', ok: ['red'],
    mark: ({ ago }) => (ago < 15 ? 'absent' : 'present') },
  { name: 'Quentin Maina', story: 'Poor and getting worse: 80% last term, about 55% this term', expect: 'red', ok: ['red'],
    mark: ({ ago, r }) => (r() < (ago < 45 ? 0.45 : 0.2) ? 'absent' : 'present') },
  { name: 'Victor Barasa', story: 'Never in on Tuesdays or Thursdays (60%)', expect: 'red', ok: ['red'],
    mark: ({ d }) => ([2, 4].includes(weekday(d)) ? 'absent' : 'present') },

  // Edge cases
  { name: 'Rose Nyambura', story: 'Recovered: about 60% last term, perfect this term', expect: 'green', ok: ['green', 'amber'],
    mark: ({ ago, r }) => (ago >= 45 && r() < 0.4 ? 'absent' : 'present') },
  { name: 'Samuel Waweru', story: 'Joined 6 school days ago, perfect so far (too new to judge)', expect: 'none', ok: ['none', 'green'],
    mark: ({ ago }) => (ago < 6 ? 'present' : null) },
  { name: 'Tabitha Moraa', story: 'Transferred in three weeks ago, perfect since', expect: 'green', ok: ['green'],
    mark: ({ ago }) => (ago < 15 ? 'present' : null) },
];

export const demoAdmissionNo = (i) => `DM/${String(i + 1).padStart(3, '0')}`;

/**
 * @param {{ today: string, isSchoolDay: (iso: string) => boolean }} opts
 * @returns {{ admissionNo, fullName, date, status, absenceReason }[]}
 */
export function generateDemoAttendance({ today, isSchoolDay }) {
  const days = [];
  for (let d = addDays(today, -HISTORY_DAYS); d < today; d = addDays(d, 1)) {
    const g = weekday(d);
    if (g >= 1 && g <= 5 && isSchoolDay(d)) days.push(d);
  }
  const rows = [];
  DEMO_STUDENTS.forEach((s, idx) => {
    const r = rng(1000 + idx);
    days.forEach((d, i) => {
      const m = s.mark({ d, ago: days.length - 1 - i, r });
      if (m == null) return;
      const [status, reason] = Array.isArray(m) ? m : [m, ''];
      rows.push({ admissionNo: demoAdmissionNo(idx), fullName: s.name, date: d, status, absenceReason: status === 'absent' ? reason : '' });
    });
  });
  return rows;
}

const cell = (v) => (/[",\r\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));

/** The rows as a CSV the import reads back. */
export function attendanceCsv(rows) {
  const head = ['Admission No', 'Name', 'Date', 'Status', 'Absence Reason'];
  const body = rows.map((r) => [r.admissionNo, r.fullName, r.date, r.status, r.absenceReason].map(cell).join(','));
  return `${[head.join(','), ...body].join('\r\n')}\r\n`;
}

/** What each sample student should be flagged as, to check the model against. */
export function demoAnswerKeyCsv() {
  const head = ['Admission No', 'Name', 'Story', 'Expected Flag', 'Acceptable Flags'];
  const body = DEMO_STUDENTS.map((s, i) => [demoAdmissionNo(i), s.name, s.story, s.expect, s.ok.join(' or ')].map(cell).join(','));
  return `${[head.join(','), ...body].join('\r\n')}\r\n`;
}
