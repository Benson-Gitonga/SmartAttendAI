# Server (Tier 2 Simulated Backend)

Express + SQLite backend that stands in for the school gate hardware. A mock RFID
reader fires a card scan every 5 seconds; each scan is turned into an attendance
record in SQLite, and ~1 in 4 scans is challenged for a fingerprint match.

## Requirements

- Node.js 22+ (uses the built-in test runner and `--env-file-if-exists`)
- No global tools. `better-sqlite3` ships prebuilt binaries.
- On Windows, run `npm install` from PowerShell, not Git Bash.

## Quick start

```bash
cd server
npm install
npm run db:reset     # create the SQLite file + seed the demo class
npm start            # server on http://localhost:3000, simulation running
```

You'll see scans in the console:

```
[rfid] Faith Achieng (stu-form3b-004) -> present via rfid
[rfid] Moses Kipchoge (stu-form3b-009) -> present via fingerprint (fingerprint verified)
[rfid] Faith Achieng (stu-form3b-004) -> already recorded today, ignored
```

## Where the database lives

By default the SQLite file is **outside the repo**, at
`%LOCALAPPDATA%\smartattend\smartattend.db` (Windows) or
`$TMPDIR/smartattend/smartattend.db` elsewhere.

This is deliberate. The project is usually checked out under `OneDrive/...`, and
OneDrive holds file handles open, which deadlocks SQLite's WAL files after the
first write. If your checkout is **not** under a syncing folder
you can point it back into the repo with `DB_PATH=./data/smartattend.db` in a
`.env` file (see `.env.example`).

## Configuration

All optional. Copy `.env.example` to `.env` to override.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `%LOCALAPPDATA%\smartattend\smartattend.db` | SQLite file, or `:memory:` |
| `RFID_INTERVAL_MS` | `5000` | Gap between simulated scans |
| `FINGERPRINT_CHALLENGE_RATE` | `0.25` | Fraction of scans challenged for a fingerprint |
| `FINGERPRINT_SUCCESS_RATE` | `0.9` | Fraction of challenges the mock scanner passes |
| `SIMULATION_ENABLED` | `true` | Set `false` to boot without the RFID loop |
| `SYNC_API_GATEWAY_URL` | *(unset)* | AWS sync Lambda endpoint. Unset → worker idles |
| `SYNC_API_GATEWAY_KEY` | *(unset)* | `x-api-key` sent with each batch |
| `SYNC_POLL_INTERVAL_MS` | `30000` | How often the worker drains `sync_queue` |
| `SYNC_BATCH_SIZE` | `50` | Records per POST |
| `SYNC_BACKOFF_MIN_MS` / `_MAX_MS` | `60000` / `1800000` | Retry backoff bounds |
| `SYNC_MAX_ATTEMPTS` | `12` | Retryable failures before a row is parked `dead` |
| `SYNC_WORKER_DISABLED` | `false` | Set `true` to boot without the sync worker |

## HTTP API

