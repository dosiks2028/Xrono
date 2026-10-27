import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const BASE_DATE = '2026-01-01';
const DAY_MS = 86_400_000;
const MAX_BODY = 65_536;
const MAX_IMPORT_BODY = 1_048_576;
const MAX_GUESSES_PER_MINUTE = 24;
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.json':'application/json; charset=utf-8', '.ico':'image/x-icon', '.png':'image/png' };

function loadEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.hasOwn(process.env, match[1])) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

function isoNow() { return new Date().toISOString(); }
function utcDate(now = new Date()) { return now.toISOString().slice(0, 10); }
function isDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value; }
function dateOffset(date) { return Math.floor((Date.parse(`${date}T00:00:00.000Z`) - Date.parse(`${BASE_DATE}T00:00:00.000Z`)) / DAY_MS); }
function padYear(year) { return String(year).padStart(4, '0'); }
function mod(n, m) { return ((n % m) + m) % m; }
function siteBaseUrl() {
  const fallback='http://localhost:4173';
  try {
    const url=new URL(process.env.BASE_URL || fallback);
    if(url.username||url.password||!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))))return fallback;
    return `${url.origin}${url.pathname.replace(/\/$/,'')}`;
  } catch { return fallback; }
}
function xmlEscape(value) { return String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch])); }

export function compareYear(answer, guess) {
  if (!/^\d{4}$/.test(answer) || !/^\d{4}$/.test(guess)) throw new TypeError('Год должен состоять ровно из четырёх цифр.');
  const target = [...answer];
  const input = [...guess];
  const result = Array(4).fill('absent');
  for (let i = 0; i < 4; i++) {
    if (input[i] === target[i]) {
      result[i] = 'correct';
      target[i] = null;
    }
  }
  for (let i = 0; i < 4; i++) {
    if (result[i] === 'correct') continue;
    const found = target.indexOf(input[i]);
    if (found !== -1) {
      result[i] = 'present';
      target[found] = null;
    }
  }
  return result;
}

function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(fs.readFileSync(path.join(DATA, 'schema.sql'), 'utf8'));
  return db;
}

function seed(db) {
  const categories = JSON.parse(fs.readFileSync(path.join(DATA, 'categories.json'), 'utf8'));
  const insertCategory = db.prepare(`INSERT INTO categories(id,name,description,icon,sort_order) VALUES(?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, icon=excluded.icon, sort_order=excluded.sort_order`);
  for (const c of categories) insertCategory.run(c.id, c.name, c.description, c.icon, c.sortOrder);

  const events = JSON.parse(fs.readFileSync(path.join(DATA, 'events.json'), 'utf8'));
  for (const event of events) upsertEvent(db, normalizeEvent(event, { seed: true }));
  ensureScheduleRange(db, BASE_DATE, '2027-12-31');
}

const INSERT_EVENT = `INSERT INTO historical_events(id,year,era,exact_date,year_display,title,explanation,period,category_id,difficulty,region,keywords_json,fact_check_status,published,created_at,updated_at)
VALUES(@id,@year,@era,@exact_date,@year_display,@title,@explanation,@period,@category_id,@difficulty,@region,@keywords_json,@fact_check_status,@published,@created_at,@updated_at)
ON CONFLICT(id) DO UPDATE SET year=excluded.year,era=excluded.era,exact_date=excluded.exact_date,year_display=excluded.year_display,title=excluded.title,explanation=excluded.explanation,period=excluded.period,category_id=excluded.category_id,difficulty=excluded.difficulty,region=excluded.region,keywords_json=excluded.keywords_json,fact_check_status=excluded.fact_check_status,published=excluded.published,updated_at=excluded.updated_at`;

