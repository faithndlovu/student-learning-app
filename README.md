# LearnHub — Student Learning Application

A standalone learning platform covering **student registration**, **course management** and **progress tracking**. Built with Node.js, Express and SQLite, with a dependency-free JavaScript web front end.

## Features

**Students**
- Self-registration with an automatically generated student number (e.g. `STU20260003`), phone number and programme.
- Browse and search the course catalogue by category and level.
- Enrol in and drop courses. Capacity limits are enforced, and progress is kept if you re-enrol.
- Work through ordered lessons with previous/next navigation.
- Take multiple-choice quizzes. Answers are graded on the server, and a 60% pass mark completes the lesson.
- Track progress: completion percentage, lessons done, time studied, average quiz score, course completion and recent activity.
- Edit your profile and change your password.

**Instructors**
- Create, edit, publish/unpublish and delete courses (a course needs at least one lesson before it can be published).
- Add, edit, reorder and delete lessons, with a built-in quiz builder.
- Course roster showing each student's progress, status and quiz average.
- Teaching dashboard with enrolments, completions and average progress per course.

**Admins**
- Everything instructors can do, on every course.
- User management: search, filter, change roles, delete users.
- Platform overview with student and instructor counts.

**Progress rules**
- Course progress = completed lessons ÷ total lessons.
- Lessons with a quiz can only be completed by passing the quiz. Lessons without one are marked complete manually.
- An enrolment becomes `completed` automatically when every lesson is done. It goes back to `active` if the instructor adds new lessons.
- Quiz answers are never sent to students' browsers.

## Tech stack

Node.js 22.13+, Express 5, SQLite (Node’s built-in `node:sqlite`, so there are no native modules to compile), `bcryptjs` and JWT for auth, and vanilla HTML/CSS/JS (no build step). Tests use `node:test` and Supertest.

## Getting started

You need **Node.js 22.13 or newer** (check with `node -v`; an `.nvmrc` is included). The server exits with a clear message on older versions.

```bash
npm install
cp .env.example .env      # then set JWT_SECRET to a long random string
npm run seed              # optional demo data (resets the database)
npm start                 # http://localhost:3000
```

This is a Node.js app with its own web server. It does not run through Apache/XAMPP, so open it at `http://localhost:3000`, not via `htdocs`.

`JWT_SECRET` is required when `NODE_ENV=production`. In development, an insecure fallback is used and a warning is printed.

**Demo accounts** (after `npm run seed`), all with the password `Password123!`:

- `student@example.com` (Student, with progress in two courses)
- `instructor@example.com` (Instructor)
- `admin@example.com` (Admin)

Without seeding, the **first registered account becomes the admin**. Everyone who registers after that is a student. Promote instructors from the Users page.

```bash
npm test     # API integration tests (in-memory database)
```

## Deploying to Railway

The repo includes a `Dockerfile` and `railway.json` (health check on `/api/health`).

1. In [Railway](https://railway.com), choose **New Project → Deploy from GitHub repo** and pick this repository.
2. Open the service, go to **Variables**, and add:
   - `JWT_SECRET`: a long random string. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
   - `NODE_ENV=production` and `DB_PATH=/data/learning.db` are already set by the Dockerfile. `PORT` is set by Railway.
3. Add a **Volume** to the service (right-click the service → **Attach volume**) with mount path `/data`. Without it, the database is wiped on every deploy.
4. Under **Settings → Networking**, click **Generate Domain** to get a public URL.
5. Open the URL and **register straight away**. The first account becomes the admin. Promote instructors from the Users page.

Keep the service at one replica, because SQLite is a single file on one volume. Every push to the connected branch redeploys automatically. Don't run `npm run seed` in production, because it deletes the database.

## REST API

Send `Authorization: Bearer <token>` with every request except register and login.

| Method | Endpoint | Description | Who |
|---|---|---|---|
| POST | `/api/auth/register` | Student registration | public |
| POST | `/api/auth/login` | Sign in and get a JWT | public |
| GET / PUT | `/api/auth/me` | View / update own profile and password | any |
| GET | `/api/users?role=&q=` | List users | admin |
| PATCH | `/api/users/:id/role` | Change role | admin |
| DELETE | `/api/users/:id` | Delete user | admin |
| GET | `/api/courses?q=&category=&level=&mine=1` | Catalogue / my courses | any |
| POST | `/api/courses` | Create course | instructor, admin |
| GET / PUT / DELETE | `/api/courses/:id` | Course with lessons and your progress | any / owner |
| PATCH | `/api/courses/:id/publish` | `{ published: true }` | owner |
| POST / DELETE | `/api/courses/:id/enroll` | Enrol / drop | student |
| GET | `/api/courses/:id/roster` | Students with progress | owner |
| POST | `/api/courses/:id/lessons` | Add lesson with optional quiz | owner |
| GET / PUT / DELETE | `/api/lessons/:id` | Lesson content and quiz | enrolled / owner |
| PATCH | `/api/lessons/:id/move` | `{ direction: "up" \| "down" }` | owner |
| POST / DELETE | `/api/lessons/:id/complete` | Mark / unmark complete | enrolled student |
| POST | `/api/lessons/:id/quiz` | `{ answers: [0, 2, 1] }` returns the graded result | enrolled student |
| GET | `/api/dashboard` | Role-specific dashboard | any |

Quiz format when creating or updating a lesson:

```json
{ "title": "Loops", "content": "…", "duration_minutes": 20,
  "quiz": [{ "question": "2 + 2 = ?", "options": ["3", "4"], "correct_index": 1 }] }
```

## Project structure

```
src/
  app.js         Express app, security headers, error handling
  server.js      Entry point (startup checks, graceful shutdown)
  check-node.js  Node.js version check
  db.js          SQLite schema and indexes
  sqlite.js      Wrapper around node:sqlite
  auth.js        JWT + role middleware, course permissions
  accounts.js    Student numbers and user helpers
  validation.js  Input coercion and validation helpers
  progress.js    Progress calculations and quiz grading
  seed.js        Demo data
  routes/        auth, users, courses, lessons, dashboard
public/          Single-page web client
tests/           API integration tests
```

## License

MIT