| Method | Path | Description |
|---|---|---|
| GET | `/health` | status, table count, pending-sync count |
| GET | `/api/students` | the seeded roster |
| GET | `/api/attendance?date=YYYY-MM-DD` | attendance records for a date (default today) |
| GET | `/api/challenges?limit=50` | recent fingerprint challenges |
| GET | `/api/stats?date=YYYY-MM-DD` | counts by capture method, challenge outcomes, pending sync |
| POST | `/api/rfid/scan` | fire one scan now, body `{ "cardUid": "04A1B2C3" }` |
| POST | `/api/sync` | inbound attendance batch from the offline PWA (see below) |
| GET | `/api/gate/classes/:id/attendance?date=YYYY-MM-DD` | one class's records for a day (default today) plus `gate.lastScanAt` - the PWA pulls this before roll call (see below) |
| * | `/api/roster/*` | roster upserts pushed from the PWA (schools, classes, students, cards) |
| GET | `/api/admin/schools/:id/today?date=` | every class's register for a day (school admin) |
| POST/PATCH | `/api/admin/schools/:id/classes`, `/api/admin/classes/:id` | create a class, rename it or change its teacher |
| GET | `/api/admin/schools/:id/teachers` | teachers with their classes |
| GET/PUT | `/api/admin/classes/:id/register?date=` | read, or take/correct, a class's register; PUT needs a `reason` (see below) |
| GET | `/api/teacher/classes` | the classes assigned to the signed-in teacher, with students |
| * | `/api/admin/*` | also: overview, flagged students, follow-ups |
| POST | `/api/auth/login` | school staff sign-in, body `{ "email", "password" }`, returns a token, the user and their school |
| GET | `/api/auth/me` | the signed-in user and their school's current status |
| POST | `/api/schools/register` | a school's application: the school (`pending`) and its admin account (see below) |
| GET | `/api/schools/:id` | a school's status and any review note, for the admin's waiting screen |
| POST | `/api/system-admin/login` | system admin sign-in, body `{ "username", "password" }`, returns a token (see below) |
| GET | `/api/system-admin/schools?status=` | every school, waiting ones first, plus a count per status |
| POST | `/api/system-admin/schools/:id/{approve,reject,disable,enable}` | review a school; body `{ "note", "actor" }`, `note` required to reject |

Valid `cardUid` values are the 10 seeded cards: `04A1B2C3`, `04D4E5F6`,
`0417A8B9`, `04C2D3E4`, `0455667788`, `01020304`, `11223344`, `55667788`,
`AABBCCDD`, `04112233`. The last five are the Wokwi MFRC522 preset cards
used by the simulated gate in [`hardware/wokwi-gate`](../hardware/wokwi-gate).

A gate device with a fingerprint step sends `"interactive": true`. If the scan
is picked for a fingerprint check the reply is `"outcome": "fingerprint-required"`
and nothing is written; the device then resends the scan with
`"fingerprint": "match"` or `"no_match"`.

A scan the device saved while it could not reach the server is replayed later
with `"offline": true`, the device's own `"scannedAt"` time and a `"scanId"`
(a UUID). It is filed under the day it happened, recorded as an unverified card
scan (there was nobody to ask for a fingerprint), and `scanId` becomes the
event id, so sending the same queued scan twice only records it once. Scan
times more than `OFFLINE_SCAN_MAX_AGE_DAYS` old, or from a clock running
ahead, get a `422`. Every replay leaves an `rfid.offline_scan` audit row with
how late it arrived.

Set `DEVICE_API_KEY` and gate devices must send it as the `X-Device-Key`
header, otherwise they get a `401`. The rest of the API is unaffected.

### Staff sign-in

School admins and teachers have accounts on this server (the `users` table),
with scrypt-hashed passwords; there is no Cognito. `POST /api/auth/login`
returns a token signed with `AUTH_TOKEN_SECRET` that lasts
`AUTH_TOKEN_TTL_DAYS` (30). Every staff endpoint needs it as
`Authorization: Bearer <token>` and is limited to the user's own school:

| Endpoint | Who | Notes |
|---|---|---|
| `/api/admin/*` | school admin | another school's id, class or student is a `404` |
| `/api/roster/*` | admin or teacher | another school's row is a `403` |
| `/api/sync` | admin or teacher | a batch with another school's student is a `403` |
| `/api/gate/classes/:id/attendance` | admin or teacher | another school's class is a `404` |
| `/api/students`, `/attendance`, `/challenges`, `/stats` | system admin | platform-wide debug lists |

All of them also answer `403` while the school is pending, rejected or
disabled. The user is re-read on every request, so disabling an account or a
school takes effect at once. Five wrong passwords for one email from one
address lock that pair out for 15 minutes.

`npm run db:seed` adds demo accounts, all with the password `demo1234`:

