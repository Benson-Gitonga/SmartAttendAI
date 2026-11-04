import { generateDemoAttendance, attendanceCsv, DEMO_STUDENTS } from './demoAttendance';
import { attendanceFromCsv } from './csv';
import { dayInfo } from './schoolCalendar';

const isSchoolDay = (d) => dayInfo(d).kind === 'school';

describe('sample attendance for the demo import', () => {
  const rows = generateDemoAttendance({ today: '2026-11-04', isSchoolDay });

  test('covers every sample student, on school days only, up to yesterday', () => {
    expect(new Set(rows.map((r) => r.admissionNo)).size).toBe(DEMO_STUDENTS.length);
    expect(rows.every((r) => isSchoolDay(r.date) && r.date < '2026-11-04')).toBe(true);
    expect(rows.some((r) => r.date === '2026-11-03')).toBe(true);
    expect(rows.some((r) => r.date === '2026-10-20')).toBe(false); // Mashujaa Day
  });

  test('is the same every time', () => {
    expect(generateDemoAttendance({ today: '2026-11-04', isSchoolDay })).toEqual(rows);
  });

  test('reads back through the import parser unchanged', () => {
    const back = attendanceFromCsv(attendanceCsv(rows));
    expect(back.problems).toEqual([]);
    expect(back.students).toBe(DEMO_STUDENTS.length);
    expect(back.rows).toEqual(rows.map(({ absenceReason, ...r }) => (absenceReason ? { ...r, absenceReason } : r)));
  });
});
