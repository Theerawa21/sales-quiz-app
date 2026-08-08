/**
 * Midterm Exam 1/2569 - Sales for Professional Business
 * Backend: Google Apps Script + Google Sheets
 * Frontend: GitHub Pages
 *
 * Spreadsheet:
 * https://docs.google.com/spreadsheets/d/1ihwm5kmIFcYNOm_QvyMqsyn-fp8dYDWNCm5AM5k9ksE/edit
 */

const SPREADSHEET_ID = '1ihwm5kmIFcYNOm_QvyMqsyn-fp8dYDWNCm5AM5k9ksE';
const TZ = 'Asia/Bangkok';
const SHEETS = {
  SETTINGS: 'SETTINGS',
  STUDENTS: 'STUDENTS',
  QUESTIONS: 'QUESTIONS',
  SESSIONS: 'SESSIONS',
  RESPONSES: 'RESPONSES',
  AUDIT: 'AUDIT'
};

function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || 'config');
    const payload = Object.assign({}, (e && e.parameter) || {});
    delete payload.action;
    return json_(dispatch_(action, payload, 'GET'));
  } catch (err) {
    return json_({ ok: false, error: safeError_(err) });
  }
}

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const body = JSON.parse(raw || '{}');
    return json_(dispatch_(String(body.action || ''), body.payload || {}, 'POST'));
  } catch (err) {
    return json_({ ok: false, error: safeError_(err) });
  }
}

function dispatch_(action, payload, method) {
  const publicGet = ['config', 'lookupStudent', 'heartbeat'];
  if (method === 'GET' && publicGet.indexOf(action) === -1) {
    throw new Error('Method not allowed');
  }

  let data;
  switch (action) {
    case 'config': data = getPublicConfig_(); break;
    case 'lookupStudent': data = lookupStudent_(payload); break;
    case 'startExam': data = withLock_(() => startExam_(payload)); break;
    case 'saveAnswer': data = withLock_(() => saveAnswer_(payload)); break;
    case 'heartbeat': data = heartbeat_(payload); break;
    case 'reportEvent': data = withLock_(() => reportEvent_(payload)); break;
    case 'submitExam': data = withLock_(() => submitExamById_(payload.sessionId, payload.reason || 'MANUAL')); break;

    case 'teacherLogin': data = teacherLogin_(payload); break;
    case 'teacherDashboard': data = teacherDashboard_(payload); break;
    case 'toggleExam': data = withLock_(() => toggleExam_(payload)); break;
    case 'resetAttempt': data = withLock_(() => resetAttempt_(payload)); break;
    default: throw new Error('Unknown action');
  }
  return { ok: true, data: data };
}

function getPublicConfig_() {
  const s = settings_();
  return {
    title: s.EXAM_TITLE || 'แบบทดสอบกลางภาคเรียนที่ 1 ปีการศึกษา 2569',
    course: s.COURSE || 'การขายสำหรับนักธุรกิจมืออาชีพ',
    durationMin: num_(s.DURATION_MIN, 40),
    questionCount: num_(s.QUESTION_COUNT, 40),
    examOpen: bool_(s.EXAM_OPEN),
    showScore: bool_(s.SHOW_SCORE),
    maxTabSwitch: num_(s.MAX_TAB_SWITCH, 3),
    passPercent: num_(s.PASS_PERCENT, 60)
  };
}

function lookupStudent_(payload) {
  const s = settings_();
  requireExamCode_(payload.examCode, s);

  const st = findStudent_(payload.studentId);
  if (!st || !st.active) return { found: false };

  if (!classAllowed_(st.className, s)) return { found: false };

  const submitted = findResponseByStudent_(st.studentId);
  return {
    found: true,
    studentId: st.studentId,
    fullName: st.fullName,
    className: st.className,
    seatNo: st.seatNo,
    alreadyTaken: !!submitted
  };
}

