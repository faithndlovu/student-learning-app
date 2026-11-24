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

You need **Node.js 22.13 or newer** (check with `node -v`).

```bash
npm install
cp .env.example .env      # optional
npm run seed              # optional demo data
npm start                 # http://localhost:3000
```

**Demo accounts** (after `npm run seed`), all with the password `Password123!`:

- `student@example.com` (Student, with progress in two courses)
- `instructor@example.com` (Instructor)
- `admin@example.com` (Admin)

Without seeding, the **first registered account becomes the admin**. Everyone who registers after that is a student. Promote instructors from the Users page.

```bash
npm test     # 13 API integration tests
```

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
  app.js         Express app + dashboard endpoint
  server.js      Entry point
  db.js          SQLite schema
  auth.js        JWT + role middleware
  progress.js    Progress calculations and quiz grading
  seed.js        Demo data
  routes/        auth, users, courses, lessons
public/          Single-page web client
tests/           API integration tests
```

## License

MIT
