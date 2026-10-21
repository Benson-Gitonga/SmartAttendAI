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
