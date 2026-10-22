/**
 * Demo data for the Kibera demo school: three more classes with their
 * teachers, about three months of attendance for every demo student, and a
 * few follow-ups, so the at-risk lists, reports and profiles have something
 * real-looking in them on a fresh database.
 *
 * School days follow the 2026 Kenya term calendar (ml/training/kenya_calendar.json):
 * weekdays inside a term, minus public holidays. Each student follows a
 * profile (steady, a Monday habit, a recent run of absences, ...) chosen so
 * the risk model flags a mix of red and amber students.
 *
 * Only fills school days that have no record yet, so real registers are never
 * overwritten, and nothing is put in the sync queue: demo rows must never
 * reach the cloud. Runs on every server start; DEMO_DATA=false turns it off.
 *
 * Run by hand: npm run db:seed-demo
 */
import { openDatabase } from './index.js';
import { DEMO_SCHOOL, DEMO_CLASS, DEMO_STUDENTS, DEMO_PASSWORD } from './seed.js';
import { upsertClassGroup, upsertStudent } from './repository.js';
import { hashPassword } from '../auth/systemAdminAuth.js';

const HISTORY_DAYS = 92; // about three months

// From ml/training/kenya_calendar.json. A year not listed counts every weekday.
const TERMS = {
  2026: [['2026-01-05', '2026-04-03'], ['2026-05-04', '2026-08-07'], ['2026-09-01', '2026-12-04']],
};
const PUBLIC_HOLIDAYS = new Set([
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-01', '2026-05-27', '2026-06-01',
  '2026-10-10', '2026-10-20', '2026-12-12', '2026-12-25', '2026-12-26',
]);

// Teachers for the extra classes. They sign in with DEMO_PASSWORD.
const EXTRA_TEACHERS = [
  { email: 'g.njoroge@kibera.ac.ke', full_name: 'Grace Njoroge', job_title: 'Class teacher, Form 1 A' },
  { email: 'j.mutai@kibera.ac.ke', full_name: 'James Mutai', job_title: 'Class teacher, Form 2 C' },
  { email: 'p.kamau@kibera.ac.ke', full_name: 'Peter Kamau', job_title: 'Class teacher, Form 4 D' },
];

const EXTRA_CLASSES = [
  {
    classGroupId: 'class-form1a-001', grade: 'Form 1', stream: 'A', teacher: 'g.njoroge@kibera.ac.ke',
    students: [
      ['stu-form1a-001', '1A/001', 'Beatrice Nyambura', 'steady'],
      ['stu-form1a-002', '1A/002', 'Collins Mutiso', 'steady'],
      ['stu-form1a-003', '1A/003', 'Dennis Kiptoo', 'mondays'],
      ['stu-form1a-004', '1A/004', 'Esther Adhiambo', 'steady'],
      ['stu-form1a-005', '1A/005', 'Fredrick Omondi', 'declining'],
      ['stu-form1a-006', '1A/006', 'Ivy Chepkoech', 'steady'],
      ['stu-form1a-007', '1A/007', 'Joseph Mwangi', 'fees'],
      ['stu-form1a-008', '1A/008', 'Mercy Akinyi', 'steady'],
      ['stu-form1a-009', '1A/009', 'Samuel Kibet', 'recovered'],
      ['stu-form1a-010', '1A/010', 'Tabitha Nduta', 'steady'],
    ],
  },
  {
    classGroupId: 'class-form2c-001', grade: 'Form 2', stream: 'C', teacher: 'j.mutai@kibera.ac.ke',
    students: [
      ['stu-form2c-001', '2C/001', 'Abdi Hassan', 'steady'],
      ['stu-form2c-002', '2C/002', 'Brenda Atieno', 'fridays'],
      ['stu-form2c-003', '2C/003', 'Caleb Wekesa', 'steady'],
      ['stu-form2c-004', '2C/004', 'Diana Moraa', 'sick'],
      ['stu-form2c-005', '2C/005', 'Elijah Kirui', 'chronic'],
      ['stu-form2c-006', '2C/006', 'Florence Wambui', 'steady'],
      ['stu-form2c-007', '2C/007', 'Hassan Ali', 'steady'],
      ['stu-form2c-008', '2C/008', 'Irene Jepchirchir', 'steady'],
      ['stu-form2c-009', '2C/009', 'John Ouma', 'streak'],
    ],
  },
  {
    classGroupId: 'class-form4d-001', grade: 'Form 4', stream: 'D', teacher: 'p.kamau@kibera.ac.ke',
    students: [
      ['stu-form4d-001', '4D/001', 'Alfred Njuguna', 'steady'],
      ['stu-form4d-002', '4D/002', 'Catherine Wairimu', 'steady'],
      ['stu-form4d-003', '4D/003', 'Duncan Cheruiyot', 'steady'],
      ['stu-form4d-004', '4D/004', 'Faith Nekesa', 'wobbling'],
      ['stu-form4d-005', '4D/005', 'George Onyango', 'steady'],
      ['stu-form4d-006', '4D/006', 'Hellen Wanjala', 'sick'],
      ['stu-form4d-007', '4D/007', 'Isaac Barasa', 'steady'],
      ['stu-form4d-008', '4D/008', 'Lucy Muthoni', 'steady'],
    ],
  },
];

