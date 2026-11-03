/**
 * What kind of day a date is on the Kenyan school calendar: a school day, a
 * public holiday, a school break between terms, or a weekend.
 * Data: data/schoolCalendar.json, a copy of ml/training/kenya_calendar.json.
 * Update both each school year.
 */
import calendar from '../data/schoolCalendar.json';

const HOLIDAYS = new Map(calendar.public_holidays.map((h) => [h.date, h.name]));
const TERMS = calendar.terms;
const FIRST_TERM = TERMS[0]?.start ?? null;
const LAST_TERM = TERMS[TERMS.length - 1]?.end ?? null;

function weekday(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

/**
 * @returns {{ kind: 'school'|'holiday'|'break'|'weekend', label: string|null, term: string|null }}
 * 'break' only applies inside the calendar year we have term dates for; other
 * dates are treated as school days so older records still show.
 */
export function dayInfo(iso) {
  const g = weekday(iso);
  if (g === 0 || g === 6) return { kind: 'weekend', label: null, term: null };
  if (HOLIDAYS.has(iso)) return { kind: 'holiday', label: HOLIDAYS.get(iso), term: null };
  const term = TERMS.find((t) => t.start <= iso && iso <= t.end);
  if (term) return { kind: 'school', label: null, term: term.name };
  if (FIRST_TERM && LAST_TERM && iso >= FIRST_TERM && iso <= LAST_TERM) {
    return { kind: 'break', label: 'School break', term: null };
  }
  return { kind: 'school', label: null, term: null };
}

/** Public holidays and breaks in a month, for a short line under the calendar. */
export function monthNotes(monthISO) {
  const prefix = monthISO.slice(0, 7);
  return calendar.public_holidays
    .filter((h) => h.date.startsWith(prefix))
    .sort((a, b) => a.date.localeCompare(b.date));
}