function startExam_(payload) {
  const s = settings_();
  requireExamCode_(payload.examCode, s);
  validateExamWindow_(s);
  if (!bool_(s.EXAM_OPEN)) throw new Error('ข้อสอบยังไม่เปิด กรุณารอครูผู้คุมสอบ');

  const st = findStudent_(payload.studentId);
  if (!st || !st.active || !classAllowed_(st.className, s)) {
    throw new Error('ไม่พบรหัสนักเรียนในรายชื่อผู้เข้าสอบ');
  }

  if (bool_(s.ONE_ATTEMPT) && findResponseByStudent_(st.studentId)) {
    return { alreadyTaken: true };
  }

  const existing = findActiveSessionByStudent_(st.studentId);
  if (existing) {
    if (new Date().getTime() >= existing.expiresAt.getTime()) {
      const result = submitInternal_(existing, 'TIME_EXPIRED');
      return { alreadyTaken: true, autoSubmitted: true, result: result };
    }
    return sessionPayload_(existing, s, true);
  }

  const bank = activeQuestions_();
  if (!bank.length) throw new Error('ยังไม่มีข้อสอบที่เปิดใช้งานในชีต QUESTIONS');

  const count = Math.min(num_(s.QUESTION_COUNT, bank.length), bank.length);
  const picked = shuffle_(bank.slice()).slice(0, count);
  const qOrder = picked.map(q => q.qid);
  const choiceMap = {};
  picked.forEach(q => choiceMap[q.qid] = shuffle_([0, 1, 2, 3]));

  const now = new Date();
  let expires = new Date(now.getTime() + num_(s.DURATION_MIN, 40) * 60000);
  if (s.END_TIME) {
    const end = new Date(s.END_TIME);
    if (!isNaN(end.getTime()) && end < expires) expires = end;
  }

  const sessionId = Utilities.getUuid();
  appendObject_(SHEETS.SESSIONS, {
    SessionID: sessionId,
    StudentID: st.studentId,
    FullName: st.fullName,
    Class: st.className,
    StartedAt: now,
    ExpiresAt: expires,
    Status: 'ACTIVE',
    CurrentIndex: 0,
    QuestionOrderJSON: JSON.stringify(qOrder),
    ChoiceOrderJSON: JSON.stringify(choiceMap),
    AnswersJSON: JSON.stringify({}),
    TabSwitchCount: 0,
    LastSeen: now,
    UserAgent: String(payload.userAgent || '').slice(0, 500)
  });
  audit_(sessionId, st.studentId, 'START', 'เริ่มสอบ');
  return sessionPayload_(findSessionById_(sessionId), s, false);
}

function saveAnswer_(payload) {
  const session = requireActiveSession_(payload.sessionId);
  if (Date.now() >= session.expiresAt.getTime()) {
    return { finished: true, result: submitInternal_(session, 'TIME_EXPIRED') };
  }

  const qOrder = parseJson_(session.questionOrderJson, []);
  const current = num_(session.currentIndex, 0);
  const qid = qOrder[current];
  if (!qid || String(payload.qid || '') !== String(qid)) {
    throw new Error('ลำดับข้อสอบไม่ถูกต้อง กรุณารีเฟรชหน้า');
  }

  const displayedIndex = Number(payload.choiceIndex);
  if ([0,1,2,3].indexOf(displayedIndex) === -1) {
    throw new Error('กรุณาเลือกคำตอบ');
  }

  const choiceMap = parseJson_(session.choiceOrderJson, {});
  const perm = choiceMap[qid] || [0,1,2,3];
  const originalIndex = Number(perm[displayedIndex]);

  const answers = parseJson_(session.answersJson, {});
  answers[qid] = originalIndex;

  const nextIndex = current + 1;
  updateSession_(session.row, {
    CurrentIndex: nextIndex,
    AnswersJSON: JSON.stringify(answers),
    LastSeen: new Date()
  });
  audit_(session.sessionId, session.studentId, 'ANSWER', 'ตอบข้อ ' + qid);

  if (nextIndex >= qOrder.length) {
    const fresh = findSessionById_(session.sessionId);
    return { finished: true, result: submitInternal_(fresh, 'COMPLETED') };
  }

  const fresh = findSessionById_(session.sessionId);
  return { finished: false, question: questionPayload_(fresh) };
}