// Ms. Otieno's Form 3 B, the class the demo teacher signs in to.
const FORM3B_PROFILES = {
  'stu-form3b-001': 'steady', 'stu-form3b-002': 'steady', 'stu-form3b-003': 'mondays',
  'stu-form3b-004': 'steady', 'stu-form3b-005': 'sick', 'stu-form3b-006': 'steady',
  'stu-form3b-007': 'declining', 'stu-form3b-008': 'wobbling', 'stu-form3b-009': 'steady',
  'stu-form3b-010': 'steady',
};

/**
 * Each profile maps one school day to [status, reason]. `fromEnd` counts
 * school days back from the most recent one (1 = yesterday's register).
 */
const PROFILES = {
  steady: ({ rand }) => (rand < 0.04 ? ['absent', rand < 0.02 ? 'health' : 'unknown'] : ['present']),
  // Misses most Mondays lately.
  mondays: ({ rand, dow, fromEnd }) => {
    if (dow === 1 && fromEnd <= 25) return rand < 0.85 ? ['absent', 'unknown'] : ['present'];
    return rand < 0.05 ? ['absent', 'unknown'] : ['present'];
  },
  fridays: ({ rand, dow, fromEnd }) => {
    if (dow === 5 && fromEnd <= 25) return rand < 0.8 ? ['absent', 'other'] : ['present'];
    return rand < 0.04 ? ['absent', 'unknown'] : ['present'];
  },
  // Absences climbing over the last month, ending in a run that is still going.
  declining: ({ rand, fromEnd }) => {
    if (fromEnd <= 5) return ['absent', 'unknown'];
    const p = fromEnd <= 22 ? 0.12 + (22 - fromEnd) * 0.02 : 0.05;
    return rand < p ? ['absent', 'unknown'] : ['present'];
  },
  // Was fine, then a sudden run of absences this week and last.
  streak: ({ rand, fromEnd }) => {
    if (fromEnd <= 4) return ['absent', 'unknown'];
    return rand < 0.06 ? ['absent', 'unknown'] : ['present'];
  },
  // Sent home in blocks around the fee deadlines at the start of each month.
  fees: ({ rand, date, fromEnd }) => {
    const day = Number(date.slice(8));
    if (day >= 3 && day <= 5 && fromEnd <= 40) return rand < 0.8 ? ['absent', 'fee'] : ['present'];
    return rand < 0.03 ? ['absent', 'fee'] : ['present'];
  },
  // About one day in four, all term.
  chronic: ({ rand }) => (rand < 0.26 ? ['absent', rand < 0.1 ? 'health' : 'unknown'] : ['present']),
  wobbling: ({ rand, fromEnd }) => {
    if (fromEnd >= 9 && fromEnd <= 10) return ['absent', 'unknown'];
    const p = fromEnd <= 18 ? 0.16 : 0.05;
    return rand < p ? ['absent', 'unknown'] : ['present'];
  },
  // A bad stretch last term, fine since: should not be flagged now.
  recovered: ({ rand, fromEnd }) => {
    const p = fromEnd > 35 ? 0.3 : 0.03;
    return rand < p ? ['absent', 'unknown'] : ['present'];
  },
  // Two days off ill a few weeks back, otherwise steady.
  sick: ({ rand, fromEnd }) => {
    if (fromEnd >= 15 && fromEnd <= 16) return ['absent', 'health'];
    if (fromEnd >= 12 && fromEnd <= 19) return ['present'];
    return rand < 0.02 ? ['absent', 'unknown'] : ['present'];
  },
};

