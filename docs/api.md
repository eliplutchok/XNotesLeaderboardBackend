# API Reference

The server (`server.js`) is an Express app that exposes a REST API under the `/api` prefix. All routes are defined in `routes/tweetAuthorRoutes.js`.

## Running the Server

```bash
node server.js
```

Runs on `process.env.PORT` or `3000` by default.

## Endpoints

### GET `/api/top-users`

Returns the top community note authors ranked by note count, with user profile info.

**Query Parameters:**
- `limit` (optional, default `100`) — number of users to return

**Response:** Array of user objects with note counts and profile details (handle, username, bio, followers, profile pic, etc.)

**Controller:** `getTopUsersController.js` → **Service:** `getTopUsers.js`

---

### GET `/api/user/:handle`

Returns details for a single user by their handle.

**URL Parameters:**
- `handle` — the user's handle (e.g. `@username`)

**Response:** User object with profile info and their notes

**Controller:** `getOneUserController.js` → **Service:** `getOneUser.js`

---

### GET `/api/notes`

Searches notes by keywords in the note summary text.

**Query Parameters:**
- `keywords` (required) — space-separated keywords (e.g. `israel+pain`)
- `search` (optional) — search mode: `"narrow"`, `"broad"`, `"broader"`, or `"broadest"` (default)

**Response:** Array of matching notes with their status and author info

**Example:** `/api/notes?keywords=israel+pain&search=narrow`

**Controller:** `getNotesByContentController.js` → **Service:** `getNotesByContent.js`

## Architecture

```
Request → routes/tweetAuthorRoutes.js → controllers/*Controller.js → services/*.js → models/AllModels.js → PostgreSQL
```

- **Routes** map URL paths to controller functions
- **Controllers** handle HTTP request/response (parsing query params, sending JSON)
- **Services** contain the business logic and database queries
- **Models** define Sequelize models and relationships (Note, NoteStatus, User, NoteBackup)