function normalizeEvent(raw, { seed: isSeed = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Запись события должна быть объектом.');
  const id = String(raw.id ?? '');
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(id)) throw new Error(`Некорректный id события: ${id || 'пусто'}.`);
  const year = Number(raw.year);
  if (!Number.isInteger(year) || year < 1 || year > 9999) throw new Error(`У события ${id} год должен быть целым числом от 1 до 9999.`);
  const era = raw.era ?? 'CE';
  if (!['BCE','CE'].includes(era)) throw new Error(`У события ${id} некорректная эра.`);
  const fields = ['title','explanation','period','region'];
  for (const field of fields) if (typeof raw[field] !== 'string' || !raw[field].trim() || raw[field].length > 3000) throw new Error(`У события ${id} некорректное поле ${field}.`);
  const translations = Array.isArray(raw.translations) ? raw.translations : (raw.question ? [{ locale: raw.locale || 'ru', question: raw.question }] : []);
  const cleanTranslations = translations.filter(t => t && typeof t.locale === 'string' && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(t.locale) && typeof t.question === 'string' && t.question.trim() && t.question.length <= 700)
    .map(t => ({ locale: t.locale, question: t.question.trim() }));
  if (!cleanTranslations.length || !cleanTranslations.some(t => t.locale === 'ru')) throw new Error(`У события ${id} должна быть непустая русская формулировка.`);
  if (!Array.isArray(raw.sources) || raw.sources.length < 1 || raw.sources.length > 5) throw new Error(`У события ${id} должен быть хотя бы один источник.`);
  const sources = raw.sources.map(source => {
    if (!source || typeof source.title !== 'string' || !source.title.trim() || source.title.length > 200) throw new Error(`У события ${id} некорректно название источника.`);
    let url;
    try { url = new URL(source.url); } catch { throw new Error(`У события ${id} ссылка источника должна быть корректным URL.`); }
    if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 1500) throw new Error(`У события ${id} источник должен быть безопасной HTTPS-ссылкой.`);
    return { title: source.title.trim(), url: url.href };
  });
  const keywords = Array.isArray(raw.keywords) ? raw.keywords.slice(0, 30).map(v => String(v).slice(0, 80)) : [];
  const exactDate = raw.exactDate == null ? null : String(raw.exactDate).slice(0, 32);
  if (raw.exactDate != null && !/^\d{1,4}(?: BCE)?(?:-\d{2}(?:-\d{2})?)?$/.test(exactDate)) throw new Error(`У события ${id} некорректная точная дата.`);
  const category = String(raw.category ?? '');
  const difficulty = raw.difficulty ?? 'medium';
  if (!['easy','medium','hard'].includes(difficulty)) throw new Error(`У события ${id} некорректная сложность.`);
  const factCheckStatus = raw.factCheckStatus ?? (isSeed ? 'reviewed' : 'draft');
  if (!['draft','needs-review','reviewed'].includes(factCheckStatus)) throw new Error(`У события ${id} некорректный статус проверки.`);
  const published = raw.published == null ? isSeed : Boolean(raw.published);
  if (published && (factCheckStatus !== 'reviewed' || sources.length === 0)) throw new Error(`Событие ${id} нельзя публиковать до проверки фактов и источников.`);
  return {
    id, year, era, exactDate, title: raw.title.trim(), explanation: raw.explanation.trim(), period: raw.period.trim(), category,
    difficulty, region: raw.region.trim(), keywords, translations: cleanTranslations, sources, factCheckStatus, published,
    createdAt: raw.createdAt || isoNow(), updatedAt: isoNow()
  };
}

function upsertEvent(db, event) {
  if (!db.prepare('SELECT id FROM categories WHERE id=?').get(event.category)) throw new Error(`Неизвестная категория у события ${event.id}.`);
  db.prepare(INSERT_EVENT).run({
    id:event.id, year:event.year, era:event.era, exact_date:event.exactDate, year_display:padYear(event.year), title:event.title,
    explanation:event.explanation, period:event.period, category_id:event.category, difficulty:event.difficulty, region:event.region,
    keywords_json:JSON.stringify(event.keywords), fact_check_status:event.factCheckStatus, published:event.published ? 1 : 0,
    created_at:event.createdAt, updated_at:event.updatedAt
  });
  db.prepare('DELETE FROM question_translations WHERE event_id=?').run(event.id);
  db.prepare('DELETE FROM content_sources WHERE event_id=?').run(event.id);
  const tr = db.prepare('INSERT INTO question_translations(event_id,locale,question_text) VALUES(?,?,?)');
  for (const item of event.translations) tr.run(event.id, item.locale, item.question);
  const src = db.prepare('INSERT INTO content_sources(event_id,title,url) VALUES(?,?,?)');
  for (const item of event.sources) src.run(event.id, item.title, item.url);
}

