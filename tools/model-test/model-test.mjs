#!/usr/bin/env node
/**
 * Sample attendance for the admin's "Import attendance" demo tool, and an
 * offline check of what the risk model makes of it.
 *
 *   node tools/model-test/model-test.mjs generate [--today YYYY-MM-DD]
 *       Writes sample-attendance.csv (21 students, about six months of school
 *       days up to the day before --today) and answer_key.csv next to this
 *       file. The same file can be downloaded from the import dialog itself.
 *
 *   node tools/model-test/model-test.mjs score [--today YYYY-MM-DD]
 *       Scores the sample with server/src/lib/riskModel.js, the code the live
 *       server runs, and compares each student with the answer key.
 *
 * The data comes from client/src/lib/demoAttendance.js, so the file, the
 * dialog's download and this check always agree.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateDemoAttendance, attendanceCsv, demoAnswerKeyCsv, DEMO_STUDENTS, demoAdmissionNo,
} from '../../client/src/lib/demoAttendance.js';
import { assessStudent } from '../../server/src/lib/riskModel.js';

const here = dirname(fileURLToPath(import.meta.url));
const calendar = JSON.parse(readFileSync(join(here, '../../client/src/data/schoolCalendar.json'), 'utf8'));
const holidays = new Set(calendar.public_holidays.map((h) => h.date));
const isSchoolDay = (d) => !holidays.has(d) && calendar.terms.some((t) => t.start <= d && d <= t.end);

const args = Object.fromEntries(process.argv.slice(3).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const now = new Date();
const today = args.today ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const rows = generateDemoAttendance({ today, isSchoolDay });

const cmd = process.argv[2];
if (cmd === 'generate') {
  writeFileSync(join(here, 'sample-attendance.csv'), attendanceCsv(rows));
  writeFileSync(join(here, 'answer_key.csv'), demoAnswerKeyCsv());
  const dates = rows.map((r) => r.date).sort();
  console.log(`${rows.length} rows for ${DEMO_STUDENTS.length} students, ${dates[0]} to ${dates.at(-1)}`);
  console.log(`  ${join(here, 'sample-attendance.csv')}\n  ${join(here, 'answer_key.csv')}`);
} else if (cmd === 'score') {
  const pad = (s, n) => String(s).padEnd(n);
  let ok = 0;
  console.log(`As of ${today}\n${pad('adm', 8)}${pad('name', 16)}${pad('expect', 8)}${pad('flag', 7)}${pad('model p', 9)}story`);
  DEMO_STUDENTS.forEach((s, i) => {
    const adm = demoAdmissionNo(i);
    const a = assessStudent(rows.filter((r) => r.admissionNo === adm), today);
    const flag = a ? a.flag : 'none';
    if (s.ok.includes(flag)) ok += 1;
    const why = a?.patterns.length ? ` [rule: ${a.patterns.map((p) => p.kind).join(', ')}]` : '';
    console.log(`${pad(adm, 8)}${pad(s.name, 16)}${pad(s.expect, 8)}${pad(flag + (s.ok.includes(flag) ? '' : '!'), 7)}${pad(a ? a.dropoutProbability.toFixed(2) : '-', 9)}${s.story}${why}`);
  });
  console.log(`\n${ok}/${DEMO_STUDENTS.length} acceptable ("!" marks the rest)`);
} else {
  console.log('usage: model-test.mjs generate|score [--today YYYY-MM-DD]');
}
