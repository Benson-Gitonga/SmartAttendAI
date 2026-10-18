// Demo roster. Uses the same IDs as client/src/db/seedData.js so records sync.
import { openDatabase } from './index.js';
import { config } from '../config.js';
import { upsertCard } from './repository.js';

export const DEMO_SCHOOL = {
  school_id: 'school-kibera-001',
  name: 'Kibera Secondary School',
  county: 'Nairobi',
};

// Schools that registered and are waiting for a system admin, so the approval
// queue has something in it on a fresh database. Fixed IDs keep a re-seed safe.
export const PENDING_SCHOOLS = [
  {
    school_id: 'school-demo-pending-001',
    name: 'Kisumu Day Secondary School',
    county: 'Kisumu',
    admin_name: 'Grace Achieng',
    admin_email: 'g.achieng@kisumuday.ac.ke',
    admin_phone: '0712345678',
  },
  {
    school_id: 'school-demo-pending-002',
    name: 'Nyeri High School',
    county: 'Nyeri',
    admin_name: 'Peter Mwangi',
    admin_email: 'p.mwangi@nyerihigh.ac.ke',
    admin_phone: '0722123456',
  },
];

export const DEMO_CLASS = {
  class_group_id: 'class-form3b-001',
  school_id: DEMO_SCHOOL.school_id,
  grade: 'Form 3',
  stream: 'B',
  academic_year: 2026,
};

// 4-byte hex UIDs, like a MIFARE Classic card. Students 006-010 hold the
// Wokwi MFRC522 preset cards (Blue, Green, Yellow, Red, NFC Tag) so the
// simulated gate in hardware/wokwi-gate scans real roster cards. The Wokwi
// Key Fob (C0FFEE99) is deliberately unregistered.
export const DEMO_STUDENTS = [
  { student_id: 'stu-form3b-001', admission_no: '3B/001', full_name: 'Amina Wanjiru',   card_uid: '04A1B2C3' },
  { student_id: 'stu-form3b-002', admission_no: '3B/002', full_name: 'Brian Kamau',     card_uid: '04D4E5F6' },
  { student_id: 'stu-form3b-003', admission_no: '3B/003', full_name: 'Daniel Mutua',    card_uid: '0417A8B9' },
  { student_id: 'stu-form3b-004', admission_no: '3B/004', full_name: 'Faith Achieng',   card_uid: '04C2D3E4' },
  { student_id: 'stu-form3b-005', admission_no: '3B/005', full_name: 'Grace Muthoni',   card_uid: '0455667788' },
  { student_id: 'stu-form3b-006', admission_no: '3B/006', full_name: 'Jack Otieno',     card_uid: '01020304' },
  { student_id: 'stu-form3b-007', admission_no: '3B/007', full_name: 'Kevin Odhiambo',  card_uid: '11223344' },
  { student_id: 'stu-form3b-008', admission_no: '3B/008', full_name: 'Lydia Chebet',    card_uid: '55667788' },
  { student_id: 'stu-form3b-009', admission_no: '3B/009', full_name: 'Moses Kipchoge',  card_uid: 'AABBCCDD' },
  { student_id: 'stu-form3b-010', admission_no: '3B/010', full_name: 'Naomi Waweru',    card_uid: '04112233' }, // Wokwi NFC Tag reads as its first 4 bytes
].map((s) => ({ ...s, class_group_id: DEMO_CLASS.class_group_id, enrolled_at: '2026-01-06' }));


/** Safe to re-run. Does not touch attendance or the sync queue. */
export function seed(db) {
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO schools (school_id, name, county) VALUES (@school_id, @name, @county)
       ON CONFLICT(school_id) DO UPDATE SET name = excluded.name, county = excluded.county`
    ).run(DEMO_SCHOOL);

    // Only inserted, never updated: once a demo school is approved or rejected
    // a re-seed leaves that decision alone.
    const insertPending = db.prepare(
      `INSERT INTO schools (school_id, name, county, status, admin_name, admin_email, admin_phone)
       VALUES (@school_id, @name, @county, 'pending', @admin_name, @admin_email, @admin_phone)
       ON CONFLICT(school_id) DO NOTHING`
    );
    for (const school of PENDING_SCHOOLS) insertPending.run(school);

    db.prepare(
      `INSERT INTO class_groups (class_group_id, school_id, grade, stream, academic_year)
       VALUES (@class_group_id, @school_id, @grade, @stream, @academic_year)
       ON CONFLICT(class_group_id) DO UPDATE SET
         grade = excluded.grade, stream = excluded.stream, academic_year = excluded.academic_year`
    ).run(DEMO_CLASS);

    const upsertStudent = db.prepare(
      `INSERT INTO students (student_id, class_group_id, admission_no, full_name, enrolled_at)
       VALUES (@student_id, @class_group_id, @admission_no, @full_name, @enrolled_at)
       ON CONFLICT(student_id) DO UPDATE SET
         admission_no = excluded.admission_no, full_name = excluded.full_name`
    );

    for (const s of DEMO_STUDENTS) {
      upsertStudent.run(s);
      upsertCard(db, { cardUid: s.card_uid, studentId: s.student_id });
    }
  });
  tx();

  return {
    school: DEMO_SCHOOL.school_id,
    pendingSchools: PENDING_SCHOOLS.length,
    classGroup: DEMO_CLASS.class_group_id,
    students: DEMO_STUDENTS.length,
  };
}

export const DEMO_CARD_UIDS = DEMO_STUDENTS.map((s) => s.card_uid);

// Run directly: node src/db/seed.js
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('seed.js')) {
  const db = openDatabase();
  const result = seed(db);
  console.log(`Seeded ${config.dbPath}`);
  console.log(result);
  db.close();
}
