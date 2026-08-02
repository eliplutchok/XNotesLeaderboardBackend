# Community Notes Leaderboard — Backend

Express API and data pipeline for [community-notes-leaderboard.com](https://community-notes-leaderboard.com/). Serves leaderboard, user, and keyword-search data from a PostgreSQL database of X Community Notes.

Frontend: [XNotesLeaderboard](https://github.com/eliplutchok/XNotesLeaderboard)

## Stack

- **Node.js / Express** — HTTP API (`server.js`)
- **Sequelize + PostgreSQL** — models in `models/AllModels.js`
- **Heroku** — production app (`procfile`: `web: node server.js`)

## Setup

```bash
npm install
```

Database connection is configured in `models/AllModels.js` (Postgres with SSL for Heroku). Prefer keeping credentials out of source control and wiring a `DATABASE_URL` (or equivalent) into that file for local work.

## Run the API

```bash
node server.js
```

Listens on `process.env.PORT` or **3000**. CORS is enabled for browser clients.

Health check:

```
GET /
→ Hello World!
```

## API

All routes are mounted under `/api`.

| Method | Path | Description | Example |
| --- | --- | --- | --- |
| `GET` | `/api/top-users` | Leaderboard users | `/api/top-users?limit=200` |
| `GET` | `/api/user/:handle` | One user + their notes | `/api/user/@elonmusk` |
| `GET` | `/api/notes` | Helpful notes matching keywords | `/api/notes?keywords=elon%20musk&search=broader` |
| `GET` | `/api/numbers` | Aggregate / overall numbers | `/api/numbers` |
| `GET` | `/api/notecollection` | Precomputed note collections | `/api/notecollection?collection=TrMostHelpfulAlltime&orderBy=helpfulCount&limit=5` |
| `GET` | `/api/getdifferences` | Diff helpers for scored-note experiments | `/api/getdifferences?table1=...&table2=...&ratingStatus=CURRENTLY_RATED_HELPFUL&orderBy=coreNoteIntercept&limit=5` |

### Notes keyword search

Query params:

- `keywords` (required) — space-separated terms (URL-encode spaces; `+` is also accepted by Express)
- `search` — one of:
  - `narrow` — whole-word regex OR of terms
  - `broad` — single `ILIKE` phrase
  - `broader` — each term must match as a whole word (`iRegexp`)
  - `broadest` — each term must appear via `ILIKE` (default in the service if omitted)

The frontend typically calls `search=broader`. Special regex characters in keywords are escaped so searches like `c++` do not 500.

Only notes with `currentStatus = CURRENTLY_RATED_HELPFUL` and a resolved handle (not `not found`) are returned, newest first, capped by an internal limit.

## Project structure

```
server.js                 Express app entry
procfile                  Heroku web process
routes/
  tweetAuthorRoutes.js    `/api` route table
controllers/              Request parsing → services → JSON
services/                 Sequelize queries / business logic
models/
  AllModels.js            Sequelize models + DB connection
scripts/                  Offline / cron-style data pipeline
  dailyUpdate.js          Orchestrates a full notes refresh cycle
  downloadNewData.js      Pull fresh Community Notes dumps
  updateNoteTable.js      Load notes into Postgres
  updateNoteStatusTable.js
  addHandles.js / addUserInfo.js / …
  ratings/                Rating-file download and metric tables
experiments/              One-off scored-notes experiments
```

## Data pipeline

Production data is refreshed via Node scripts under `scripts/`, not via the HTTP server. The usual high-level flow is:

1. Download new Community Notes / status dumps
2. Update `notes`, `note_status`, and related tables
3. Resolve tweet author handles and user profile fields
4. Optionally refresh rating / “most helpful” collection tables

`scripts/dailyUpdate.js` chains several of these steps. Run individual scripts with Node from the Backend root when debugging, e.g. `node scripts/testConnection.js`.

## Deploy

Heroku expects `node server.js` (see `procfile`). The live API used by the frontend defaults to:

`https://community-notes-backend-0830c00e8724.herokuapp.com`

## Related

- [Frontend repo](https://github.com/eliplutchok/XNotesLeaderboard)
- Live site: [community-notes-leaderboard.com](https://community-notes-leaderboard.com/)
