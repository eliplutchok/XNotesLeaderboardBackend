# Community Notes Leaderboard — Backend

Backend for [community-notes-leaderboard.com](https://community-notes-leaderboard.com/), a site that shows which users on X (formerly Twitter) receive the most Community Notes on their posts.

## What It Does

- Ingests the public [Community Notes dataset](https://communitynotes.x.com/guide/en/under-the-hood/download-data) daily
- Resolves tweet authors (handles) via the X API
- Serves a REST API used by the frontend to display leaderboards, user profiles, note search, and statistics

## Setup

```bash
npm install
```

Create a `.env` file in the project root:

```
X_API_TOKEN=your_x_api_bearer_token
```

## Running

**Start the API server:**

```bash
node server.js
```

**Run the daily data refresh:**

```bash
node scripts/dailyUpdate.js
```

## Documentation

- [Daily Update Pipeline](docs/daily-update.md) — how the data refresh works, step by step
- [API Reference](docs/api.md) — available endpoints, parameters, and response formats

## Project Structure

```
server.js                   Express API server
models/AllModels.js         Sequelize models (Note, NoteStatus, User, NoteBackup)
routes/                     Route definitions
controllers/                HTTP request handlers
services/                   Business logic and database queries
scripts/                    Daily update pipeline and utility scripts
docs/                       Documentation
```
