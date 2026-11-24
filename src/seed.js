/**
 * Resets the database and loads demo data.
 * All demo accounts use the password: Password123!
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { createDb } = require('./db');

const file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'learning.db');
for (const f of [file, `${file}-wal`, `${file}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
const db = createDb(file);
const year = new Date().getFullYear();

const hash = bcrypt.hashSync('Password123!', 10);
const addUser = db.prepare('INSERT INTO users (name, email, password_hash, role, student_number, programme) VALUES (?, ?, ?, ?, ?, ?)');
addUser.run('Ada Admin', 'admin@example.com', hash, 'admin', null, '');
const inst = addUser.run('Dr. Ivy Instructor', 'instructor@example.com', hash, 'instructor', null, '').lastInsertRowid;
const thabo = addUser.run('Thabo Student', 'student@example.com', hash, 'student', `STU${year}0003`, 'BSc Computer Science').lastInsertRowid;
const lerato = addUser.run('Lerato Learner', 'lerato@example.com', hash, 'student', `STU${year}0004`, 'BCom Information Systems').lastInsertRowid;

const addCourse = db.prepare(`INSERT INTO courses (code, title, description, category, level, capacity, published, instructor_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
const addLesson = db.prepare('INSERT INTO lessons (course_id, position, title, content, duration_minutes) VALUES (?, ?, ?, ?, ?)');
const addQ = db.prepare('INSERT INTO quiz_questions (lesson_id, question, options, correct_index) VALUES (?, ?, ?, ?)');

const courses = [
  {
    code: 'WEB101', title: 'Introduction to Web Development', category: 'Programming', level: 'beginner', capacity: 50,
    description: 'Learn how the web works and build your first pages with HTML, CSS and JavaScript.',
    lessons: [
      ['How the web works', 'When you type a URL, your browser sends an HTTP request to a server, which responds with HTML, CSS and JavaScript.\n\nKey ideas:\n• Client and server\n• HTTP methods (GET, POST)\n• Status codes (200, 404, 500)', 15,
        [['Which HTTP status code means "Not Found"?', ['200', '301', '404', '500'], 2], ['Which side renders the HTML page?', ['The server', 'The browser (client)', 'The DNS resolver'], 1]]],
      ['HTML fundamentals', 'HTML describes the structure of a page using elements such as <h1>, <p>, <a> and <img>.\n\nAlways use semantic elements (header, nav, main, footer) to improve accessibility.', 20,
        [['Which element is the main heading?', ['<head>', '<h1>', '<header>'], 1]]],
      ['Styling with CSS', 'CSS controls presentation. Selectors target elements; properties set colour, spacing and layout. Flexbox and Grid are the modern layout tools.', 25, []],
      ['JavaScript basics', 'JavaScript adds behaviour: variables, functions, events and DOM manipulation.\n\nconst button = document.querySelector("button");\nbutton.addEventListener("click", () => alert("Hi!"));', 30,
        [['Which keyword declares a constant?', ['var', 'let', 'const'], 2], ['What does the DOM represent?', ['The database', 'The page structure as objects', 'A CSS framework'], 1]]],
    ],
  },
  {
    code: 'DATA201', title: 'Data Analysis with Python', category: 'Data Science', level: 'intermediate', capacity: 30,
    description: 'Use Python, pandas and visualisation to turn raw data into insights.',
    lessons: [
      ['Python refresher', 'Lists, dictionaries, loops and functions — the building blocks you will use every day.', 20,
        [['Which type stores key/value pairs?', ['list', 'tuple', 'dict'], 2]]],
      ['Working with pandas', 'pandas DataFrames let you load CSV files, filter rows, group and aggregate.', 35, []],
      ['Visualising data', 'Use matplotlib or seaborn to create bar charts, line charts and histograms that tell a story.', 30, []],
    ],
  },
  {
    code: 'PM110', title: 'Project Management Essentials', category: 'Business', level: 'beginner', capacity: null,
    description: 'Plan, execute and close projects using proven frameworks such as Agile and Scrum.',
    lessons: [
      ['What is a project?', 'A project is a temporary endeavour with a defined beginning, end and goal.', 10,
        [['A project is…', ['Ongoing operations', 'A temporary endeavour with a goal', 'A department'], 1]]],
      ['Agile and Scrum', 'Scrum organises work into sprints with roles: Product Owner, Scrum Master and Developers.', 25, []],
    ],
  },
];

const lessonIds = {};
for (const c of courses) {
  const id = addCourse.run(c.code, c.title, c.description, c.category, c.level, c.capacity, 1, inst).lastInsertRowid;
  lessonIds[c.code] = c.lessons.map(([title, content, mins, quiz], i) => {
    const lid = addLesson.run(id, i + 1, title, content, mins).lastInsertRowid;
    for (const [q, opts, correct] of quiz) addQ.run(lid, q, JSON.stringify(opts), correct);
    return lid;
  });
  c.id = id;
}
addCourse.run('AI300', 'Applied Machine Learning (draft)', 'Coming soon.', 'Data Science', 'advanced', 25, 0, inst);

// Enrolments & progress
const enrol = db.prepare('INSERT INTO enrollments (student_id, course_id, status, completed_at) VALUES (?, ?, ?, ?)');
const done = db.prepare('INSERT INTO lesson_progress (student_id, lesson_id) VALUES (?, ?)');
const attempt = db.prepare('INSERT INTO quiz_attempts (student_id, lesson_id, score, total, passed) VALUES (?, ?, ?, ?, ?)');
enrol.run(thabo, courses[0].id, 'active', null);
done.run(thabo, lessonIds.WEB101[0]); attempt.run(thabo, lessonIds.WEB101[0], 2, 2, 1);
done.run(thabo, lessonIds.WEB101[1]); attempt.run(thabo, lessonIds.WEB101[1], 1, 1, 1);
enrol.run(thabo, courses[2].id, 'completed', new Date().toISOString().slice(0, 19).replace('T', ' '));
done.run(thabo, lessonIds.PM110[0]); attempt.run(thabo, lessonIds.PM110[0], 1, 1, 1);
done.run(thabo, lessonIds.PM110[1]);
enrol.run(lerato, courses[0].id, 'active', null);
done.run(lerato, lessonIds.WEB101[0]); attempt.run(lerato, lessonIds.WEB101[0], 1, 2, 0); attempt.run(lerato, lessonIds.WEB101[0], 2, 2, 1);
enrol.run(lerato, courses[1].id, 'active', null);

console.log('Database seeded. Log in with admin@example.com / instructor@example.com / student@example.com (password: Password123!)');
db.close();
