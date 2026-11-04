/**
 * Minimal CSV reading for class-list imports: quoted fields, "" escapes,
 * commas or semicolons (Excel in some locales saves with ;), CRLF or LF.
 */
export function parseCsv(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

// Header names people actually use, mapped to the student fields.
const HEADERS = {
  fullName: ['name', 'full name', 'fullname', 'student name', 'student', 'learner name', 'names'],
  admissionNo: ['admission no', 'admission number', 'adm no', 'adm', 'admission', 'adm. no.', 'adm no.', 'upi', 'reg no'],
  guardianPhone: ['guardian phone', 'parent phone', 'phone', 'guardian contact', 'parent contact', 'contact', 'mobile'],
  guardianEmail: ['guardian email', 'parent email', 'email'],
};
const norm = (h) => h.toLowerCase().replace(/[_]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Turn a class-list CSV into students. The first row must be headers; a name
 * column is required. Returns { students, problems } where problems are
 * row-numbered (as the spreadsheet shows them) messages.
 */
export function studentsFromCsv(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return { students: [], problems: ['The file is empty.'] };
  const header = rows[0].map(norm);
  const col = Object.fromEntries(Object.entries(HEADERS).map(([field, names]) => [field, header.findIndex((h) => names.includes(h))]));
  if (col.fullName < 0) {
    return { students: [], problems: ['The first row must be headings, with a "Name" column (and optionally "Admission No", "Guardian Phone", "Guardian Email").'] };
  }

  const problems = [];
  const students = [];
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const get = (field) => (col[field] >= 0 ? (r[col[field]] ?? '').trim() : '');
    const student = {
      fullName: get('fullName').replace(/\s+/g, ' '),
      admissionNo: get('admissionNo'),
      guardianPhone: get('guardianPhone').replace(/[\s-]/g, ''),
      guardianEmail: get('guardianEmail'),
    };
    if (student.fullName.length < 2) { problems.push(`Row ${line}: no name.`); return; }
    if (student.guardianPhone && !/^(\+254|0)[17]\d{8}$/.test(student.guardianPhone)) {
      // Spreadsheets drop the leading 0 of phone numbers.
      if (/^[17]\d{8}$/.test(student.guardianPhone)) student.guardianPhone = `0${student.guardianPhone}`;
      else if (/^254[17]\d{8}$/.test(student.guardianPhone)) student.guardianPhone = `+${student.guardianPhone}`;
      else { problems.push(`Row ${line}: "${student.guardianPhone}" is not a Kenyan mobile number.`); return; }
    }
    if (student.guardianEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(student.guardianEmail)) {
      problems.push(`Row ${line}: "${student.guardianEmail}" is not an email address.`);
      return;
    }
    students.push(Object.fromEntries(Object.entries(student).filter(([, v]) => v)));
  });
  return { students, problems };
}

export const STUDENT_CSV_TEMPLATE = 'Name,Admission No,Guardian Phone,Guardian Email\r\nAmina Hassan,KB/2026/001,0712345678,\r\n';

// Attendance import (demo tool). Header names, as for students.
const ATTENDANCE_HEADERS = {
  admissionNo: HEADERS.admissionNo,
  fullName: HEADERS.fullName,
  date: ['date', 'day'],
  status: ['status', 'attendance', 'present/absent', 'mark'],
  absenceReason: ['absence reason', 'reason'],
};
const STATUS_WORDS = { present: 'present', p: 'present', '1': 'present', yes: 'present', absent: 'absent', a: 'absent', '0': 'absent', no: 'absent' };
const REASON_WORDS = { fee: 'fee', fees: 'fee', health: 'health', sick: 'health', other: 'other', unknown: 'unknown' };

/** YYYY-MM-DD, or D/M/YYYY as Excel in Kenya saves it. Null if neither. */
function isoDate(text) {
  const t = text.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

/**
 * Turn an attendance CSV (one row per student per day) into rows for the
 * import. Admission No, Date and Status are required; Name lets the server
 * enrol a student it has not seen; Absence Reason is optional.
 * Returns { rows, problems, students } with row-numbered problems.
 */
export function attendanceFromCsv(text) {
  const all = parseCsv(text);
  if (all.length === 0) return { rows: [], problems: ['The file is empty.'], students: 0 };
  const header = all[0].map(norm);
  const col = Object.fromEntries(Object.entries(ATTENDANCE_HEADERS).map(([field, names]) => [field, header.findIndex((h) => names.includes(h))]));
  if (col.admissionNo < 0 || col.date < 0 || col.status < 0) {
    return { rows: [], problems: ['The first row must be headings, with "Admission No", "Date" and "Status" columns (and optionally "Name" and "Absence Reason").'], students: 0 };
  }

  const problems = [];
  const rows = [];
  all.slice(1).forEach((r, i) => {
    const line = i + 2;
    const get = (field) => (col[field] >= 0 ? (r[col[field]] ?? '').trim() : '');
    const admissionNo = get('admissionNo');
    const date = isoDate(get('date'));
    const status = STATUS_WORDS[get('status').toLowerCase()];
    const reasonText = get('absenceReason').toLowerCase();
    const absenceReason = REASON_WORDS[reasonText];
    if (!admissionNo) return problems.push(`Row ${line}: no admission number.`);
    if (!date) return problems.push(`Row ${line}: "${get('date')}" is not a date (use YYYY-MM-DD).`);
    if (!status) return problems.push(`Row ${line}: status "${get('status')}" should be present or absent.`);
    if (reasonText && !absenceReason) return problems.push(`Row ${line}: absence reason "${reasonText}" should be fee, health, other or unknown.`);
    const fullName = get('fullName').replace(/\s+/g, ' ');
    rows.push({
      admissionNo,
      date,
      status,
      ...(fullName ? { fullName } : {}),
      ...(status === 'absent' && absenceReason ? { absenceReason } : {}),
    });
    return undefined;
  });
  const students = new Set(rows.map((r) => r.admissionNo.toUpperCase())).size;
  return { rows, problems, students };
}