function mulberry32(seed) {
  return function next() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function isoAddDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function todayISO(now = new Date()) {
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().split('T')[0];
}
const weekday = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
};

export function isSchoolDay(iso) {
  const dow = weekday(iso);
  if (dow === 0 || dow === 6 || PUBLIC_HOLIDAYS.has(iso)) return false;
  const terms = TERMS[iso.slice(0, 4)];
  return !terms || terms.some(([start, end]) => iso >= start && iso <= end);
}

/** School days in the HISTORY_DAYS before today, oldest first. Today is left for the real register. */
export function demoSchoolDays(today = new Date(), days = HISTORY_DAYS) {
  const todayIso = todayISO(today);
  const out = [];
  for (let n = days; n >= 1; n -= 1) {
    const date = isoAddDays(todayIso, -n);
    if (isSchoolDay(date)) out.push(date);
  }
  return out;
}

function seedExtraClasses(db) {
  const insertTeacher = db.prepare(
    `INSERT INTO users (user_id, email, full_name, job_title, role, school_id, password_hash)
     VALUES (@user_id, @email, @full_name, @job_title, 'teacher', @school_id, @password_hash)
     ON CONFLICT DO NOTHING`
  );
  const passwordHash = hashPassword(DEMO_PASSWORD);
  for (const t of EXTRA_TEACHERS) {
    insertTeacher.run({ ...t, user_id: `user-demo-${t.email.split('@')[0]}-${DEMO_SCHOOL.school_id}`, school_id: DEMO_SCHOOL.school_id, password_hash: passwordHash });
  }

  const assign = db.prepare(
    `UPDATE class_groups
        SET teacher_user_id = (SELECT user_id FROM users WHERE email = @email), teacher_name = @fullName
      WHERE class_group_id = @classGroupId AND teacher_user_id IS NULL`
  );
  const exists = db.prepare(`SELECT school_id AS schoolId FROM class_groups WHERE class_group_id = ?`);
  const studentExists = db.prepare(`SELECT 1 FROM students WHERE student_id = ?`);
  for (const cls of EXTRA_CLASSES) {
    // Created once. After that the school admin owns the class, so a restart
    // must not undo a rename or a removed student.
    const current = exists.get(cls.classGroupId);
    if (!current || current.schoolId !== DEMO_SCHOOL.school_id) {
      const teacher = EXTRA_TEACHERS.find((t) => t.email === cls.teacher);
      upsertClassGroup(db, {
        classGroupId: cls.classGroupId, schoolId: DEMO_SCHOOL.school_id, grade: cls.grade, stream: cls.stream,
        academicYear: DEMO_CLASS.academic_year, teacherName: teacher.full_name,
      });
      assign.run({ email: teacher.email, fullName: teacher.full_name, classGroupId: cls.classGroupId });
      for (const [studentId, admissionNo, fullName] of cls.students) {
        if (studentExists.get(studentId)) continue;
        upsertStudent(db, { studentId, classGroupId: cls.classGroupId, admissionNo, fullName, enrolledAt: '2026-01-06' });
      }
    }
  }
}