function heartbeat_(payload) {
  const session = findSessionById_(payload.sessionId);
  if (!session) throw new Error('ไม่พบเซสชันสอบ');
  if (session.status !== 'ACTIVE') {
    return { active: false, status: session.status };
  }
  if (Date.now() >= session.expiresAt.getTime()) {
    return withLock_(() => {
      const fresh = findSessionById_(payload.sessionId);
      if (!fresh || fresh.status !== 'ACTIVE') return { active: false };
      return { active: false, expired: true, result: submitInternal_(fresh, 'TIME_EXPIRED') };
    });
  }

  updateSession_(session.row, { LastSeen: new Date() });
  return {
    active: true,
    serverNowMs: Date.now(),
    expiresAtMs: session.expiresAt.getTime(),
    tabSwitchCount: num_(session.tabSwitchCount, 0)
  };
}

function reportEvent_(payload) {
  const session = findSessionById_(payload.sessionId);
  if (!session || session.status !== 'ACTIVE') return { active: false };

  const eventName = String(payload.event || 'EVENT');
  let count = num_(session.tabSwitchCount, 0);
  if (eventName === 'APP_SWITCH' || eventName === 'FULLSCREEN_EXIT') {
    count += 1;
    updateSession_(session.row, { TabSwitchCount: count, LastSeen: new Date() });
  }
  audit_(session.sessionId, session.studentId, eventName, String(payload.details || '').slice(0, 500));

  const s = settings_();
  const max = num_(s.MAX_TAB_SWITCH, 3);
  if (count >= max) {
    const fresh = findSessionById_(session.sessionId);
    return {
      active: false,
      forcedSubmit: true,
      tabSwitchCount: count,
      maxTabSwitch: max,
      result: submitInternal_(fresh, 'TAB_SWITCH_LIMIT')
    };
  }
  return { active: true, tabSwitchCount: count, maxTabSwitch: max };
}

function submitExamById_(sessionId, reason) {
  const session = findSessionById_(sessionId);
  if (!session) throw new Error('ไม่พบเซสชันสอบ');
  if (session.status !== 'ACTIVE') return existingResult_(sessionId);
  return submitInternal_(session, reason || 'MANUAL');
}

function submitInternal_(session, reason) {
  if (!session || session.status !== 'ACTIVE') return existingResult_(session && session.sessionId);

  const qOrder = parseJson_(session.questionOrderJson, []);
  const answers = parseJson_(session.answersJson, {});
  const qMap = {};
  allQuestions_().forEach(q => qMap[q.qid] = q);

  let score = 0;
  let maxScore = 0;
  qOrder.forEach(qid => {
    const q = qMap[qid];
    if (!q) return;
    const pts = num_(q.points, 1);
    maxScore += pts;
    const correctIndex = ['A','B','C','D'].indexOf(String(q.correct || '').toUpperCase());
    if (Number(answers[qid]) === correctIndex) score += pts;
  });

  const submittedAt = new Date();
  const durationMin = Math.max(0, Math.round(((submittedAt.getTime() - session.startedAt.getTime()) / 60000) * 10) / 10);
  const percent = maxScore ? Math.round((score / maxScore) * 10000) / 100 : 0;
  const status = reason === 'COMPLETED' ? 'SUBMITTED' : 'AUTO_SUBMITTED';

  updateSession_(session.row, { Status: status, LastSeen: submittedAt });

  appendObject_(SHEETS.RESPONSES, {
    SubmittedAt: submittedAt,
    StudentID: session.studentId,
    FullName: session.fullName,
    Class: session.className,
    Score: score,
    MaxScore: maxScore,
    Percent: percent,
    DurationMin: durationMin,
    TabSwitchCount: num_(session.tabSwitchCount, 0),
    Reason: String(reason || 'MANUAL'),
    AnswersJSON: JSON.stringify(answers),
    SessionID: session.sessionId
  });
  audit_(session.sessionId, session.studentId, 'SUBMIT', String(reason || 'MANUAL'));

  const s = settings_();
  const show = bool_(s.SHOW_SCORE);
  return {
    submitted: true,
    reason: reason,
    message: 'ระบบได้รับคำตอบเรียบร้อยแล้ว',
    score: show ? score : null,
    maxScore: show ? maxScore : null,
    percent: show ? percent : null
  };
}

