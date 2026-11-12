// The phone (client/src/lib/riskModel.js) and the server (./riskModel.js) keep
// separate copies of the risk model. They must score every student the same.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as server from './riskModel.js';

const here = dirname(fileURLToPath(import.meta.url));
const clientLib = join(here, '..', '..', '..', 'client', 'src', 'lib', 'riskModel.js');
const clientModel = join(here, '..', '..', '..', 'client', 'src', 'data', 'riskModel.json');

let phone;
let dir;

// The phone's copy imports its model JSON the Vite way, which Node can't load,
// so load a copy with the JSON written in.
before(async () => {
  const source = readFileSync(clientLib, 'utf8').replace(
    "import mlModel from '../data/riskModel.json';",
    `const mlModel = ${readFileSync(clientModel, 'utf8')};`,
  );
  assert.ok(!source.includes("from '../data/riskModel.json'"), 'model import rewritten');
  dir = mkdtempSync(join(tmpdir(), 'risk-parity-'));
  const file = join(dir, 'riskModel.mjs');
  writeFileSync(file, source);
  phone = await import(pathToFileURL(file).href);
});

after(() => rmSync(dir, { recursive: true, force: true }));

const AS_OF = '2026-09-07';
const REASONS = ['fee', 'health', 'other', 'unknown', null];

/** 60 school days before AS_OF with a fixed mix of statuses and reasons. */
function history(seed, { mostlyGiven = false } = {}) {
  const rows = [];
  const d = new Date(2026, 8, 6);
  let i = 0;
  while (rows.length < 60) {
    const iso = phone.toISO(d);
    if (phone.isSchoolDay(iso)) {
      const absent = (i * 7 + seed) % 5 < (seed % 4) + 1;
      let reason = absent ? REASONS[(i + seed) % REASONS.length] : null;
      if (mostlyGiven && absent && reason == null && i % 3) reason = 'fee';
      rows.unshift({ date: iso, status: absent ? 'absent' : 'present', reason });
      i += 1;
    }
    d.setDate(d.getDate() - 1);
  }
  return rows;
}

test('phone and server give every student the same features and score', () => {
  let usedReasons = 0;
  for (let seed = 0; seed < 12; seed += 1) {
    for (const mostlyGiven of [false, true]) {
      const rows = history(seed, { mostlyGiven });
      const summary = server.absenceReasonSummary(rows, AS_OF);
      if (summary.used) usedReasons += 1;
      assert.deepEqual(summary, phone.absenceReasonSummary(rows, AS_OF));
      assert.deepEqual(server.computeMlExtraFeatures(rows, AS_OF), phone.computeMlExtraFeatures(rows, AS_OF));
      const p = phone.scoreRiskML(rows, AS_OF);
      const s = server.assessStudent(rows, AS_OF);
      assert.ok(Math.abs(s.dropoutProbability - p.dropoutProbability) < 1e-12, `seed ${seed}`);
      assert.equal(s.flag, p.flag);
    }
  }
  assert.ok(usedReasons > 0, 'some students have enough reasons for them to count');
});