| Email | Role | School |
|---|---|---|
| `admin@kibera.ac.ke` | school admin | Kibera Secondary (active, with the demo class) |
| `teacher@kibera.ac.ke` | teacher | Kibera Secondary |
| `g.achieng@kisumuday.ac.ke` | school admin | Kisumu Day (pending) |
| `p.mwangi@nyerihigh.ac.ke` | school admin | Nyeri High (pending) |

### School admin supervision

The school admin creates classes and assigns each one a teacher
(`class_groups.teacher_user_id`). Teachers cannot create classes, and may only
change the roster of classes assigned to them. A teacher's device downloads
its classes from `GET /api/teacher/classes`.

`PUT /api/admin/classes/:id/register` takes or corrects the register for any
past day or today: `{ date, reason, note?, marks: [{ studentId, status,
absenceReason? }] }`. `reason` is one of `teacher_absent`, `wrong_mark`,
`late_arrival`, `gate_error`, `other` (which needs a `note`). Each changed mark
updates `attendance_events` in place (or adds one), is queued for the cloud
again, and leaves an `attendance_overrides` row with the old and new mark, the
reason, the admin and the class teacher it was done for. The teacher's device
picks the change up on its next gate pull.

### System admin sign-in

There is one system admin account, and it lives only on the server. Set it with

```
npm run sysadmin:set -- sysadmin
```

which asks for the password twice and writes
`SYSTEM_ADMIN_USERNAME`, a scrypt `SYSTEM_ADMIN_PASSWORD_HASH` and, the first
time, a random `SYSTEM_ADMIN_TOKEN_SECRET` into `server/.env`. Run it again to
change the password. Restart the server afterwards.

`POST /api/system-admin/login` checks the password against the hash and
returns a signed token valid for `SYSTEM_ADMIN_TOKEN_TTL_HOURS` (default 8).
Every other `/api/system-admin/*` call needs `Authorization: Bearer <token>`,
or it gets a `401`. Five wrong passwords from one address lock sign-in for
15 minutes (`429`). Sign-ins, failures and every school change are in the
audit log, with the system admin username as the actor. The username has no
`@`: the PWA sends a sign-in without one here, and anything with one is a
teacher or school admin email. With no account set up the
endpoints answer `503`.

### School approval

A school applies with `POST /api/schools/register`: `school` (`name`,
`county`, optional `subCounty`, `schoolCode`, `schoolType`, `boarding`,
`studentEstimate`) and `applicant` (`fullName`, `email`, `password`, optional
`phone`, `jobTitle`). The applicant becomes the school's admin and is signed in
straight away. The school waits as `pending` until a system admin acts on it:

```
pending --approve--> active --disable--> inactive
   |                   ^                    |
   +--reject--> rejected  +-----enable------+
```

Any other change is a `409` (a rejected school registers again instead). Each
change records who made it, when, and the note, and leaves a `school.*` audit
row. An application is refused with a `409` (and `field`) when the email
already has an account, the school code is already registered, or the same
name is already registered in that county. Nothing is saved from a refused
application.

A school that is not `active` cannot write: `/api/roster/*` and `/api/sync`
answer `403` for its classes and students, so the PWA keeps those changes
queued and sends them once the school is approved or enabled. Schools pushed
by the PWA roster (local mode) are `active` by default. `npm run db:seed` adds
two pending demo schools so the approval queue is not empty.

## How a scan becomes a record

`src/attendance/handler.js`:

1. Resolve the card UID to a student (`rfid_cards` -> `students`). Unknown card -> audit row, stop.
2. With probability `FINGERPRINT_CHALLENGE_RATE`, run the mock fingerprint scan:
   - **match** -> write attendance with `capture_method = 'fingerprint'`, `verified = 1`, and link the challenge row to the event.
   - **no match** -> reject. Nothing is written to `attendance_events`; a `fingerprint_challenges` row with `result = 'no_match'` and an `attendance.rejected` audit row are the buddy-punching trail.