function categoryRows(db) { return db.prepare(`SELECT c.*, COUNT(e.id) AS event_count FROM categories c LEFT JOIN historical_events e ON e.category_id=c.id AND e.published=1 GROUP BY c.id ORDER BY c.sort_order`).all(); }
function eventRow(db, id, locale = 'ru') {
  return db.prepare(`SELECT e.*, c.name AS category_name, t.question_text FROM historical_events e JOIN categories c ON c.id=e.category_id
    JOIN question_translations t ON t.event_id=e.id AND t.locale=? WHERE e.id=?`).get(locale, id);
}
function safeEvent(row, { reveal = false } = {}) {
  if (!row) return null;
  const safe = {
    id:row.id, title:row.title, question:row.question_text, period:row.period, category:row.category_id, categoryName:row.category_name,
    difficulty:row.difficulty, region:row.region, era:row.era
  };
  if (reveal) {
    safe.year = row.year;
    safe.yearDisplay = row.year_display;
    safe.exactDate = row.exact_date;
    safe.explanation = row.explanation;
    safe.keywords = JSON.parse(row.keywords_json);
    safe.sources = row.sources;
  }
  return safe;
}

function sourceList(db, eventId) { return db.prepare('SELECT title,url FROM content_sources WHERE event_id=? ORDER BY id').all(eventId); }
function eventWithSources(db, id, locale = 'ru') {
  const row = eventRow(db, id, locale);
  if (row) row.sources = sourceList(db, id);
  return row;
}
function publishedEvents(db, category, difficulty) {
  let sql = `SELECT e.id,e.year,e.era,e.title,e.period,e.category_id,c.name AS category_name,e.difficulty,e.region,t.question_text
    FROM historical_events e JOIN categories c ON c.id=e.category_id JOIN question_translations t ON t.event_id=e.id AND t.locale='ru'
    WHERE e.published=1 AND e.fact_check_status='reviewed'`;
  const args = [];
  if (category) { sql += ' AND e.category_id=?'; args.push(category); }
  if (difficulty) { sql += ' AND e.difficulty=?'; args.push(difficulty); }
  sql += ' ORDER BY e.year,e.id';
  return db.prepare(sql).all(...args);
}

function shuffledForSchedule(db) {
  const rows = db.prepare(`SELECT e.id,e.category_id FROM historical_events e WHERE e.published=1 AND e.fact_check_status='reviewed' ORDER BY e.id`).all();
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.category_id)) groups.set(row.category_id, []);
    groups.get(row.category_id).push(row.id);
  }
  const keys = [...groups.keys()].sort((a,b) => crypto.createHash('sha256').update(a).digest('hex').localeCompare(crypto.createHash('sha256').update(b).digest('hex')));
  const order = [];
  let depth = 0;
  while (order.length < rows.length) {
    for (const key of keys) {
      const id = groups.get(key)[depth];
      if (id) order.push(id);
    }
    depth++;
  }
  return order;
}

function ensureChallenge(db, date, assignedBy = 'planner') {
  const saved = db.prepare('SELECT event_id FROM daily_challenges WHERE challenge_date=?').get(date);
  if (saved) return saved.event_id;
  const order = shuffledForSchedule(db);
  if (!order.length) throw new Error('В каталоге нет опубликованных вопросов.');
  const offset = dateOffset(date);
  const eventId = order[mod(offset, order.length)];
  db.prepare('INSERT OR IGNORE INTO daily_challenges(challenge_date,event_id,assigned_by,created_at) VALUES(?,?,?,?)').run(date,eventId,assignedBy,isoNow());
  return db.prepare('SELECT event_id FROM daily_challenges WHERE challenge_date=?').get(date).event_id;
}