function teacherLogin_(payload) {
  const s = settings_();
  requireAdminPin_(payload.pin, s);
  return { ok: true };
}

function teacherDashboard_(payload) {
  const s = settings_();
  requireAdminPin_(payload.pin, s);

  const responses = sheetObjects_(sheet_(SHEETS.RESPONSES));
  const sessions = sheetObjects_(sheet_(SHEETS.SESSIONS));
  const students = sheetObjects_(sheet_(SHEETS.STUDENTS)).filter(r => String(r.Active || 'TRUE').toUpperCase() !== 'FALSE');

  const rows = responses.map(r => ({
    submittedAt: formatDate_(r.SubmittedAt),
    studentId: String(r.StudentID || ''),
    fullName: String(r.FullName || ''),
    className: String(r.Class || ''),
    score: Number(r.Score || 0),
    maxScore: Number(r.MaxScore || 0),
    percent: Number(r.Percent || 0),
    durationMin: Number(r.DurationMin || 0),
    tabSwitchCount: Number(r.TabSwitchCount || 0),
    reason: String(r.Reason || '')
  })).reverse();

  const avg = rows.length ? Math.round((rows.reduce((a, r) => a + r.percent, 0) / rows.length) * 100) / 100 : 0;
  const passP = num_(s.PASS_PERCENT, 60);
  return {
    examOpen: bool_(s.EXAM_OPEN),
    totalStudents: students.length,
    submittedCount: rows.length,
    activeCount: sessions.filter(r => String(r.Status) === 'ACTIVE').length,
    averagePercent: avg,
    passCount: rows.filter(r => r.percent >= passP).length,
    responses: rows
  };
}

function toggleExam_(payload) {
  const s = settings_();
  requireAdminPin_(payload.pin, s);
  setSetting_('EXAM_OPEN', payload.open ? 'TRUE' : 'FALSE');
  return { examOpen: !!payload.open };
}

function resetAttempt_(payload) {
  const s = settings_();
  requireAdminPin_(payload.pin, s);
  const studentId = String(payload.studentId || '').trim();
  if (!studentId) throw new Error('กรุณาระบุรหัสนักเรียน');

  deleteRowsByStudent_(SHEETS.RESPONSES, studentId);
  deleteRowsByStudent_(SHEETS.SESSIONS, studentId);
  audit_('', studentId, 'RESET_ATTEMPT', 'ครูรีเซ็ตสิทธิ์สอบ');
  return { reset: true, studentId: studentId };
}

// -------------------- helpers --------------------

function ss_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('ไม่พบชีต ' + name);
  return sh;
}

function settings_() {
  const rows = sheetObjects_(sheet_(SHEETS.SETTINGS));
  const out = {};
  rows.forEach(r => out[String(r.KEY || '').trim()] = String(r.VALUE == null ? '' : r.VALUE).trim());
  return out;
}

function setSetting_(key, value) {
  const sh = sheet_(SHEETS.SETTINGS);
  const vals = sh.getDataRange().getDisplayValues();
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === key) {
      sh.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sh.appendRow([key, value, '']);
}

function sheetObjects_(sh) {
  if (sh.getLastRow() < 1) return [];
  const values = sh.getDataRange().getValues();
  const display = sh.getDataRange().getDisplayValues();
  const headers = display[0].map(String);
  return values.slice(1).map((row, i) => {
    const obj = {};
    headers.forEach((h, j) => {
      if (['StudentID','SessionID','QID','Class','Correct','Active','Status','Reason','KEY','VALUE'].indexOf(h) >= 0) {
        obj[h] = display[i + 1][j];
      } else {
        obj[h] = row[j];
      }
    });
    return obj;
  });
}

function findStudent_(studentId) {
  const id = String(studentId || '').trim();
  if (!id) return null;
  const r = sheetObjects_(sheet_(SHEETS.STUDENTS)).find(x => String(x.StudentID || '').trim() === id);
  if (!r) return null;
  return {
    studentId: String(r.StudentID || '').trim(),
    fullName: String(r.FullName || '').trim(),
    className: String(r.Class || '').trim(),
    seatNo: String(r.SeatNo || '').trim(),
    active: String(r.Active || 'TRUE').toUpperCase() !== 'FALSE'
  };
}