function profileFor(studentId) {
  if (FORM3B_PROFILES[studentId]) return FORM3B_PROFILES[studentId];
  for (const cls of EXTRA_CLASSES) {
    const row = cls.students.find(([id]) => id === studentId);
    if (row) return row[3];
  }
  return 'steady';
}

/** Follow-ups already logged for a few flagged students, one recent and one stale. */
function seedFollowUps(db) {
  const today = todayISO();
  const rows = [
    { studentId: 'stu-form3b-007', flag: 'red', method: 'parent_call', note: 'Mother says he has been helping at the family shop. Asked her to send him back on Monday.', actor: 'teacher@kibera.ac.ke', daysAgo: 2 },
    { studentId: 'stu-form1a-005', flag: 'amber', method: 'sms', note: 'Sent the guardian an SMS about the missed days.', actor: 'g.njoroge@kibera.ac.ke', daysAgo: 24 },
    { studentId: 'stu-form4d-004', flag: 'amber', method: 'meeting', note: 'Spoke with Faith after class. Says she has been unwell; will check in next week.', actor: 'p.kamau@kibera.ac.ke', daysAgo: 6 },
  ];
  const has = db.prepare(`SELECT 1 FROM follow_ups WHERE student_id = ? LIMIT 1`);
  const student = db.prepare(`SELECT 1 FROM students WHERE student_id = ?`);
  const insert = db.prepare(
    `INSERT INTO follow_ups (student_id, flag, method, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  );
  let added = 0;
  for (const r of rows) {
    if (!student.get(r.studentId) || has.get(r.studentId)) continue;
    insert.run(r.studentId, r.flag, r.method, r.note, r.actor, `${isoAddDays(today, -r.daysAgo)} 10:15:00`);
    added += 1;
  }
  return added;
}

/** @returns {{classes: number, students: number, records: number, followUps: number}} */
export function seedDemoData(db, today = new Date()) {
  let records = 0;
  let followUps = 0;
  const schoolDays = demoSchoolDays(today);
  const total = schoolDays.length;

  db.transaction(() => {
    seedExtraClasses(db);

    // Only the demo students: anyone the school admin added gets no made-up history.
    const demoIds = new Set([
      ...DEMO_STUDENTS.map((s) => s.student_id),
      ...EXTRA_CLASSES.flatMap((c) => c.students.map(([id]) => id)),
    ]);
    const students = db
      .prepare(`SELECT student_id AS studentId FROM students WHERE active = 1`)
      .all()
      .filter((s) => demoIds.has(s.studentId));

    // A demo row: synced_at is set and there is no sync_queue row, so it stays out of the cloud.
    const insert = db.prepare(
      `INSERT INTO attendance_events
         (event_id, student_id, date, status, capture_method, verified, recorded_by, source, reason, created_at, synced_at)
       VALUES (@eventId, @studentId, @date, @status, 'import', 0, NULL, 'simulation', @reason, @createdAt, @createdAt)
       ON CONFLICT DO NOTHING`
    );
    for (const { studentId } of students) {
      const profile = PROFILES[profileFor(studentId)] ?? PROFILES.steady;
      schoolDays.forEach((date, idx) => {
        const rand = mulberry32(hashStr(`${studentId}:${date}`))();
        const [status, reason = null] = profile({ rand, date, dow: weekday(date), fromEnd: total - idx });
        const info = insert.run({
          eventId: `demo-${studentId}-${date}`,
          studentId,
          date,
          status,
          reason: status === 'absent' ? reason : null,
          createdAt: `${date} 07:${String(20 + Math.floor(rand * 35)).padStart(2, '0')}:00`,
        });
        records += info.changes;
      });
    }
    followUps = seedFollowUps(db);
  })();

  return { classes: EXTRA_CLASSES.length + 1, schoolDays: total, records, followUps };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('seedDemoData.js')) {
  const db = openDatabase();
  console.log(seedDemoData(db));
  db.close();
}