function ensureScheduleRange(db, start, end) {
  let date = start;
  while (date <= end) {
    ensureChallenge(db, date);
    const next = new Date(`${date}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    date = utcDate(next);
  }
}

function getClientKey(body) {
  const value = String(body?.clientKey ?? '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw Object.assign(new Error('Обновите страницу и попробуйте снова.'), { status:400 });
  return value;
}

function guessesFor(db, sessionId) {
  return db.prepare('SELECT position,value,feedback_json FROM guesses WHERE session_id=? ORDER BY position').all(sessionId)
    .map(row => ({ position:row.position, value:row.value, feedback:JSON.parse(row.feedback_json) }));
}

function sessionView(db, session, { reveal = false } = {}) {
  const row = eventWithSources(db, session.event_id);
  return {
    id:session.id, mode:session.mode, challengeDate:session.challenge_date, status:session.completed_at ? session.result : 'playing',
    attemptsUsed:session.attempts_used, attemptsRemaining:6-session.attempts_used, guesses:guessesFor(db, session.id), event:safeEvent(row,{reveal})
  };
}

function createSession(db, { clientKey, mode, challengeDate = null, eventId = null, today = utcDate() }) {
  if (!['daily','archive','practice'].includes(mode)) throw Object.assign(new Error('Неизвестный режим игры.'), { status:400 });
  if (mode === 'daily' || mode === 'archive') {
    if (!isDate(challengeDate)) throw Object.assign(new Error('Некорректная дата задания.'), { status:400 });
    if (challengeDate < BASE_DATE || challengeDate > today || (mode === 'daily' && challengeDate !== today)) throw Object.assign(new Error('Это задание пока недоступно.'), { status:404 });
    eventId = ensureChallenge(db, challengeDate);
    const existing = db.prepare('SELECT * FROM game_sessions WHERE client_key=? AND challenge_date=? AND mode=?').get(clientKey,challengeDate,mode);
    if (existing) return existing;
  } else {
    const row = db.prepare(`SELECT id FROM historical_events WHERE id=? AND published=1 AND fact_check_status='reviewed'`).get(eventId);
    if (!row) throw Object.assign(new Error('Вопрос больше недоступен.'), { status:404 });
  }
  const id = crypto.randomUUID();
  const createdAt = isoNow();
  try {
    db.prepare('INSERT INTO game_sessions(id,client_key,challenge_date,event_id,mode,started_at) VALUES(?,?,?,?,?,?)').run(id,clientKey,challengeDate,eventId,mode,createdAt);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' && challengeDate) {
      return db.prepare('SELECT * FROM game_sessions WHERE client_key=? AND challenge_date=? AND mode=?').get(clientKey,challengeDate,mode);
    }
    throw error;
  }
  return db.prepare('SELECT * FROM game_sessions WHERE id=?').get(id);
}

function startPractice(db, { clientKey, category, difficulty, exclude = [], today = utcDate() }) {
  if (category && !db.prepare('SELECT id FROM categories WHERE id=?').get(category)) throw Object.assign(new Error('Категория не найдена.'), { status:404 });
  if (difficulty && !['easy','medium','hard'].includes(difficulty)) throw Object.assign(new Error('Некорректная сложность.'), { status:400 });
  const solved = db.prepare(`SELECT DISTINCT event_id FROM game_sessions WHERE client_key=? AND completed_at IS NOT NULL`).all(clientKey).map(row => row.event_id);
  const recent = db.prepare(`SELECT event_id FROM game_sessions WHERE client_key=? AND mode='practice' ORDER BY started_at DESC LIMIT 16`).all(clientKey).map(row => row.event_id);
  const excluded = new Set([...solved, ...recent, ...(Array.isArray(exclude) ? exclude.slice(0,40).map(String) : [])]);
  const candidates = publishedEvents(db, category, difficulty);
  const fresh = candidates.filter(row => !excluded.has(row.id));
  const pool = fresh.length ? fresh : candidates;
  if (!pool.length) throw Object.assign(new Error('В этой подборке пока нет опубликованных вопросов.'), { status:404 });
  const chosen = pool[crypto.randomInt(pool.length)];
  const session = createSession(db,{ clientKey, mode:'practice', eventId:chosen.id, today });
  return session;
}

function calcStats(db, clientKey, today = utcDate()) {
  const total = db.prepare('SELECT COUNT(*) AS n FROM game_sessions WHERE client_key=?').get(clientKey).n;
  const completed = db.prepare('SELECT COUNT(*) AS n FROM game_sessions WHERE client_key=? AND completed_at IS NOT NULL').get(clientKey).n;
  const wins = db.prepare(`SELECT COUNT(*) AS n FROM game_sessions WHERE client_key=? AND result='won'`).get(clientKey).n;
  const daily = db.prepare(`SELECT challenge_date,result FROM game_sessions WHERE client_key=? AND mode='daily' AND completed_at IS NOT NULL ORDER BY challenge_date DESC`).all(clientKey);
  const wonDates = new Set(daily.filter(row => row.result === 'won').map(row => row.challenge_date));
  let currentStreak = 0;
  if (daily[0]?.challenge_date === today && daily[0].result === 'lost') currentStreak = 0;
  else {
    const anchor = wonDates.has(today) ? today : utcDate(new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS));
    if (wonDates.has(anchor)) {
      let cursor = anchor;
      while (wonDates.has(cursor)) {
        currentStreak++;
        cursor = utcDate(new Date(Date.parse(`${cursor}T00:00:00Z`) - DAY_MS));
      }
    }
  }
  const distributionRows = db.prepare(`SELECT attempts_used,COUNT(*) AS n FROM game_sessions WHERE client_key=? AND result='won' GROUP BY attempts_used`).all(clientKey);
  const distribution = Array(6).fill(0);
  for (const row of distributionRows) distribution[row.attempts_used-1] = row.n;
  const categoryRowsWon = db.prepare(`SELECT e.category_id,COUNT(*) AS n FROM game_sessions s JOIN historical_events e ON e.id=s.event_id WHERE s.client_key=? AND s.result='won' GROUP BY e.category_id`).all(clientKey);
  const categoryProgress = Object.fromEntries(categoryRowsWon.map(row => [row.category_id,row.n]));
  const hardWin = db.prepare(`SELECT COUNT(*) AS n FROM game_sessions s JOIN historical_events e ON e.id=s.event_id WHERE s.client_key=? AND s.result='won' AND e.difficulty='hard'`).get(clientKey).n > 0;
  const firstTry = distribution[0] > 0;
  const achievements = [
    { id:'first-win', title:'Первая дата', description:'Реши первую историческую загадку.', unlocked:wins >= 1 },
    { id:'one-try', title:'С ходу', description:'Победи с первой попытки.', unlocked:firstTry },
    { id:'five-streak', title:'В ритме времени', description:'Победи в пяти заданиях дня подряд.', unlocked:currentStreak >= 5 },
    { id:'ten-games', title:'Хронист', description:'Сыграй десять партий.', unlocked:total >= 10 },
    { id:'hard-win', title:'Точность исследователя', description:'Реши загадку высокой сложности.', unlocked:hardWin }
  ];
  return { gamesPlayed:total, completedGames:completed, wins, winRate:completed ? Math.round((wins/completed)*100) : 0, currentStreak, completedDaily:daily.length, distribution, categoryProgress, achievements };
}

function send(res, status, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'content-length':payload.length, 'cache-control':'no-store', 'x-content-type-options':'nosniff', ...headers });
  res.end(payload);
}

function errorStatus(error) { return Number.isInteger(error.status) ? error.status : 500; }
async function readBody(req, limit = MAX_BODY) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Запрос слишком велик.'), { status:413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Некорректный JSON.'), { status:400 }); }
}

function dateForArchive(db, date, clientKey, today = utcDate()) {
  if (date > today || date < BASE_DATE) return { date, available:false, status:'upcoming' };
  const id = ensureChallenge(db,date);
  const event = eventRow(db,id);
  const session = clientKey ? db.prepare('SELECT result,attempts_used FROM game_sessions WHERE client_key=? AND challenge_date=? AND mode IN (\'daily\',\'archive\') ORDER BY mode LIMIT 1').get(clientKey,date) : null;
  return { date, available:true, id, title:event?.title, category:event?.category_id, categoryName:event?.category_name, period:event?.period, difficulty:event?.difficulty, status:session?.result || (session ? 'playing' : 'available'), attemptsUsed:session?.attempts_used ?? null };
}

function rateLimit(map, key, now = Date.now()) {
  const item = map.get(key);
  if (!item || now - item.start >= 60_000) { map.set(key,{start:now,count:1}); return true; }
  item.count++;
  return item.count <= MAX_GUESSES_PER_MINUTE;
}

export function createApp({ dbPath = path.join(DATA,'hrono.sqlite'), adminToken = process.env.ADMIN_TOKEN || '', nowProvider = () => new Date() } = {}) {
  const db = openDatabase(dbPath);
  seed(db);
  const rateLimits = new Map();
  const server = http.createServer(async (req,res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const ip = req.socket.remoteAddress || 'unknown';
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') return send(res,200,{ok:true,utcDate:utcDate(nowProvider())});
      if (req.method === 'GET' && url.pathname === '/api/config') return send(res,200,{baseUrl:siteBaseUrl()});
      if (req.method === 'GET' && url.pathname === '/api/categories') return send(res,200,{categories:categoryRows(db)});
      if (req.method === 'GET' && url.pathname === '/api/today') {
        const date = utcDate(nowProvider());
        const eventId = ensureChallenge(db,date);
        return send(res,200,{date,baseDate:BASE_DATE,event:safeEvent(eventRow(db,eventId))});
      }
      if (req.method === 'GET' && url.pathname === '/api/challenge') {
        const date = url.searchParams.get('date');
        if (!isDate(date) || date > utcDate(nowProvider()) || date < BASE_DATE) return send(res,404,{error:'Задание для этой даты недоступно.'});
        return send(res,200,{date,event:safeEvent(eventRow(db,ensureChallenge(db,date)))});
      }
      if (req.method === 'GET' && url.pathname === '/api/archive') {
        const year = Number(url.searchParams.get('year'));
        const month = Number(url.searchParams.get('month'));
        if (!Number.isInteger(year) || year < 2026 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) return send(res,400,{error:'Некорректный месяц архива.'});
        const client = url.searchParams.get('clientKey');
        if (client && !/^[0-9a-f-]{36}$/i.test(client)) return send(res,400,{error:'Некорректный профиль гостя.'});
        const days = new Date(Date.UTC(year,month,0)).getUTCDate();
        const entries = [];
        const today=utcDate(nowProvider());
        for (let day=1; day<=days; day++) entries.push(dateForArchive(db,`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`,client,today));
        return send(res,200,{year,month,baseDate:BASE_DATE,serverDate:today,entries});
      }
      if (req.method === 'GET' && url.pathname === '/api/stats') {
        const client = url.searchParams.get('clientKey') || '';
        if (!/^[0-9a-f-]{36}$/i.test(client)) return send(res,400,{error:'Не удалось определить гостевой профиль.'});
        return send(res,200,calcStats(db,client,utcDate(nowProvider())));
      }
      if (req.method === 'DELETE' && url.pathname === '/api/profile') {
        const body = await readBody(req);
        const clientKey = getClientKey(body);
        db.prepare('DELETE FROM game_sessions WHERE client_key=?').run(clientKey);
        return send(res,200,{deleted:true});
      }
      if (req.method === 'GET' && url.pathname === '/sitemap.xml') {
        const base=xmlEscape(`${siteBaseUrl().replace(/\/$/,'')}/`);
        const xml=`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}</loc><changefreq>daily</changefreq></url></urlset>`;
        res.writeHead(200,{'content-type':'application/xml; charset=utf-8','cache-control':'public, max-age=3600','x-content-type-options':'nosniff'});
        return res.end(xml);
      }
      if (req.method === 'GET' && url.pathname === '/robots.txt') {
        const robots=`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${siteBaseUrl().replace(/\/$/,'')}/sitemap.xml\n`;
        res.writeHead(200,{'content-type':'text/plain; charset=utf-8','cache-control':'public, max-age=3600','x-content-type-options':'nosniff'});
        return res.end(robots);
      }
      if (req.method === 'POST' && url.pathname === '/api/sessions') {
        const body = await readBody(req);
        const clientKey = getClientKey(body);
        let session;
        const today=utcDate(nowProvider());
        if (body.mode === 'practice') session = startPractice(db,{ clientKey, category:body.category || '', difficulty:body.difficulty || '', exclude:body.exclude || [], today });
        else session = createSession(db,{clientKey,mode:body.mode,challengeDate:body.date,today});
        return send(res,200,sessionView(db,session,{reveal:Boolean(session.completed_at)}));
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/sessions/')) {
        const id = url.pathname.slice('/api/sessions/'.length);
        const client = url.searchParams.get('clientKey') || '';
        if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(client)) return send(res,400,{error:'Некорректная игровая сессия.'});
        const session = db.prepare('SELECT * FROM game_sessions WHERE id=? AND client_key=?').get(id,client);
        if (!session) return send(res,404,{error:'Игровая сессия не найдена.'});
        return send(res,200,sessionView(db,session,{reveal:Boolean(session.completed_at)}));
      }
      if (req.method === 'POST' && /^\/api\/sessions\/[0-9a-f-]+\/guess$/.test(url.pathname)) {
        if (!rateLimit(rateLimits,ip)) return send(res,429,{error:'Слишком много попыток за короткое время. Подожди минуту.'},{'retry-after':'60'});
        const body = await readBody(req);
        const clientKey = getClientKey(body);
        const sessionId = url.pathname.split('/')[3];
        const session = db.prepare('SELECT * FROM game_sessions WHERE id=? AND client_key=?').get(sessionId,clientKey);
        if (!session) return send(res,404,{error:'Игровая сессия не найдена.'});
        if (session.completed_at) return send(res,409,{error:'Эта игра уже завершена.',session:sessionView(db,session,{reveal:true})});
        const guess = String(body.guess ?? '');
        if (!/^\d{4}$/.test(guess)) return send(res,400,{error:'Введи ровно четыре цифры.'});
        if (guess === '0000') return send(res,400,{error:'Ноль не является годом. Введи четыре цифры года.'});
        if (session.attempts_used >= 6) return send(res,409,{error:'Попытки закончились.'});
        const event = db.prepare('SELECT year_display FROM historical_events WHERE id=?').get(session.event_id);
        const feedback = compareYear(event.year_display,guess);
        const position = session.attempts_used + 1;
        const won = guess === event.year_display;
        const lost = !won && position === 6;
        const completedAt = won || lost ? isoNow() : null;
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('INSERT INTO guesses(session_id,position,value,feedback_json,created_at) VALUES(?,?,?,?,?)').run(session.id,position,guess,JSON.stringify(feedback),isoNow());
          db.prepare('UPDATE game_sessions SET attempts_used=?,completed_at=?,result=? WHERE id=?').run(position,completedAt,won?'won':lost?'lost':null,session.id);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        const fresh = db.prepare('SELECT * FROM game_sessions WHERE id=?').get(session.id);
        const result = { feedback,position,attemptsRemaining:6-position,status:won?'won':lost?'lost':'playing' };
        if (completedAt) result.event = safeEvent(eventWithSources(db,session.event_id),{reveal:true});
        return send(res,200,result);
      }
      if (url.pathname.startsWith('/api/admin/')) {
        if (!adminToken || req.headers.authorization !== `Bearer ${adminToken}`) return send(res,403,{error:'Административный доступ закрыт. Настрой ADMIN_TOKEN на сервере.'});
        if (req.method === 'GET' && url.pathname === '/api/admin/overview') {
          const counts = db.prepare('SELECT COUNT(*) AS total,SUM(published) AS published FROM historical_events').get();
          const scheduled = db.prepare('SELECT COUNT(*) AS total FROM daily_challenges').get();
          return send(res,200,{events:counts.total,published:counts.published || 0,scheduled:scheduled.total,categories:categoryRows(db)});
        }
        if (req.method === 'GET' && url.pathname === '/api/admin/events') {
          const events=db.prepare(`SELECT e.id,e.year,e.era,e.title,e.category_id,c.name AS category_name,e.difficulty,e.fact_check_status,e.published,
              (SELECT COUNT(*) FROM content_sources s WHERE s.event_id=e.id) AS source_count,
              (SELECT COUNT(*) FROM game_sessions g WHERE g.event_id=e.id) AS games_played
            FROM historical_events e JOIN categories c ON c.id=e.category_id ORDER BY e.published DESC,e.year DESC,e.title LIMIT 1000`).all();
          return send(res,200,{events});
        }
        if (req.method === 'GET' && url.pathname === '/api/admin/export') {
          const rows=db.prepare('SELECT * FROM historical_events ORDER BY id').all();
          const events=rows.map(row=>({
            id:row.id,year:row.year,era:row.era,exactDate:row.exact_date,title:row.title,explanation:row.explanation,period:row.period,
            category:row.category_id,difficulty:row.difficulty,region:row.region,keywords:JSON.parse(row.keywords_json),
            factCheckStatus:row.fact_check_status,published:Boolean(row.published),createdAt:row.created_at,updatedAt:row.updated_at,
            translations:db.prepare('SELECT locale,question_text AS question FROM question_translations WHERE event_id=? ORDER BY locale').all(row.id),
            sources:sourceList(db,row.id)
          }));
          return send(res,200,{events});
        }
        if (req.method === 'POST' && url.pathname === '/api/admin/import') {
          const body = await readBody(req,MAX_IMPORT_BODY);
          const records = Array.isArray(body) ? body : body.events || [body];
          if (!Array.isArray(records) || records.length < 1 || records.length > 1000) return send(res,400,{error:'Передай массив от 1 до 1000 событий.'});
          let normalized;
          try { normalized = records.map(item => normalizeEvent(item)); }
          catch(error) { return send(res,400,{error:error.message}); }
          for(const event of normalized) if(!db.prepare('SELECT id FROM categories WHERE id=?').get(event.category)) return send(res,400,{error:`Неизвестная категория у события ${event.id}.`});
          for(const event of normalized) {
            const duplicate=db.prepare('SELECT id FROM historical_events WHERE year=? AND lower(title)=lower(?) AND id<>? LIMIT 1').get(event.year,event.title,event.id);
            if(duplicate)return send(res,409,{error:`Похоже на дубликат события ${duplicate.id} (${event.year} — ${event.title}).`});
          }
          db.exec('BEGIN IMMEDIATE');
          try { for (const event of normalized) upsertEvent(db,event); db.exec('COMMIT'); }
          catch (error) { db.exec('ROLLBACK'); throw error; }
          return send(res,200,{imported:normalized.length,message:`Импортировано записей: ${normalized.length}.`});
        }
        if (req.method === 'POST' && url.pathname === '/api/admin/categories') {
          const body = await readBody(req,MAX_IMPORT_BODY);
          const records = Array.isArray(body) ? body : body.categories || [body];
          if (!Array.isArray(records) || records.length < 1 || records.length > 100) return send(res,400,{error:'Передай массив от 1 до 100 категорий.'});
          const normalized = records.map((item,index) => {
            const id=String(item?.id||'');
            if(!/^[a-z0-9][a-z0-9-]{2,59}$/.test(id)) throw Object.assign(new Error(`Категория ${index+1}: некорректный идентификатор.`),{status:400});
            if(typeof item.name!=='string'||!item.name.trim()||item.name.length>90) throw Object.assign(new Error(`Категория ${id}: укажи название до 90 символов.`),{status:400});
            if(typeof item.description!=='string'||item.description.length>300) throw Object.assign(new Error(`Категория ${id}: описание должно быть до 300 символов.`),{status:400});
            return {id,name:item.name.trim(),description:item.description.trim(),icon:String(item.icon||'✦').slice(0,8),sortOrder:Number.isInteger(item.sortOrder)?item.sortOrder:index+20};
          });
          const save=db.prepare(`INSERT INTO categories(id,name,description,icon,sort_order) VALUES(?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,icon=excluded.icon,sort_order=excluded.sort_order`);
          db.exec('BEGIN IMMEDIATE');
          try { for(const item of normalized)save.run(item.id,item.name,item.description,item.icon,item.sortOrder);db.exec('COMMIT'); }
          catch(error){db.exec('ROLLBACK');throw error;}
          return send(res,200,{imported:normalized.length,message:`Категорий сохранено: ${normalized.length}.`});
        }
        if (req.method === 'POST' && url.pathname === '/api/admin/schedule') {
          const body = await readBody(req);
          if (!isDate(body.date)) return send(res,400,{error:'Укажи дату в формате ГГГГ-ММ-ДД.'});
          const event = db.prepare(`SELECT id FROM historical_events WHERE id=? AND published=1 AND fact_check_status='reviewed'`).get(String(body.eventId || ''));
          if (!event) return send(res,404,{error:'Можно назначить только опубликованный и проверенный вопрос.'});
          db.prepare(`INSERT INTO daily_challenges(challenge_date,event_id,assigned_by,created_at) VALUES(?,?,?,?)
            ON CONFLICT(challenge_date) DO UPDATE SET event_id=excluded.event_id,assigned_by=excluded.assigned_by,created_at=excluded.created_at`).run(body.date,event.id,'admin',isoNow());
          return send(res,200,{date:body.date,eventId:event.id,message:'Задание назначено.'});
        }
        return send(res,404,{error:'Маршрут администратора не найден.'});
      }
      if (url.pathname.startsWith('/api/')) return send(res,404,{error:'Маршрут не найден.'});
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res,405,{error:'Метод не поддерживается.'});
      let requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      let file = path.resolve(PUBLIC,requested);
      if (!file.startsWith(`${path.resolve(PUBLIC)}${path.sep}`) && file !== path.resolve(PUBLIC,'index.html')) return send(res,403,{error:'Доступ запрещён.'});
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(PUBLIC,'index.html');
      let contents = fs.readFileSync(file);
      if(file===path.resolve(PUBLIC,'index.html')) contents=Buffer.from(contents.toString('utf8').replaceAll('__BASE_URL__',xmlEscape(`${siteBaseUrl().replace(/\/$/,'')}`)),'utf8');
      res.writeHead(200,{
        'content-type':MIME[path.extname(file)] || 'application/octet-stream','content-length':contents.length,
        'cache-control':path.basename(file)==='index.html'?'no-cache':'public, max-age=300',
        'x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin',
        'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
      });
      if (req.method === 'HEAD') return res.end();
      return res.end(contents);
    } catch (error) {
      const status = errorStatus(error);
      if (status >= 500) console.error(`[hrono] ${req.method} ${url.pathname}: ${error.message}`);
      return send(res,status,{error:status>=500?'Сервер не смог обработать запрос. Проверь журналы приложения.':error.message});
    }
  });
  return { server, db, close() { if(server.listening)server.close(); db.close(); } };
}

loadEnv();
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || '127.0.0.1';
  const dbPath = path.resolve(ROOT, process.env.DATABASE_PATH || './data/hrono.sqlite');
  const app = createApp({ dbPath });
  app.server.listen(port,host,() => console.log(`ХРОНО доступна: http://${host}:${port}`));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,() => app.close());
}
