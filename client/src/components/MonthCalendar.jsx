import { useState } from 'react';
import { toISO } from '../lib/riskModel';
import { dayInfo, monthNotes } from '../lib/schoolCalendar';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function addMonths(iso, n) {
  const [y, m] = iso.split('-').map(Number);
  return toISO(new Date(y, m - 1 + n, 1));
}

function fmtShort(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * School-day month calendar (Mon-Fri) that is easy to read at a glance: each
 * day is tinted by what happened and says it in a word. Public holidays and
 * school breaks are marked by name.
 *
 * `getDay(iso, info)` returns `{ tone, text, sub?, clickable? }` for a school
 * day; `info` is the calendar's view of the day (see lib/schoolCalendar).
 * Tones: present | absent | late | good | fair | low | none | future.
 */
export default function MonthCalendar({
  title, subtitle, firstMonth, getDay, legend = [], selected = null, onPick, children,
}) {
  const today = toISO(new Date());
  const thisMonth = `${today.slice(0, 7)}-01`;
  const [month, setMonth] = useState(thisMonth);

  const [y, m] = month.split('-').map(Number);
  const weeks = [];
  let week = null;
  for (let d = 1; d <= new Date(y, m, 0).getDate(); d += 1) {
    const iso = toISO(new Date(y, m - 1, d));
    const g = new Date(y, m - 1, d).getDay();
    if (g === 0 || g === 6) continue;
    if (!week || g === 1) {
      week = Array(5).fill(null);
      weeks.push(week);
    }
    week[g - 1] = iso;
  }
  const label = new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const holidays = monthNotes(month).filter((h) => dayInfo(h.date).kind === 'holiday' && ![0, 6].includes(new Date(`${h.date}T00:00:00`).getDay()));
  const atStart = firstMonth && month.slice(0, 7) <= firstMonth.slice(0, 7);
  const atEnd = month.slice(0, 7) >= thisMonth.slice(0, 7);

  const cell = (iso) => {
    const info = dayInfo(iso);
    const future = iso > today;
    if (info.kind === 'holiday') return { tone: 'holiday', text: 'Holiday', sub: info.label, clickable: false };
    if (info.kind === 'break') return { tone: 'break', text: 'No school', sub: 'School break', clickable: false };
    if (future) return { tone: 'future', text: '', clickable: false };
    return { clickable: true, ...getDay(iso, info) };
  };

  return (
    <div className="mcal">
      <div className="mcal__head">
        <div>
          <h3 className="panel__title">{title}</h3>
          {subtitle && <p className="panel__sub">{typeof subtitle === 'function' ? subtitle(month) : subtitle}</p>}
        </div>
        <div className="mcal__nav">
          <button type="button" className="icon-btn" onClick={() => setMonth((v) => addMonths(v, -1))} disabled={atStart} aria-label="Previous month">
            <ChevronLeftIcon size={16} />
          </button>
          <span className="mcal__month">{label}</span>
          <button type="button" className="icon-btn" onClick={() => setMonth((v) => addMonths(v, 1))} disabled={atEnd} aria-label="Next month">
            <ChevronRightIcon size={16} />
          </button>
          {month !== thisMonth && (
            <button type="button" className="linkbtn mcal__today" onClick={() => setMonth(thisMonth)}>This month</button>
          )}
        </div>
      </div>

      <div className="mcal__grid" role="grid" aria-label={label}>
        {WEEKDAYS.map((d) => <div key={d} className="mcal__dow" role="columnheader">{d}</div>)}
        {weeks.flat().map((iso, i) => {
          if (!iso) return <div key={`e${i}`} className="mcal__day mcal__day--empty" />;
          const c = cell(iso);
          const classes = [
            'mcal__day',
            `mcal__day--${c.tone ?? 'none'}`,
            iso === today ? 'is-today' : '',
            selected === iso ? 'is-selected' : '',
          ].filter(Boolean).join(' ');
          const body = (
            <>
              <span className="mcal__date">
                {Number(iso.slice(8, 10))}
                {iso === today && <span className="mcal__today-tag">Today</span>}
              </span>
              {c.text && <span className="mcal__text">{c.text}</span>}
              {c.sub && <span className="mcal__sub">{c.sub}</span>}
            </>
          );
          return c.clickable && onPick ? (
            <button
              key={iso}
              type="button"
              className={classes}
              aria-pressed={selected === iso}
              aria-label={`${fmtShort(iso)}: ${[c.text, c.sub].filter(Boolean).join(', ') || 'no record'}`}
              onClick={() => onPick(iso)}
            >
              {body}
            </button>
          ) : (
            <div key={iso} className={classes} title={[c.text, c.sub].filter(Boolean).join(': ')}>{body}</div>
          );
        })}
      </div>

      {legend.length > 0 && (
        <ul className="mcal__legend">
          {legend.map((l) => (
            <li key={l.label}><span className={`mcal__swatch mcal__day--${l.tone}`} />{l.label}</li>
          ))}
          <li><span className="mcal__swatch mcal__day--holiday" />Public holiday</li>
          <li><span className="mcal__swatch mcal__day--break" />School break</li>
        </ul>
      )}

      {holidays.length > 0 && (
        <p className="mcal__notes">
          <b>Holidays this month:</b>{' '}
          {holidays.map((h, i) => (
            <span key={h.date}>{i > 0 && ', '}{h.name} ({fmtShort(h.date)})</span>
          ))}
        </p>
      )}

      {children}
    </div>
  );
}
