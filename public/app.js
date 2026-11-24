/* LearnHub front-end — dependency-free single-page app. */
(() => {
  const state = { token: localStorage.getItem('lh_token'), user: null };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const main = $('#main');
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (d) => (d ? new Date(d.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const COLORS = ['#0f766e', '#7c3aed', '#c2410c', '#0369a1', '#be185d', '#4d7c0f', '#a16207'];
  const colorFor = (s) => COLORS[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
  const hours = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(`/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && state.token) { logout(); throw new Error('Session expired — please sign in again'); }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  function toast(msg, isError = false) {
    const t = $('#toast');
    t.textContent = msg; t.className = `toast${isError ? ' error' : ''}`;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.add('hidden'), 3500);
  }
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
  /** Re-renders without stealing focus (and the caret) from the field the user is typing in. */
  const keepFocus = (fn) => async () => {
    const el = document.activeElement;
    const id = el?.id;
    const pos = typeof el?.selectionStart === 'number' ? el.selectionStart : null;
    await fn();
    const again = id && document.getElementById(id);
    if (again) { again.focus(); if (pos !== null && again.setSelectionRange) again.setSelectionRange(pos, pos); }
  };
  const formData = (f) => Object.fromEntries(new FormData(f).entries());
  const openModal = (html) => { $('#modal-body').innerHTML = html; $('#modal').classList.remove('hidden'); };
  const closeModal = () => { $('#modal').classList.add('hidden'); $('#modal-body').innerHTML = ''; };
  $('#modal-close').onclick = closeModal;
  $('#modal').addEventListener('click', (e) => e.target.id === 'modal' && closeModal());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeModal());

  const progressBar = (p) => `<div class="progress"><span style="width:${p}%"></span></div>`;
  function ring(percent) {
    const r = 52, c = 2 * Math.PI * r;
    return `<svg class="ring" viewBox="0 0 120 120"><circle cx="60" cy="60" r="${r}" fill="none" stroke="#eeebe3" stroke-width="12"/>
      <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--primary)" stroke-width="12" stroke-linecap="round"
        stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - percent / 100)}" transform="rotate(-90 60 60)"/>
      <text x="60" y="66" text-anchor="middle" font-size="22" font-weight="700" fill="var(--text)">${percent}%</text></svg>`;
  }

  // ---------- Auth ----------
  $$('[data-auth-tab]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-auth-tab]').forEach((x) => x.classList.toggle('active', x === b));
    $('#login-form').classList.toggle('hidden', b.dataset.authTab !== 'login');
    $('#register-form').classList.toggle('hidden', b.dataset.authTab !== 'register');
  }));
  $('#login-form').addEventListener('submit', guard(async (e) => { e.preventDefault(); signIn(await api('/auth/login', { method: 'POST', body: formData(e.target) })); }));
  $('#register-form').addEventListener('submit', guard(async (e) => {
    e.preventDefault();
    const r = await api('/auth/register', { method: 'POST', body: formData(e.target) });
    signIn(r); toast(r.user.student_number ? `Welcome! Your student number is ${r.user.student_number}` : 'Account created');
  }));
  $('#logout').onclick = logout;

  function signIn({ token, user }) { state.token = token; state.user = user; localStorage.setItem('lh_token', token); showApp(); }
  function logout() {
    state.token = null; state.user = null; localStorage.removeItem('lh_token');
    main.innerHTML = ''; closeModal(); $$('#auth-view form').forEach((f) => f.reset());
    $('#app-view').classList.add('hidden'); $('#auth-view').classList.remove('hidden');
  }
  function showApp() {
    $('#auth-view').classList.add('hidden'); $('#app-view').classList.remove('hidden');
    const r = state.user.role;
    const links = [['dashboard', 'Dashboard'], ['courses', 'Course catalogue']];
    if (r === 'student') links.push(['my-courses', 'My learning']);
    if (r === 'instructor') links.push(['my-courses', 'My courses']);
    if (r === 'admin') links.push(['users', 'Users']);
    $('#nav').innerHTML = links.map(([k, v]) => `<a href="#/${k}" data-nav="${k}">${v}</a>`).join('');
    $('#me-name').textContent = state.user.name;
    $('#me-role').textContent = r; $('#me-role').className = `pill ${r}`;
    if (!location.hash || location.hash === '#/') location.hash = '#/dashboard'; else route();
  }

  // ---------- Router ----------
  window.addEventListener('hashchange', () => state.user && route());
  function route() {
    const [, page, id] = location.hash.split('/');
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === page));
    window.scrollTo(0, 0);
    const views = {
      dashboard: renderDashboard,
      courses: () => (id ? renderCourse(Number(id)) : renderCatalogue({})),
      'my-courses': () => renderCatalogue({ mine: '1' }),
      lessons: () => renderLesson(Number(id)),
      users: renderUsers,
      profile: renderProfile,
    };
    guard(views[page] || renderDashboard)();
  }

  // ---------- Dashboard ----------
  async function renderDashboard() {
    const d = await api('/dashboard');
    const first = esc(state.user.name.split(' ')[0]);
    if (d.role === 'student') {
      const s = d.summary;
      main.innerHTML = `
        <div class="page-head"><div><h1>Hi ${first} 👋</h1><div class="muted">Student no. <strong>${esc(state.user.student_number)}</strong>${state.user.programme ? ` · ${esc(state.user.programme)}` : ''}</div></div>
          <a class="btn primary" href="#/courses">Browse courses</a></div>
        <div class="stats">
          <div class="card stat"><div class="value">${s.enrolled}</div><div class="label">Courses in progress</div></div>
          <div class="card stat"><div class="value">${s.completed}</div><div class="label">Courses completed</div></div>
          <div class="card stat"><div class="value">${s.lessons_completed}</div><div class="label">Lessons completed</div></div>
          <div class="card stat"><div class="value">${hours(s.minutes_studied)}</div><div class="label">Time studied</div></div>
          <div class="card stat"><div class="value">${s.average_quiz_score === null ? '—' : `${s.average_quiz_score}%`}</div><div class="label">Average quiz score</div></div>
        </div>
        <div class="layout">
          <div class="card"><h2>Continue learning</h2>
            ${d.courses.length ? d.courses.map((c) => `<div style="padding:12px 0;border-bottom:1px solid var(--border)">
              <div class="row spread"><a href="#/courses/${c.id}"><strong>${esc(c.title)}</strong></a><span class="pill ${c.status}">${c.status}</span></div>
              <div class="row small muted" style="margin:6px 0">${c.progress.completed_lessons}/${c.progress.total_lessons} lessons · ${c.progress.percent}%</div>
              ${progressBar(c.progress.percent)}
              ${c.next_lesson ? `<div style="margin-top:8px"><a class="btn small primary" href="#/lessons/${c.next_lesson.id}">Next: ${esc(c.next_lesson.title)} →</a></div>` : ''}
            </div>`).join('') : '<div class="empty">You are not enrolled in any courses yet.<br/><br/><a class="btn primary" href="#/courses">Find a course</a></div>'}
          </div>
          <div class="card"><h2>Recent activity</h2>
            ${d.recent.length ? `<ul class="lessons">${d.recent.map((r) => `<li><span class="check done">✓</span><div><div>${esc(r.lesson)}</div><div class="small muted">${esc(r.course)} · ${fmtDate(r.completed_at)}</div></div></li>`).join('')}</ul>` : '<p class="muted">Completed lessons will show up here.</p>'}
          </div>
        </div>`;
      return;
    }
    const s = d.summary;
    main.innerHTML = `
      <div class="page-head"><div><h1>Welcome, ${first}</h1><div class="muted">${d.role === 'admin' ? 'Platform overview' : 'Your teaching overview'}</div></div>
        <button class="btn primary" id="new-course">+ New course</button></div>
      <div class="stats">
        <div class="card stat"><div class="value">${s.courses}</div><div class="label">Courses (${s.published} published)</div></div>
        <div class="card stat"><div class="value">${s.enrolments}</div><div class="label">Active enrolments</div></div>
        <div class="card stat"><div class="value">${s.completions}</div><div class="label">Course completions</div></div>
        ${d.role === 'admin' ? `<div class="card stat"><div class="value">${s.students || 0}</div><div class="label">Students</div></div>
          <div class="card stat"><div class="value">${s.instructors || 0}</div><div class="label">Instructors</div></div>` : ''}
      </div>
      <div class="card"><h2>Courses</h2>
        ${d.courses.length ? `<div class="table-wrap"><table><thead><tr><th>Course</th><th>Status</th><th>Lessons</th><th>Students</th><th>Completions</th><th style="width:200px">Avg. progress</th></tr></thead><tbody>
          ${d.courses.map((c) => `<tr><td><a href="#/courses/${c.id}"><strong>${esc(c.code)}</strong> ${esc(c.title)}</a></td>
            <td><span class="pill ${c.published ? 'completed' : 'draft'}">${c.published ? 'published' : 'draft'}</span></td>
            <td>${c.lesson_count}</td><td>${c.students}</td><td>${c.completions}</td>
            <td><div class="row"><div class="grow">${progressBar(c.average_progress)}</div><span class="small">${c.average_progress}%</span></div></td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">No courses yet — create your first one.</div>'}
      </div>`;
    $('#new-course').onclick = () => courseForm();
  }

  // ---------- Catalogue ----------
  async function renderCatalogue(filters) {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v)));
    const { courses, categories } = await api(`/courses?${qs}`);
    const mine = filters.mine === '1';
    const r = state.user.role;
    main.innerHTML = `
      <div class="page-head"><div><h1>${mine ? (r === 'student' ? 'My learning' : 'My courses') : 'Course catalogue'}</h1>
        <div class="muted">${courses.length} course${courses.length === 1 ? '' : 's'}</div></div>
        ${r !== 'student' ? '<button class="btn primary" id="new-course">+ New course</button>' : ''}</div>
      <div class="row" style="margin-bottom:18px">
        <input id="f-q" placeholder="Search by title, code or topic…" value="${esc(filters.q)}" style="max-width:320px" />
        <select id="f-cat" style="max-width:200px"><option value="">All categories</option>${categories.map((c) => `<option ${filters.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select id="f-level" style="max-width:180px"><option value="">All levels</option>${['beginner', 'intermediate', 'advanced'].map((l) => `<option ${filters.level === l ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      ${courses.length ? `<div class="courses">${courses.map(courseCard).join('')}</div>` : `<div class="card empty">${mine && r === 'student' ? 'You haven’t enrolled in any courses yet. <a href="#/courses">Browse the catalogue</a>.' : 'No courses match.'}</div>`}`;
    const reload = keepFocus(() => renderCatalogue({ ...filters, q: $('#f-q').value, category: $('#f-cat').value, level: $('#f-level').value }));
    let t; $('#f-q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(guard(reload), 300); });
    $('#f-cat').onchange = guard(reload); $('#f-level').onchange = guard(reload);
    $$('[data-course]').forEach((el) => (el.onclick = () => (location.hash = `#/courses/${el.dataset.course}`)));
    if ($('#new-course')) $('#new-course').onclick = () => courseForm();
  }

  function courseCard(c) {
    const enrolled = c.enrollment && c.enrollment.status !== 'dropped';
    const full = c.capacity && c.enrolled_count >= c.capacity;
    return `<div class="card course" data-course="${c.id}">
      <div class="cover" style="background:linear-gradient(135deg, ${colorFor(c.code)}, ${colorFor(c.category)})">${esc(c.code)}</div>
      <div class="row"><span class="pill ${c.level}">${c.level}</span><span class="pill">${esc(c.category)}</span>${c.published ? '' : '<span class="pill draft">draft</span>'}</div>
      <h3>${esc(c.title)}</h3>
      <p class="small muted">${esc(c.description).slice(0, 120)}${c.description.length > 120 ? '…' : ''}</p>
      <div class="small muted">${esc(c.instructor_name)} · ${c.lesson_count} lessons · ${hours(c.total_minutes)}</div>
      ${enrolled ? `<div>${progressBar(c.progress.percent)}<div class="row spread small" style="margin-top:4px"><span>${c.progress.percent}% complete</span><span class="pill ${c.enrollment.status}">${c.enrollment.status}</span></div></div>`
        : `<div class="small muted">${c.enrolled_count} enrolled${c.capacity ? ` / ${c.capacity} seats` : ''}${full ? ' · <strong style="color:var(--danger)">Full</strong>' : ''}</div>`}
    </div>`;
  }

  function courseForm(course) {
    openModal(`<h2>${course ? 'Edit course' : 'New course'}</h2>
      <form id="cf" class="stack">
        <div class="grid2"><label>Course code <input name="code" required value="${esc(course?.code)}" placeholder="e.g. WEB101" /></label>
          <label>Category <input name="category" value="${esc(course?.category || 'General')}" /></label></div>
        <label>Title <input name="title" required value="${esc(course?.title)}" /></label>
        <label>Description <textarea name="description">${esc(course?.description)}</textarea></label>
        <div class="grid2"><label>Level <select name="level">${['beginner', 'intermediate', 'advanced'].map((l) => `<option ${course?.level === l ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Capacity (blank = unlimited) <input name="capacity" type="number" min="1" value="${esc(course?.capacity)}" /></label></div>
        <button class="btn primary">${course ? 'Save changes' : 'Create course'}</button>
      </form>`);
    $('#cf').addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      const body = formData(e.target);
      body.capacity = body.capacity ? Number(body.capacity) : null;
      const r = course ? await api(`/courses/${course.id}`, { method: 'PUT', body }) : await api('/courses', { method: 'POST', body });
      closeModal(); toast(course ? 'Course updated' : 'Course created — now add some lessons');
      if (course) renderCourse(course.id); else location.hash = `#/courses/${r.course.id}`;
    }));
  }

  // ---------- Course detail ----------
  async function renderCourse(id) {
    const { course: c, lessons, can_edit } = await api(`/courses/${id}`);
    const student = state.user.role === 'student';
    const enrolled = student && c.enrollment && c.enrollment.status !== 'dropped';
    const full = c.capacity && c.enrolled_count >= c.capacity;
    main.innerHTML = `
      <a href="#/courses" class="small">← Catalogue</a>
      <div class="card" style="margin:12px 0 20px;background:linear-gradient(135deg, ${colorFor(c.code)}, ${colorFor(c.category)});color:#fff;border:0">
        <div class="row"><span class="pill">${esc(c.code)}</span><span class="pill ${c.level}">${c.level}</span><span class="pill">${esc(c.category)}</span>${c.published ? '' : '<span class="pill draft">draft</span>'}</div>
        <h1 style="margin-top:10px;color:#fff">${esc(c.title)}</h1>
        <div style="opacity:.9">${esc(c.instructor_name)} · ${c.lesson_count} lessons · ${hours(c.total_minutes)} · ${c.enrolled_count} enrolled${c.capacity ? ` / ${c.capacity}` : ''}</div>
      </div>
      <div class="layout">
        <div class="stack">
          <div class="card"><h2>About this course</h2><p class="content" style="margin:0">${esc(c.description) || '<span class="muted">No description.</span>'}</p></div>
          <div class="card"><div class="row spread"><h2>Lessons</h2>${can_edit ? '<button class="btn small primary" id="add-lesson">+ Add lesson</button>' : ''}</div>
            ${lessons.length ? `<ul class="lessons">${lessons.map((l, i) => `<li>
              <span class="check ${l.completed ? 'done' : ''}">${l.completed ? '✓' : l.position}</span>
              <div class="grow">${enrolled || can_edit ? `<a href="#/lessons/${l.id}">${esc(l.title)}</a>` : `<span>${esc(l.title)}</span>`}
                <div class="small muted">${l.duration_minutes} min${l.question_count ? ` · quiz (${l.question_count} question${l.question_count === 1 ? "" : "s"})` : ''}${l.best_score !== null ? ` · best score ${l.best_score}%` : ''}</div></div>
              ${can_edit ? `<button class="btn small ghost" data-move="${l.id}" data-dir="up" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button>
                <button class="btn small ghost" data-move="${l.id}" data-dir="down" ${i === lessons.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
                <button class="btn small" data-edit-lesson="${l.id}">Edit</button>` : ''}
            </li>`).join('')}</ul>` : '<p class="muted">No lessons yet.</p>'}
          </div>
          ${can_edit ? '<div class="card" id="roster"><h2>Students</h2><p class="muted">Loading…</p></div>' : ''}
        </div>
        <div class="stack">
          ${student ? `<div class="card" style="text-align:center">
            ${enrolled ? `${ring(c.progress.percent)}<p><strong>${c.progress.completed_lessons} of ${c.progress.total_lessons}</strong> lessons complete</p>
              <p class="small muted">Time studied: ${hours(c.progress.minutes_studied)}${c.progress.average_quiz_score !== null ? ` · Quiz avg: ${c.progress.average_quiz_score}%` : ''}</p>
              ${c.enrollment.status === 'completed' ? '<p class="result pass">🎉 Course completed!</p>' : ''}
              ${(() => { const next = lessons.find((l) => !l.completed); return next ? `<a class="btn primary block" href="#/lessons/${next.id}">${c.progress.completed_lessons ? 'Continue' : 'Start'} learning</a>` : ''; })()}
              <button class="btn small ghost danger" id="drop" style="margin-top:12px">Drop course</button>`
            : `<h2>Ready to start?</h2><p class="muted small">Enrol to unlock all lessons and track your progress.</p>
              <button class="btn primary block" id="enroll" ${full ? 'disabled' : ''}>${full ? 'Course full' : 'Enrol now'}</button>`}
          </div>` : ''}
          ${can_edit ? `<div class="card stack"><h2>Manage course</h2>
            <button class="btn block ${c.published ? '' : 'accent'}" id="publish">${c.published ? 'Unpublish' : 'Publish course'}</button>
            <button class="btn block" id="edit-course">Edit details</button>
            <button class="btn block danger" id="delete-course">Delete course</button></div>` : ''}
        </div>
      </div>`;

    if ($('#enroll')) $('#enroll').onclick = guard(async () => { await api(`/courses/${id}/enroll`, { method: 'POST' }); toast('Enrolled! Let’s get started.'); renderCourse(id); });
    if ($('#drop')) $('#drop').onclick = guard(async () => { if (!confirm('Drop this course? Your progress will be kept if you re-enrol.')) return; await api(`/courses/${id}/enroll`, { method: 'DELETE' }); toast('Course dropped'); renderCourse(id); });
    if (!can_edit) return;
    $('#add-lesson').onclick = () => lessonForm(id);
    $$('[data-edit-lesson]').forEach((b) => (b.onclick = guard(async () => { const d = await api(`/lessons/${b.dataset.editLesson}`); lessonForm(id, d); })));
    $$('[data-move]').forEach((b) => (b.onclick = guard(async () => { await api(`/lessons/${b.dataset.move}/move`, { method: 'PATCH', body: { direction: b.dataset.dir } }); renderCourse(id); })));
    $('#publish').onclick = guard(async () => { await api(`/courses/${id}/publish`, { method: 'PATCH', body: { published: !c.published } }); toast(c.published ? 'Course unpublished' : 'Course published'); renderCourse(id); });
    $('#edit-course').onclick = () => courseForm(c);
    $('#delete-course').onclick = guard(async () => { if (!confirm(`Delete ${c.code}? This removes all lessons and enrolments.`)) return; await api(`/courses/${id}`, { method: 'DELETE' }); toast('Course deleted'); location.hash = '#/courses'; });

    const roster = await api(`/courses/${id}/roster`);
    $('#roster').innerHTML = `<div class="row spread"><h2>Students (${roster.students.length})</h2><span class="small muted">Avg. progress ${roster.average_progress}% · ${roster.completed} completed</span></div>
      ${roster.students.length ? `<div class="table-wrap"><table><thead><tr><th>Student</th><th>No.</th><th>Status</th><th style="width:170px">Progress</th><th>Quiz avg</th></tr></thead><tbody>
      ${roster.students.map((s) => `<tr><td>${esc(s.name)}<div class="small muted">${esc(s.email)}</div></td><td class="small">${esc(s.student_number)}</td>
        <td><span class="pill ${s.status}">${s.status}</span></td>
        <td><div class="row"><div class="grow">${progressBar(s.progress.percent)}</div><span class="small">${s.progress.percent}%</span></div></td>
        <td>${s.progress.average_quiz_score === null ? '—' : `${s.progress.average_quiz_score}%`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No students enrolled yet.</p>'}`;
  }

  // ---------- Lesson editor ----------
  function lessonForm(courseId, existing) {
    const l = existing?.lesson;
    let questions = (existing?.questions || []).map((q) => ({ question: q.question, options: [...q.options], correct_index: q.correct_index }));
    openModal(`<h2>${l ? 'Edit lesson' : 'Add lesson'}</h2>
      <form id="lf" class="stack">
        <div class="grid2"><label>Title <input name="title" required value="${esc(l?.title)}" /></label>
          <label>Duration (minutes) <input name="duration_minutes" type="number" min="1" value="${esc(l?.duration_minutes || 10)}" /></label></div>
        <label>Lesson content <textarea name="content" style="min-height:180px">${esc(l?.content)}</textarea></label>
        <div><div class="row spread"><strong>Quiz</strong><button type="button" class="btn small" id="add-q">+ Add question</button></div>
          <p class="small muted">Optional. Students must score 60% or more to complete a lesson that has a quiz.</p><div id="qs"></div></div>
        <div class="row spread"><button class="btn primary">${l ? 'Save lesson' : 'Add lesson'}</button>${l ? '<button type="button" class="btn danger" id="del-lesson">Delete lesson</button>' : ''}</div>
      </form>`);
    const sync = () => {
      questions = $$('.qbuilder').map((qb) => ({
        question: $('[data-q]', qb).value,
        options: $$('[data-opt]', qb).map((o) => o.value),
        correct_index: Number(($('input[type=radio]:checked', qb) || { value: 0 }).value),
      }));
    };
    const draw = () => {
      $('#qs').innerHTML = questions.map((q, i) => `<div class="qbuilder">
        <div class="row"><input data-q placeholder="Question ${i + 1}" value="${esc(q.question)}" class="grow" /><button type="button" class="btn small danger" data-rmq="${i}">Remove</button></div>
        ${q.options.map((o, j) => `<div class="row" style="margin-top:6px"><input type="radio" name="correct${i}" value="${j}" ${q.correct_index === j ? 'checked' : ''} style="width:auto" title="Correct answer"/>
          <input data-opt placeholder="Option ${j + 1}" value="${esc(o)}" class="grow"/>${q.options.length > 2 ? `<button type="button" class="btn small ghost" data-rmo="${i}:${j}">×</button>` : ''}</div>`).join('')}
        <button type="button" class="btn small ghost" data-addo="${i}" style="margin-top:6px">+ Option</button> <span class="small muted">Select the radio button beside the correct answer.</span></div>`).join('');
      $$('[data-rmq]').forEach((b) => (b.onclick = () => { sync(); questions.splice(Number(b.dataset.rmq), 1); draw(); }));
      $$('[data-addo]').forEach((b) => (b.onclick = () => { sync(); questions[Number(b.dataset.addo)].options.push(''); draw(); }));
      $$('[data-rmo]').forEach((b) => (b.onclick = () => {
        sync(); const [i, j] = b.dataset.rmo.split(':').map(Number); const q = questions[i];
        q.options.splice(j, 1); if (q.correct_index >= q.options.length) q.correct_index = 0; draw();
      }));
    };
    draw();
    $('#add-q').onclick = () => { sync(); questions.push({ question: '', options: ['', ''], correct_index: 0 }); draw(); };
    $('#lf').addEventListener('submit', guard(async (e) => {
      e.preventDefault(); sync();
      const f = formData(e.target);
      const body = { title: f.title, content: f.content, duration_minutes: Number(f.duration_minutes), quiz: questions };
      if (l) await api(`/lessons/${l.id}`, { method: 'PUT', body }); else await api(`/courses/${courseId}/lessons`, { method: 'POST', body });
      closeModal(); toast(l ? 'Lesson saved' : 'Lesson added'); renderCourse(courseId);
    }));
    if ($('#del-lesson')) $('#del-lesson').onclick = guard(async () => {
      if (!confirm('Delete this lesson and its quiz?')) return;
      await api(`/lessons/${l.id}`, { method: 'DELETE' }); closeModal(); toast('Lesson deleted'); renderCourse(courseId);
    });
  }

  // ---------- Lesson viewer ----------
  async function renderLesson(id) {
    const d = await api(`/lessons/${id}`);
    const student = state.user.role === 'student';
    const hasQuiz = d.questions.length > 0;
    const passedQuiz = d.attempts.some((a) => a.passed);
    const best = d.attempts.reduce((m, a) => Math.max(m, Math.round((a.score / a.total) * 100)), 0);
    main.innerHTML = `
      <a href="#/courses/${d.course.id}" class="small">← ${esc(d.course.code)} · ${esc(d.course.title)}</a>
      <div class="layout" style="margin-top:12px">
        <div class="stack">
          <div class="card">
            <div class="row spread"><span class="small muted">Lesson ${d.lesson.position} · ${d.lesson.duration_minutes} min</span>${d.completed ? '<span class="pill completed">✓ completed</span>' : ''}</div>
            <h1 style="margin-top:6px">${esc(d.lesson.title)}</h1>
            <div class="content">${esc(d.lesson.content) || '<span class="muted">No content yet.</span>'}</div>
          </div>
          ${hasQuiz ? `<div class="card"><div class="row spread"><h2>Lesson quiz</h2><span class="small muted">Pass mark ${d.pass_mark}%${d.attempts.length ? ` · best ${best}% · ${d.attempts.length} attempt${d.attempts.length === 1 ? '' : 's'}` : ''}</span></div>
            <form id="quiz">${d.questions.map((q, i) => `<div class="question" data-qi="${i}"><strong>${i + 1}. ${esc(q.question)}</strong>
              ${q.options.map((o, j) => `<label class="option ${!student && q.correct_index === j ? 'right' : ''}"><input type="radio" name="q${i}" value="${j}" ${student ? 'required' : 'disabled'} /> ${esc(o)}</label>`).join('')}</div>`).join('')}
              ${student ? '<button class="btn primary" style="margin-top:14px">Submit answers</button>' : '<p class="small muted">Instructor preview — correct answers are highlighted.</p>'}
              <div id="quiz-result"></div></form></div>` : ''}
        </div>
        <div class="stack">
          ${student ? `<div class="card stack"><h2>Your progress</h2>
            ${d.completed ? '<p class="result pass" style="margin:0">You’ve completed this lesson.</p><button class="btn block ghost" id="undo">Mark as not complete</button>'
              : hasQuiz && !passedQuiz ? '<p class="small muted">Pass the quiz to complete this lesson.</p>' : '<button class="btn primary block" id="complete">Mark lesson complete</button>'}
          </div>` : ''}
          <div class="card stack"><h2>Navigate</h2>
            ${d.previous ? `<a class="btn block" href="#/lessons/${d.previous.id}">← ${esc(d.previous.title)}</a>` : ''}
            ${d.next ? `<a class="btn block primary" href="#/lessons/${d.next.id}">${esc(d.next.title)} →</a>` : `<a class="btn block" href="#/courses/${d.course.id}">Back to course</a>`}
          </div>
        </div>
      </div>`;

    const afterProgress = (r) => {
      if (r.enrollment_status === 'completed') toast('🎉 Congratulations — you completed the course!');
      renderLesson(id);
    };
    if ($('#complete')) $('#complete').onclick = guard(async () => { const r = await api(`/lessons/${id}/complete`, { method: 'POST' }); toast('Lesson completed'); afterProgress(r); });
    if ($('#undo')) $('#undo').onclick = guard(async () => { await api(`/lessons/${id}/complete`, { method: 'DELETE' }); renderLesson(id); });
    if (student && hasQuiz) $('#quiz').addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      const answers = d.questions.map((_, i) => Number(($(`input[name=q${i}]:checked`) || {}).value));
      const r = await api(`/lessons/${id}/quiz`, { method: 'POST', body: { answers } });
      r.results.forEach((res, i) => {
        const opts = $$(`[data-qi="${i}"] .option`);
        opts[res.correct_index].classList.add('right');
        if (!res.correct) opts[answers[i]].classList.add('wrong');
      });
      $$('#quiz input').forEach((x) => (x.disabled = true));
      $('#quiz button').classList.add('hidden');
      $('#quiz-result').innerHTML = `<div class="result ${r.passed ? 'pass' : 'fail'}">You scored ${r.score}/${r.total} (${r.percent}%). ${r.passed ? 'Passed — lesson complete!' : `You need ${d.pass_mark}% to pass.`}</div>
        <div class="row" style="margin-top:10px"><button type="button" class="btn" id="retry">${r.passed ? 'Retake quiz' : 'Try again'}</button>
        ${r.passed && d.next ? `<a class="btn primary" href="#/lessons/${d.next.id}">Next lesson →</a>` : ''}</div>`;
      $('#retry').onclick = () => renderLesson(id);
      if (r.enrollment_status === 'completed') toast('🎉 Congratulations — you completed the course!');
    }));
  }

  // ---------- Users (admin) ----------
  async function renderUsers(filters = {}) {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v)));
    const { users } = await api(`/users?${qs}`);
    main.innerHTML = `<div class="page-head"><div><h1>Users</h1><div class="muted">Manage students, instructors and administrators.</div></div></div>
      <div class="row" style="margin-bottom:16px"><input id="u-q" placeholder="Search name, email or student no." value="${esc(filters.q)}" style="max-width:320px" />
        <select id="u-role" style="max-width:180px"><option value="">All roles</option>${['student', 'instructor', 'admin'].map((r) => `<option ${filters.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
      <div class="card"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Student no.</th><th>Programme</th><th>Role</th><th>Activity</th><th>Joined</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr><td><strong>${esc(u.name)}</strong><div class="small muted">${esc(u.email)}</div></td><td class="small">${esc(u.student_number || '—')}</td><td class="small">${esc(u.programme || '—')}</td>
        <td><select data-role="${u.id}" style="max-width:140px">${['student', 'instructor', 'admin'].map((r) => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
        <td class="small">${u.role === 'student' ? `${u.enrolments} enrolments` : `${u.courses_taught} courses`}</td><td class="small">${fmtDate(u.created_at)}</td>
        <td>${u.id === state.user.id ? '<span class="small muted">You</span>' : `<button class="btn small danger" data-del="${u.id}">Delete</button>`}</td></tr>`).join('')}
      </tbody></table></div></div>`;
    const reload = keepFocus(() => renderUsers({ q: $('#u-q').value, role: $('#u-role').value }));
    let t; $('#u-q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(guard(reload), 300); });
    $('#u-role').onchange = guard(reload);
    $$('[data-role]').forEach((s) => (s.onchange = guard(async () => {
      try { await api(`/users/${s.dataset.role}/role`, { method: 'PATCH', body: { role: s.value } }); toast('Role updated'); } finally { reload(); }
    })));
    $$('[data-del]').forEach((b) => (b.onclick = guard(async () => { if (!confirm('Delete this user?')) return; await api(`/users/${b.dataset.del}`, { method: 'DELETE' }); toast('User deleted'); reload(); })));
  }

  // ---------- Profile ----------
  async function renderProfile() {
    const { user } = await api('/auth/me');
    main.innerHTML = `<div class="page-head"><div><h1>My profile</h1><div class="muted">${user.student_number ? `Student no. ${esc(user.student_number)} · ` : ''}Member since ${fmtDate(user.created_at)}</div></div></div>
      <div class="layout"><div class="card"><form id="pf" class="stack">
        <label>Full name <input name="name" required value="${esc(user.name)}" /></label>
        <label>Email <input value="${esc(user.email)}" disabled /></label>
        <div class="grid2"><label>Phone <input name="phone" value="${esc(user.phone)}" /></label><label>Programme <input name="programme" value="${esc(user.programme)}" /></label></div>
        <h2 style="margin-top:20px">Change password</h2>
        <div class="grid2"><label>Current password <input name="current_password" type="password" autocomplete="current-password" /></label>
          <label>New password <input name="new_password" type="password" minlength="8" autocomplete="new-password" /></label></div>
        <button class="btn primary">Save profile</button></form></div></div>`;
    $('#pf').addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      const body = formData(e.target);
      if (!body.new_password) { delete body.new_password; delete body.current_password; }
      const r = await api('/auth/me', { method: 'PUT', body });
      state.user = r.user; $('#me-name').textContent = r.user.name; toast('Profile saved'); renderProfile();
    }));
  }

  (async () => {
    if (!state.token) return logout();
    try { state.user = (await api('/auth/me')).user; showApp(); } catch { logout(); }
  })();
})();