3. No challenge -> write attendance with `capture_method = 'rfid'`, `verified = 0`.
4. A second scan of the same student the same day hits `UNIQUE(student_id, date)` and is reported as a duplicate. No second row is written.

The attendance write, its `sync_queue` entry and the audit row share one
transaction, so a rejected write leaves nothing behind.

## Sync: PWA → here → AWS

Two halves, both backed by `sync_queue`:

**Inbound:** `POST /api/sync` (`src/routes/sync.js`). The offline PWA posts a
batch `{ deviceId, records: [...] }`; the whole batch is validated against
`src/schemas/attendanceSync.schema.js`. A record may carry an optional absence
`reason` (`fee`, `health`, `other`, `unknown`); it is kept only on absences, and a
reason added later to an existing absence counts as an update. Each record is deduplicated on `eventId`
and on `(studentId, date)`: re-sent records are reported as skipped, not errors,
so the PWA can safely retry whole batches. Survivors land in `attendance_events`
(`source = 'client'`) and `sync_queue`, one transaction each. Responds `200` with
`{ received, insertedCount, skippedCount, inserted, skipped }`.

**Outbound:** `src/workers/syncWorker.js`, spawned as a worker thread by
`server.js` (skip it with `SYNC_WORKER_DISABLED=true`). Every
`SYNC_POLL_INTERVAL_MS` it drains `pending` rows, POSTs them in batches to
`SYNC_API_GATEWAY_URL` (the AWS sync Lambda), marks confirmed rows `synced` and
stamps `attendance_events.synced_at`. Retryable failures (network, 429, 5xx) are
rescheduled with exponential backoff; a 4xx parks the row as `failed`; too many
retries parks it as `dead`. With no `SYNC_API_GATEWAY_URL` set the worker just
idles.

With no real AWS yet, point `SYNC_API_GATEWAY_URL` at a local shim around
`../aws/lambda/syncHandler.js`.

## Gate → PWA

`GET /api/gate/classes/:id/attendance` (`src/routes/gate.js`) returns every
record the server holds for one class on one day - gate scans and teacher
marks - in the field names the PWA's local database uses, keeping the server's
`eventId`. The PWA stores them as already synced, so they are never pushed
back. `gate.lastScanAt` is when the RFID/fingerprint hardware last recorded
anyone; the PWA uses it to tell "gate working" from "gate down - take a full
roll call". Unknown class → 404; malformed `date` → 400.

## Schema

9 tables, defined in `src/db/schema.sql` (`CREATE TABLE IF NOT EXISTS`, so it's
safe to run on every boot). Full description in `../docs/schema.md`.

- `schools` -> `class_groups` -> `students` -> `rfid_cards`
- `students` -> `attendance_events` -> `sync_queue` -> (`syncWorker.js`) -> AWS
- `attendance_events` / `students` -> `fingerprint_challenges`
- `students` -> `follow_ups` (contact attempts for flagged students)
- `audit_log`: standalone (action / actor / record / detail / timestamp)

## Tests

```bash
npm test             # node --test
```

Covers: all 8 tables created, seed correctness, attendance write + atomicity,
duplicate prevention (same student/date, reused `event_id`), capture-method
values, the RFID emitter timing (mocked timers), the fingerprint distribution,
the full scan-to-SQLite handler including the ~25% challenge rate, the
`POST /api/sync` ingest (validation, both dedup paths, mixed batches, unknown
student, absence reasons), the gate endpoint, the roster/admin routes, the
risk model, and the sync worker's backoff / batching / cloud-response handling.

## Not built yet

- Absence reasons in the risk score: `src/lib/riskModel.js` still sets the fee
  and illness features to 0
- Real AWS: `syncWorker.js` targets `SYNC_API_GATEWAY_URL`; until that's a
  deployed endpoint, point it at a local shim around `../aws/lambda/syncHandler.js`
