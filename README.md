# SmartAttend AI

Offline-first student attendance for low-connectivity schools in Kenya, with a
machine-learning model that flags students at risk of persistent absenteeism
so staff can follow up early.

A teacher records attendance on a cheap Android phone with no signal. Records
are saved on the phone first and sync when a connection returns. Students
can also scan a printed ID card, so the teacher only has to deal with whoever
did not scan.

## Plans

SmartAttend needs no special hardware:

| | What it does |
|---|---|
| Teacher app (PWA) | Teacher takes the roll call by ticking students, or by scanning their cards |
| Student ID cards | The school admin prints them (QR code + barcode, laminated); the teacher's phone camera reads them, offline too |
| Scan station (optional) | A phone, laptop camera or cheap USB barcode scanner at the gate or office marks students present as they arrive |
| Risk model, alerts, cloud | Yes |

**Ticking is the fallback.** Once cards are scanned for a class, scanned
students are present and everyone else starts absent, so the teacher only
ticks whoever came without a card. With no scans, the teacher takes a normal
full roll call. Attendance is never lost because a card or scanner failed.

## How it fits together

```
 ID card ──scanned at a station or by the teacher──► School server (Tier 2, SQLite) ──internet, when up──► Cloud (AWS)
                                                       ▲              │
                                       2. push marks   │              │  1. pull today's scans
                                          + reasons    │              ▼
                                     Teacher's phone (Tier 1 PWA, IndexedDB)
                                     teacher confirms, marks absent + reason,
                                     saved on the phone first
```

1. When the roll call opens, the phone pulls the class's scans for today
   (`GET /api/gate/classes/:id/attendance`). Scanned students show as present.
2. The teacher marks the rest (e.g. absent, with a reason: Fees, Sick, Other,
   Don't know) and confirms. Marks are saved on the phone and pushed to the
   server with `POST /api/sync` when it is reachable.
3. The server forwards every record to the cloud when it has internet.

If a teacher marked a student absent offline but the student had scanned in,
the scan wins and the teacher is told.

## Repository layout

| Folder | What it is | Stack | Details |
|---|---|---|---|
| [`client/`](client/README.md) | Tier 1 — teacher app (installable PWA, works offline) | React 19, Vite, Dexie/IndexedDB, Workbox, Jest | Roll call, heatmap, risk alerts, student profiles, class/roster management, admin views |
| [`server/`](server/README.md) | Tier 2 — school server and API | Node (ESM), Express, better-sqlite3, `node --test` | Sync endpoint, card scan endpoints, accounts, admin/roster APIs, risk scoring |
| [`ml/`](ml/README.md) | Absence-risk model | Python, scikit-learn, pandas, pytest | Feature engineering, training, tuning, export of the model to JSON |
| [`aws/`](aws/README.md) | Cloud tier | Node Lambdas, DynamoDB, SES, Africa's Talking | Sync ingest; SMS/email alerts for red-flagged students |
| [`docs/`](docs/) | Reference docs | — | [`schema.md`](docs/schema.md): the server's database tables |

## The risk model

The model predicts whether a student will miss 30% or more of school days in
the next four weeks, from 12 features (recent attendance rates, long-run
attendance, absence streaks, weekday patterns, term position, and the share of
absences due to fees or illness). It was trained on 2017–2024 data from two schools.

The trained model is exported to JSON and evaluated in plain JavaScript on the
phone and on the server, so risk flags work fully offline with no Python
service. See [`ml/README.md`](ml/README.md) for features and results.

## Running it locally

You need Node 22+ and, for the ML pipeline, Python 3.11. On Windows run
`npm install` from PowerShell, not Git Bash.

Start the server first, then the teacher app, in two terminals:

```powershell
# 1. Server on http://localhost:3000 - seeds the demo school
cd server
npm install
npm run db:reset   # WARNING: wipes and re-seeds the local database
npm start

# 2. Teacher app on http://localhost:5173 - /api is proxied to the server
cd client
npm install
npm run dev
```

Open http://localhost:5173 and sign in with a demo account.

The server's database lives outside the repo
(`%LOCALAPPDATA%\smartattend\smartattend.db`) because OneDrive locks SQLite's
files. Settings are in [`server/.env.example`](server/.env.example).

Docker: `docker compose up` runs the server only.

## Deploying (Cloudflare Pages + Azure)

The teacher app is served from Cloudflare Pages and the server runs on Azure
App Service (https://smartattend-api.azurewebsites.net). A Pages Function
([`client/functions/api/[[path]].js`](client/functions/api/[[path]].js))
forwards every `/api/*` request to the server, so the browser only ever sees
the Pages address: no CORS, and the service worker and offline sync work as
they do locally.

**Server.** Every push to `main` that passes the tests builds the root
[`Dockerfile`](Dockerfile) (the PWA plus the server) and pushes it to Azure
Container Registry; a registry webhook then restarts the App Service on the new
image (see the `deploy` job in [`ci.yml`](.github/workflows/ci.yml)). Its
settings, all in the App Service's environment variables:

| Setting | Value |
|---|---|
| `DB_PATH` | `/home/data/smartattend.db` (`/home` survives restarts) |
| `SQLITE_JOURNAL_MODE` | `DELETE` (WAL does not work on the `/home` share) |
| `AUTH_TOKEN_SECRET`, `SYSTEM_ADMIN_*` | see [`server/.env.example`](server/.env.example) |
| `APP_URL` | the Pages address, for links in emails |
| `DEMO_DATA` | `false` |
| `MAIL_TRANSPORT`, `BREVO_API_KEY`, `MAIL_FROM` | Brevo, until Amazon SES is ready |

To apply changed settings, stop the App Service and start it again rather than
restarting it: a restart briefly runs the old and new containers together and
the new one cannot open the database.

**Cloudflare Pages.** Connected to this repo with:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Root directory | `client` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variables | `API_ORIGIN` = the server's address, `NODE_VERSION` = `22` |

The server is moving to AWS (Stockholm); this section will change with it.

## Tests

| Part | Command | |
|---|---|---|
| Server | `cd server && npm test` | |
| Teacher app | `cd client && npm test` | |
| ML | `cd ml && ./venv/Scripts/python.exe -m pytest tests/ -q` | |

GitHub Actions runs all three on every push to `main` and on pull requests
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Status

Working and live (Cloudflare Pages + Azure): the teacher app, the admin and
system admin pages, card scanning with absence reasons, and the risk model with
"Why this score" explanations. Absence reasons (fees, sick) count towards a
student's risk score only when at least 70% of their absences in the last four
weeks have a reason, as in the schools the model was trained on (about 79%).

Not done yet:

- The cloud tier is written but not deployed.
