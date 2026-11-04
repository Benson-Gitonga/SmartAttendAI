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

## Deploying to Render

The live site is https://smartattend-9fpf.onrender.com. The [`Dockerfile`](Dockerfile)
at the project root builds the teacher app and runs the server, which serves the
app and `/api` from one address. [`render.yaml`](render.yaml) describes the
service, and every push to the deployed branch redeploys it.

The free plan has no persistent disk, so the database resets on each deploy and
spin-down and the demo data is seeded again. `render.yaml` explains how to keep
the data on a paid plan. Leave `SYNC_API_GATEWAY_URL` unset until the AWS tier
exists. Email uses Brevo until Amazon SES is ready: set `MAIL_TRANSPORT=brevo`,
`BREVO_API_KEY`, and `MAIL_FROM` with a sender verified in Brevo.

## Deploying to Cloudflare Pages + Render

The teacher app is served from Cloudflare Pages and the server runs on Render.
A Pages Function ([`client/functions/api/[[path]].js`](client/functions/api/[[path]].js))
forwards every `/api/*` request to Render, so the browser only ever sees the
Pages address: no CORS, and the service worker and offline sync work as they
do locally.

1. **Render.** On [render.com](https://render.com), choose **New → Blueprint**
   and pick this repo; [`render.yaml`](render.yaml) sets up the service. Fill
   in the variables it asks for (see the Railway table above). Note the
   service's address, e.g. `https://smartattend.onrender.com`.
2. **Cloudflare Pages.** In the Cloudflare dashboard, choose **Workers & Pages
   → Create → Pages → Connect to Git** and pick this repo, with:

   | Setting | Value |
   |---|---|
   | Production branch | `main` |
   | Root directory | `client` |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Environment variables | `API_ORIGIN` = the Render address from step 1, `NODE_VERSION` = `22` |

3. **Back on Render**, set `APP_URL` to the Pages address (e.g.
   `https://smartattend.pages.dev`) so links in emails open the app there.

Every push to `main` then redeploys both. On Render's free plan the server
sleeps after 15 minutes idle (the first request then takes about a minute)
and its database is wiped on every deploy or sleep; demo data is re-seeded on
start.

## Tests

| Part | Command | |
|---|---|---|
| Server | `cd server && npm test` | |
| Teacher app | `cd client && npm test` | |
| ML | `cd ml && ./venv/Scripts/python.exe -m pytest tests/ -q` | |

GitHub Actions runs all three on every push to `main` and on pull requests
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Status

Working and live on Render: the teacher app, the admin and system admin pages,
card scanning with absence reasons, and the risk model.

Not done yet:

- The cloud tier is written but not deployed.
- Absence reasons are recorded but not yet used in the risk score (the fee and illness features are still 0).
- No per-student explanation of a risk score yet (SHAP).