function allQuestions_() {
  return sheetObjects_(sheet_(SHEETS.QUESTIONS)).map(r => ({
    qid: String(r.QID || '').trim(),
    group: String(r.Group || ''),
    question: String(r.Question || ''),
    choices: [String(r.A || ''), String(r.B || ''), String(r.C || ''), String(r.D || '')],
    correct: String(r.Correct || '').trim().toUpperCase(),
    points: num_(r.Points, 1),
    active: String(r.Active || 'TRUE').toUpperCase() !== 'FALSE'
  })).filter(q => q.qid);
}

function activeQuestions_() {
  return allQuestions_().filter(q => q.active && ['A','B','C','D'].indexOf(q.correct) >= 0);
}

function findResponseByStudent_(studentId) {
  return sheetObjects_(sheet_(SHEETS.RESPONSES)).find(r => String(r.StudentID || '').trim() === String(studentId || '').trim()) || null;
}

function findActiveSessionByStudent_(studentId) {
  return sessionObjects_().find(s => s.studentId === String(studentId || '').trim() && s.status === 'ACTIVE') || null;
}

function findSessionById_(sessionId) {
  return sessionObjects_().find(s => s.sessionId === String(sessionId || '')) || null;
}

function sessionObjects_() {
  const sh = sheet_(SHEETS.SESSIONS);
  if (sh.getLastRow() <= 1) return [];
  const vals = sh.getDataRange().getValues();
  const disp = sh.getDataRange().getDisplayValues();
  const headers = disp[0];
  const idx = {};
  headers.forEach((h, i) => idx[h] = i);

  return vals.slice(1).map((r, i) => ({
    row: i + 2,
    sessionId: String(disp[i + 1][idx.SessionID] || ''),
    studentId: String(disp[i + 1][idx.StudentID] || ''),
    fullName: String(disp[i + 1][idx.FullName] || ''),
    className: String(disp[i + 1][idx.Class] || ''),
    startedAt: new Date(r[idx.StartedAt]),
    expiresAt: new Date(r[idx.ExpiresAt]),
    status: String(disp[i + 1][idx.Status] || ''),
    currentIndex: Number(r[idx.CurrentIndex] || 0),
    questionOrderJson: String(disp[i + 1][idx.QuestionOrderJSON] || '[]'),
    choiceOrderJson: String(disp[i + 1][idx.ChoiceOrderJSON] || '{}'),
    answersJson: String(disp[i + 1][idx.AnswersJSON] || '{}'),
    tabSwitchCount: Number(r[idx.TabSwitchCount] || 0),
    lastSeen: r[idx.LastSeen] ? new Date(r[idx.LastSeen]) : null
  }));
}

function requireActiveSession_(sessionId) {
  const s = findSessionById_(sessionId);
  if (!s) throw new Error('ไม่พบเซสชันสอบ');
  if (s.status !== 'ACTIVE') throw new Error('ข้อสอบถูกส่งแล้ว');
  return s;
}

function sessionPayload_(session, settings, resumed) {
  return {
    sessionId: session.sessionId,
    student: {
      studentId: session.studentId,
      fullName: session.fullName,
      className: session.className
    },
    expiresAtMs: session.expiresAt.getTime(),
    maxTabSwitch: num_(settings.MAX_TAB_SWITCH, 3),
    tabSwitchCount: num_(session.tabSwitchCount, 0),
    resumed: !!resumed,
    question: questionPayload_(session)
  };
}

function questionPayload_(session) {
  const qOrder = parseJson_(session.questionOrderJson, []);
  const i = num_(session.currentIndex, 0);
  if (i >= qOrder.length) return null;

  const qid = qOrder[i];
  const q = allQuestions_().find(x => x.qid === qid);
  if (!q) throw new Error('ไม่พบข้อสอบ ' + qid);
  const map = parseJson_(session.choiceOrderJson, {});
  const perm = map[qid] || [0,1,2,3];

  return {
    qid: qid,
    number: i + 1,
    total: qOrder.length,
    text: q.question,
    choices: perm.map(n => q.choices[n])
  };
}

