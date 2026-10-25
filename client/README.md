# Client (Tier 1 Offline-First PWA)

React 19 + Vite installable PWA that a teacher uses to take attendance from a
phone or tablet with no reliable connectivity. Local PIN auth, an offline
roster/attendance store in IndexedDB, and a background sync queue that drains
to the Tier 2 server (`../server`) once the device is back online.

## Requirements

- Node.js 22+
- On Windows, run `npm install` from PowerShell, not Git Bash (see
  `../server/README.md` for why).

## Quick start

```bash
cd client
npm install
npm run dev        # http://localhost:5173, /api/* proxied to Tier 2 on :3000
```

Start `../server` first (`npm start` there). The dev server proxies `/api/*` to
`http://localhost:3000` (`vite.config.js`). Without it the app still works
offline, and sync attempts stay queued.

## Roles

Chosen at sign-up (`components/LoginScreen.jsx`), stored on the session:

| Role | Screen(s) | What they see |
|---|---|---|
| `teacher` | Attendance / Heatmap / Alerts / Student Profile | The classes the school admin assigned them, downloaded from the server on sign-in (`services/teacherService.js`) and kept on the device for offline use. Teachers do not create classes |
| `admin` (school admin) | `components/admin/`: Today, Classes, Teachers, At-risk | Supervises the school, live from the server: the day's register for every class, creating classes and assigning teachers, taking or correcting any class's register on any day (a reason is required and every change is logged), school-wide at-risk students and follow-ups. Created by "Register your school", the school's application; they wait on `components/SchoolStatusGate.jsx` until a system admin approves it |
| `system_admin` | System Admin | Every school on the platform: approve or reject new ones, disable or enable approved ones, with a confirmation for each (`components/SystemAdminOverview.jsx`). Not a sign-up option: there is one account, set on the server (`npm run sysadmin:set` in `server/`). Its username (no `@`) goes in the normal sign-in, and the PWA checks it with the server instead of on the device. The server's token is what grants access; skips class setup and the offline PIN, and an expired sign-in goes back to the sign-in screen |

## Sign-in

Accounts live on the Tier 2 server (`server/src/auth/userAuth.js`), not on the
device, so no `.env` is needed here. `auth/session.js`:

- **Sign in** sends the email and password to `POST /api/auth/login`. The
  server checks the password and returns a signed token (30 days) plus the
  user and their school. Every API call sends it as `Authorization: Bearer`.
  A name without an `@` is the system admin's and goes to
  `/api/system-admin/login` instead.
- **Register your school** sends `POST /api/schools/register`: the school's
  details and the applicant, who becomes its admin and is signed in to wait.
- The app locks itself after 30 minutes without use; the **offline PIN**
  unlocks it without the network. That never extends the server token, so
  the first sign-in on a device needs a connection.
- Teachers do not sign up. Their school admin invites them by email, and the
  teacher sets a password from the link.
- Sessions from older builds that were never issued by the server are
  dropped on load.

## What's in `src/`

- `auth/`: `session.js` (server sign-in, school application, the stored
  session and `authHeaders()`), `pin.js` (offline PIN, hashed with
  `bcryptjs`), `AuthContext.jsx`
- `db/database.js`: the Dexie (IndexedDB) schema: classes, students, roster,
  attendance, `syncQueue`, `rosterSyncQueue`, `riskScores`, `followUps`
- `components/`: screens: `AttendanceForm`, `Heatmap`, `Alerts`,
  `StudentProfile`, `RosterManager`, `SetupWizard` (first-run onboarding),
  `AdminOverview` / `AdminClassDetail`, `SystemAdminOverview`
- `services/`: `syncService.js` (outbound attendance sync),
  `rosterSyncService.js` (outbound roster sync), `adminService.js` /
  `systemAdminService.js` (live fetches from the server)
- `lib/`: `riskModel.js` (the trained ML model plus the rule-based scorer),
  `heatmap.js`, `attendanceSummary.js`
- `sw/sw.js`: custom service worker (offline app shell and Workbox Background Sync)

## Sync: here → Tier 2 → AWS

Outbound only from this side. `services/syncService.js` /
`rosterSyncService.js` drain `syncQueue` / `rosterSyncQueue` (populated by
every attendance write / roster edit in `db/database.js`) via
`POST /api/sync` and the `/api/roster/*` upserts, triggered on reconnect
(`hooks/useOnlineStatus.js`) and via the service worker's Background Sync.
See `../server/README.md` for the rest of the path to AWS.

## Tests

```bash
npm test             # jest
npm run lint         # eslint
```

Covers: the Dexie schema and every db function, the offline PIN flow, the
rule-based risk model, the heatmap grid, and both sync-queue drain services.

## Not built yet

- A configurable API base URL. `services/*.js` call relative paths
  (`/api/sync`, `/api/admin/...`), so the app must be served from the same
  origin as Tier 2 or behind a proxy that routes `/api` there.
- Risk scoring in a Web Worker (`lib/riskModel.js` has no React or Dexie
  dependencies, so it is ready for this)