function appendObject_(sheetName, obj) {
  const sh = sheet_(sheetName);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  const lastHeader = headers.reduce((acc, h, i) => h ? i : acc, -1);
  if (lastHeader < 0) throw new Error('ชีต ' + sheetName + ' ไม่มีหัวตาราง');
  const usedHeaders = headers.slice(0, lastHeader + 1);
  sh.appendRow(usedHeaders.map(h => Object.prototype.hasOwnProperty.call(obj, h) ? obj[h] : ''));
}

function updateSession_(row, fields) {
  const sh = sheet_(SHEETS.SESSIONS);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  Object.keys(fields).forEach(key => {
    const col = headers.indexOf(key);
    if (col >= 0) sh.getRange(row, col + 1).setValue(fields[key]);
  });
}

function audit_(sessionId, studentId, eventName, details) {
  appendObject_(SHEETS.AUDIT, {
    Timestamp: new Date(),
    SessionID: String(sessionId || ''),
    StudentID: String(studentId || ''),
    Event: String(eventName || ''),
    Details: String(details || '')
  });
}

function existingResult_(sessionId) {
  const r = sheetObjects_(sheet_(SHEETS.RESPONSES)).find(x => String(x.SessionID || '') === String(sessionId || ''));
  if (!r) return { submitted: true, message: 'ข้อสอบถูกส่งแล้ว' };
  const s = settings_();
  const show = bool_(s.SHOW_SCORE);
  return {
    submitted: true,
    message: 'ระบบได้รับคำตอบเรียบร้อยแล้ว',
    score: show ? Number(r.Score || 0) : null,
    maxScore: show ? Number(r.MaxScore || 0) : null,
    percent: show ? Number(r.Percent || 0) : null,
    reason: String(r.Reason || '')
  };
}

function requireExamCode_(code, settings) {
  if (String(code || '').trim() !== String(settings.EXAM_CODE || '').trim()) {
    throw new Error('รหัสเข้าห้องสอบไม่ถูกต้อง');
  }
}

function requireAdminPin_(pin, settings) {
  if (String(pin || '').trim() !== String(settings.ADMIN_PIN || '').trim()) {
    throw new Error('PIN ผู้ดูแลไม่ถูกต้อง');
  }
}

function classAllowed_(className, settings) {
  const list = String(settings.ALLOWED_CLASSES || '')
    .split(',')
    .map(normalizeClass_)
    .filter(Boolean);
  return !list.length || list.indexOf(normalizeClass_(className)) >= 0;
}

function normalizeClass_(s) {
  return String(s || '').toLowerCase().replace(/\s/g, '').replace(/^ม\./, '').replace(/^m\./, '');
}

function validateExamWindow_(settings) {
  const now = new Date();
  if (settings.START_TIME) {
    const start = new Date(settings.START_TIME);
    if (!isNaN(start.getTime()) && now < start) throw new Error('ยังไม่ถึงเวลาเปิดข้อสอบ');
  }
  if (settings.END_TIME) {
    const end = new Date(settings.END_TIME);
    if (!isNaN(end.getTime()) && now > end) throw new Error('หมดเวลาเข้าสอบแล้ว');
  }
}

function deleteRowsByStudent_(sheetName, studentId) {
  const sh = sheet_(sheetName);
  const data = sh.getDataRange().getDisplayValues();
  if (!data.length) return;
  const col = data[0].indexOf('StudentID');
  if (col < 0) return;
  for (let r = data.length - 1; r >= 1; r--) {
    if (String(data[r][col]).trim() === String(studentId).trim()) sh.deleteRow(r + 1);
  }
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); }
  finally { lock.releaseLock(); }
}

function shuffle_(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

function parseJson_(s, fallback) {
  try { return JSON.parse(String(s || '')); }
  catch (e) { return fallback; }
}

function bool_(v) {
  return String(v || '').trim().toUpperCase() === 'TRUE';
}

function num_(v, fallback) {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}

function formatDate_(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm:ss');
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function safeError_(err) {
  return err && err.message ? String(err.message) : String(err || 'เกิดข้อผิดพลาด');
}
