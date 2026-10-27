const root = document.getElementById('root');
const toast = document.getElementById('toast');
const CATEGORY_ANY = '';
const TILE_LABEL = { correct:'на правильном месте', present:'есть в ответе, но в другой позиции', absent:'в ответе нет' };
const NAV = [
  ['today','Играть'], ['archive','Архив'], ['categories','Категории'], ['stats','Статистика'], ['rules','Правила']
];
const state = {
  clientKey: getClientKey(), today: null, categories: [], baseUrl: window.location.origin,
  theme: localStorage.getItem('hrono:theme') || 'dark', route: '', selectedDate: null,
  archiveYear: new Date().getUTCFullYear(), archiveMonth: new Date().getUTCMonth()+1,
  archiveCategory: CATEGORY_ANY, archivePeriod: CATEGORY_ANY, practiceCategory: CATEGORY_ANY,
  difficulty: 'medium', hardMode: localStorage.getItem('hrono:hard-mode') === 'true', practice: null, toastTimer: 0
};

function getClientKey() {
  let key = localStorage.getItem('hrono:guest');
  if (!key) {
    key = crypto.randomUUID();
    localStorage.setItem('hrono:guest',key);
  }
  return key;
}

function esc(value='') {
  return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && typeof options.body !== 'string') {
    headers['content-type'] = 'application/json';
    options = { ...options, body:JSON.stringify(options.body) };
  }
  const response = await fetch(url,{...options,headers});
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const error = new Error(data.error || 'Не удалось выполнить запрос.');
    error.status = response.status;
    error.session = data.session;
    throw error;
  }
  return data;
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('show'),2400);
}

function currentRoute() {
  const value = location.hash.replace(/^#\/?/,'').split('?')[0];
  return value || 'today';
}

function setTheme(theme) {
  state.theme = theme === 'light' ? 'light' : 'dark';
  document.body.dataset.theme = state.theme;
  localStorage.setItem('hrono:theme',state.theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',state.theme==='dark'?'#101314':'#f1f0e9');
  const themeButton=document.querySelector('.theme-toggle');
  if(themeButton){themeButton.innerHTML=icon(state.theme==='dark'?'sun':'moon');themeButton.setAttribute('aria-label',state.theme==='dark'?'Включить светлую тему':'Включить тёмную тему');}
  document.querySelectorAll('[data-action="theme"]').forEach(button=>button.setAttribute('aria-checked',String(state.theme==='light')));
}

function icon(name) {
  const icons = {
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m10.3 10.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m10.3-10.3 1.42-1.42"/>',
    moon:'<path d="M20.6 14.1A8.8 8.8 0 0 1 9.9 3.4 9 9 0 1 0 20.6 14.1Z"/>',
    user:'<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="8" r="4"/>',
    menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
    arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
    back:'<path d="M19 12H5m7 7-7-7 7-7"/>',
    next:'<path d="M5 12h14m-7-7 7 7-7 7"/>',
    external:'<path d="M14 3h7v7m0-7-9 9"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    share:'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.7 10.7 6.6-4.4m-6.6 7 6.6 4.3"/>'
  };
  return `<svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[name]||''}</svg>`;
}

function navMarkup(active) {
  return NAV.map(([id,label]) => `<a class="nav-link" href="#${id}" ${active===id?'aria-current="page"':''}>${label}</a>`).join('');
}

function shell(content, active) {
  return `<div class="app-shell">
    <header class="site-header">
      <a class="brand" href="#today" aria-label="ХРОНО — на главную">
        <span class="brand-mark"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.3" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.5v5l3.3 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="18.6" cy="5.4" r="2" fill="currentColor"/></svg></span>
        <span><span class="brand-word">ХРОНО</span><span class="brand-caption">История в четырёх цифрах</span></span>
      </a>
      <nav class="main-nav" aria-label="Главная навигация">${navMarkup(active)}</nav>
      <div class="header-actions">
        <button class="icon-button theme-toggle" type="button" aria-label="Переключить тему">${icon(state.theme==='dark'?'sun':'moon')}</button>
        <a class="icon-button" href="#profile" aria-label="Настройки профиля">${icon('user')}</a>
        <a class="primary-button header-play" href="#today">Играть сегодня ${icon('arrow')}</a>
        <button class="icon-button menu-toggle" type="button" aria-label="Открыть меню" aria-expanded="false">${icon('menu')}</button>
      </div>
      <nav class="mobile-nav-panel" aria-label="Мобильная навигация">${navMarkup(active)}</nav>
    </header>
    <main class="main-content" id="main" tabindex="-1">${content}</main>
    <footer class="site-footer">
      <span>© ХРОНО · Локальная версия, 2026</span>
      <div class="footer-links"><a href="#rules">Правила</a><a href="#profile">Конфиденциальность</a><a href="#admin">Редакторам</a></div>
    </footer>
  </div>`;
}

function pageLoading() {
  root.innerHTML = shell('<div class="loading-view"><span><i class="loading-dot"></i>Загружаю исторический архив…</span></div>',currentRoute());
  bindShell();
}

function bindShell() {
  document.querySelector('.theme-toggle')?.addEventListener('click',() => { setTheme(state.theme==='dark'?'light':'dark'); });
  const menuButton = document.querySelector('.menu-toggle');
  menuButton?.addEventListener('click',() => {
    const panel = document.querySelector('.mobile-nav-panel');
    const open = !panel.classList.contains('open');
    panel.classList.toggle('open',open);
    menuButton.setAttribute('aria-expanded',String(open));
  });
  document.querySelectorAll('.mobile-nav-panel a').forEach(link => link.addEventListener('click',() => document.querySelector('.mobile-nav-panel')?.classList.remove('open')));
  document.querySelectorAll('[data-action="theme"]').forEach(button => button.addEventListener('click',() => setTheme(state.theme==='dark'?'light':'dark')));
}

function dateLabel(date, options = { day:'numeric', month:'long', year:'numeric' }) {
  return new Intl.DateTimeFormat('ru-RU',{...options,timeZone:'UTC'}).format(new Date(`${date}T00:00:00Z`));
}
function dayNumber(date) {
  return Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse('2026-01-01T00:00:00Z')) / 86_400_000) + 1;
}
function statusSummary(session) {
  if (!session) return 'Попытка 1 из 6';
  if (session.status === 'playing') return `Попытка ${session.attemptsUsed+1} из 6`;
  return session.status === 'won' ? `Разгадано за ${session.attemptsUsed} ${plural(session.attemptsUsed,'попытку','попытки','попыток')}` : 'Попытки закончились';
}
function plural(value, one, few, many) {
  const n=Math.abs(value)%100, n1=n%10;
  if(n>10&&n<20)return many;
  if(n1>1&&n1<5)return few;
  if(n1===1)return one;
  return many;
}

function feedbackName(status) { return TILE_LABEL[status] || 'неизвестный результат'; }

function boardMarkup(session) {
  const guesses = session?.guesses || [];
  const active = session?.status === 'playing';
  const rows = [];
  for (let index=0;index<6;index++) {
    const guess = guesses[index];
    const isInput = active && index === guesses.length;
    const cells = [];
    for (let pos=0;pos<4;pos++) {
      if (guess) {
        const result=guess.feedback[pos], digit=guess.value[pos];
        const reveal=index===guesses.length-1?' reveal':'';
        cells.push(`<div class="tile ${result}${reveal}" style="--reveal-delay:${pos*82}ms" aria-label="${pos+1}-я цифра ${digit}, ${feedbackName(result)}">${digit}</div>`);
      } else if (isInput) {
        const lockedDigit=state.hardMode ? guesses.at(-1)?.feedback[pos]==='correct' ? guesses.at(-1).value[pos] : '' : '';
        cells.push(`<input class="tile tile-input ${lockedDigit?'correct locked':''} ${pos===0?'is-active':''}" aria-label="Попытка ${index+1}, цифра ${pos+1}${lockedDigit?', зафиксирована':''}" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" autocapitalize="off" maxlength="1" data-position="${pos}" ${lockedDigit?`value="${lockedDigit}" readonly aria-readonly="true"`:''} />`);
      } else {
        cells.push('<div class="tile" aria-hidden="true"></div>');
      }
    }
    const spoken = guess ? `<span class="sr-only">Попытка ${index+1}: ${guess.feedback.map((item,i)=>`${guess.value[i]} ${feedbackName(item)}`).join(', ')}.</span>` : '';
    const summary=guess?`<p class="row-feedback">На месте: ${guess.feedback.filter(value=>value==='correct').length} · Есть, но в другом месте: ${guess.feedback.filter(value=>value==='present').length} · Нет: ${guess.feedback.filter(value=>value==='absent').length}</p>`:'';
    rows.push(`<div class="board-row-wrap"><div class="board-row" role="group" aria-label="Попытка ${index+1}">${cells.join('')}${spoken}</div>${summary}</div>`);
  }
  return `<div class="board" id="gameBoard">${rows.join('')}</div>`;
}

function eraLabel(era) { return era === 'BCE' ? '<span class="mini-tag">до нашей эры</span>' : ''; }

function resultMarkup(session, questionNumber) {
  if (!session || !['won','lost'].includes(session.status) || !session.event) return '';
  const event=session.event;
  const resultText=session.status==='won'?'Дата найдена':'Время вышло';
  const sourceLinks=(event.sources||[]).map(source=>`<a class="source-link" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)} ${icon('external')}</a>`).join('');
  const tags=[event.period,event.categoryName,event.region,...(event.era==='BCE'?['до нашей эры']:[])].map(tag=>`<span class="mini-tag">${esc(tag)}</span>`).join('');
  const practiceNext=session.mode==='practice'?'<button class="primary-button" type="button" data-action="next-practice">Следующий вопрос '+icon('arrow')+'</button>':`<a class="secondary-button" href="#practice">Следующий вопрос ${icon('arrow')}</a>`;
  return `<section class="result-card" aria-live="polite">
    <div class="result-top"><div><p class="result-kicker">${resultText} · ${session.attemptsUsed}/6</p><h2 class="result-title">${esc(event.title)}</h2></div><div class="result-year">${esc(event.yearDisplay)}${event.era==='BCE'?' до н. э.':''}</div></div>
    <p class="result-explanation">${esc(event.explanation)}</p>
    <div class="result-tags">${tags}</div>${sourceLinks}
    <div class="share-actions">${practiceNext}<button class="secondary-button" type="button" data-action="copy-result">${icon('copy')} Скопировать результат</button><button class="secondary-button" type="button" data-action="share-result">${icon('share')} Поделиться</button><button class="secondary-button" type="button" data-action="download-result">${icon('download')} PNG</button></div>
  </section>`;
}

function gameActions(session, date, mode) {
  if (!session) return `<div class="game-actions"><button class="primary-button" type="button" data-action="start-game">${mode==='daily'?'Начать задание дня':'Сыграть это задание'} ${icon('arrow')}</button></div>`;
  if (session.status !== 'playing') return '';
  return `<div class="game-actions"><button class="primary-button" type="submit" form="guessForm" data-action="submit-guess" disabled>Проверить год ${icon('arrow')}</button><button class="text-button" type="button" data-action="clear-input">Очистить</button></div>`;
}

function gameForm(session) {
  if (!session || session.status !== 'playing') return '';
  return `<form id="guessForm" autocomplete="off"><input type="submit" tabindex="-1" aria-hidden="true" class="hidden" /></form>`;
}

function gamePanel(event, session, date, mode) {
  const title=mode==='daily'?'Задание дня':mode==='practice'?'Тренировка':`Архив · ${dateLabel(date,{day:'numeric',month:'long',year:'numeric'})}`;
  const intro=mode==='daily'?'Новое событие откроется в 00:00 UTC.':'Переиграй историческое задание и сравни результат.';
  const attemptLine=session ? statusSummary(session) : '6 попыток · четыре цифры';
  const msg=session?.status==='playing'?'Введи год. Правильная эра указана в вопросе.':session?.status==='won'?'Хорошая память. Историческая справка — ниже.':session?.status==='lost'?'Разбор события — ниже.':'Неполная попытка не расходует ход.';
  const board=session?boardMarkup(session):boardMarkup(null);
  return `<section class="panel game-panel" aria-labelledby="questionTitle"><div class="game-panel-content">
    <div class="game-meta"><span class="badge"><i class="badge-dot"></i>${title}</span><span class="utc-label">№ ${String(dayNumber(date)).padStart(3,'0')} · UTC</span></div>
    ${eraLabel(event.era)}<h1 class="question-title" id="questionTitle">${esc(event.question)}</h1>
    <p class="question-hint">${intro}</p><div class="divider"></div>
    <div class="game-mode-toggle"><label><input type="checkbox" data-action="hard-mode" ${state.hardMode?'checked':''}><span><strong>Сложный режим</strong><small>Зелёные цифры фиксируются</small></span></label></div>
    <p class="guess-label" id="attemptStatus">${attemptLine}</p>${gameForm(session)}${board}
    <p class="board-caption">Цвета показывают подсказки; под каждой строкой есть текстовый разбор.</p>
    ${gameActions(session,date,mode)}
    <p class="game-message" id="gameMessage" role="status" aria-live="polite">${esc(msg)}</p>
    ${resultMarkup(session,dayNumber(date))}
    </div></section>`;
}

function sidePanel(categories) {
  const top=categories.slice(0,4).map(c=>`<a class="category-preview-item" href="#categories"><span>${esc(c.icon)} &nbsp;${esc(c.name)}</span><span class="category-preview-count">${c.event_count} ${plural(c.event_count,'вопрос','вопроса','вопросов')}</span></a>`).join('');
  return `<aside class="side-column" aria-label="О игре">
    <section class="side-card"><h2 class="side-card-heading">Цветовые подсказки <span>как играть</span></h2>
      <div class="steps"><div class="step"><span class="step-symbol green">✓</span><span><strong style="color:var(--ink)">Зелёный</strong> — цифра на своём месте.</span></div><div class="step"><span class="step-symbol gold">↔</span><span><strong style="color:var(--ink)">Жёлтый</strong> — цифра есть, позиция другая.</span></div><div class="step"><span class="step-symbol gray">·</span><span><strong style="color:var(--ink)">Серый</strong> — этой цифры в годе нет.</span></div></div>
      <div class="side-divider"></div><div class="side-stat-row"><span>Одна загадка</span><strong>каждый день</strong></div><div class="side-stat-row"><span>Попыток на ответ</span><strong>6</strong></div><div class="side-stat-row"><span>Год в клетках</span><strong>4 цифры</strong></div>
    </section>
    <section class="side-card"><h2 class="side-card-heading">Исторические темы <span>${categories.length} подборок</span></h2><div class="category-preview">${top}</div><a class="side-link" href="#categories">Все подборки ${icon('arrow')}</a></section>
    </aside>`;
}

async function renderToday() {
  if (!state.today) state.today=await api('/api/today');
  const date=state.selectedDate || state.today.date;
  const mode=date===state.today.date?'daily':'archive';
  let event=state.today.event;
  if (date !== state.today.date) event=(await api(`/api/challenge?date=${encodeURIComponent(date)}`)).event;
  let session=null;
  const key=`hrono:session:${state.clientKey}:${mode}:${date}`;
  const sessionId=localStorage.getItem(key);
  if (sessionId) {
    try { session=await api(`/api/sessions/${encodeURIComponent(sessionId)}?clientKey=${encodeURIComponent(state.clientKey)}`); }
    catch (error) { if (error.status!==404) throw error; localStorage.removeItem(key); }
  }
  state.visibleSession=session;
  const title=mode==='daily'?'Сможешь вспомнить этот год?':'Вернись к одной из прошлых дат.';
  const subtitle=mode==='daily'?'Одно событие. Четыре цифры. Шесть попыток.':'Архивное задание остаётся тем же — попробуй найти дату.';
  return `<div class="hero-strip"><div><div class="eyebrow">История в четырёх цифрах</div><h1 class="hero-title">${title.replace('год','<em>год</em>')}</h1><p class="hero-description">${subtitle}</p></div><div class="hero-number"><span>ОТВЕТ</span><strong>ГГГГ</strong><span class="number-divider"></span><span>6 попыток</span></div></div>
    <div class="game-layout">${gamePanel(event,session,date,mode)}${sidePanel(state.categories)}</div>`;
}

function monthName(year,month) { return new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(year,month-1,1))); }

async function renderArchive() {
  const result=await api(`/api/archive?year=${state.archiveYear}&month=${state.archiveMonth}&clientKey=${encodeURIComponent(state.clientKey)}`);
  const categoryOptions=state.categories.map(c=>`<option value="${esc(c.id)}" ${state.archiveCategory===c.id?'selected':''}>${esc(c.name)}</option>`).join('');
  const entries=result.entries;
  const firstDay=(new Date(Date.UTC(result.year,result.month-1,1)).getUTCDay()+6)%7;
  const cells=[...Array(firstDay).fill('<span aria-hidden="true"></span>')];
  const marker={won:'✓',lost:'×',playing:'·',available:'',upcoming:''};
  for (const entry of entries) {
    const number=Number(entry.date.slice(-2));
    const disabled=!entry.available;
    const classes=['calendar-day',entry.available?'available':'',entry.status==='won'?'won':'',entry.status==='lost'?'lost':'',entry.status==='playing'?'playing':'',entry.date===result.serverDate?'today':''].filter(Boolean).join(' ');
    cells.push(`<button class="${classes}" type="button" data-date="${entry.date}" ${disabled?'disabled':''} aria-label="${dateLabel(entry.date,{day:'numeric',month:'long'})}${entry.status==='won'?', решено':''}${disabled?', пока недоступно':''}"><span class="day-number">${number}</span><span class="day-marker" aria-hidden="true">${marker[entry.status]||''}</span></button>`);
  }
  const filterEntries=entries.filter(e=>e.available&&(!state.archiveCategory||e.category===state.archiveCategory)&&(!state.archivePeriod||e.period===state.archivePeriod));
  const periodOptions=[...new Set(entries.filter(e=>e.available).map(e=>e.period))].sort().map(p=>`<option value="${esc(p)}" ${state.archivePeriod===p?'selected':''}>${esc(p)}</option>`).join('');
  const rows=filterEntries.map(entry=>`<button class="archive-row" type="button" data-date="${entry.date}"><span class="archive-row-main"><span class="archive-row-title">${esc(entry.title)}</span><span class="archive-row-meta">${dateLabel(entry.date,{day:'numeric',month:'long'})} · ${esc(entry.categoryName)} · ${esc(entry.period)}</span></span><span class="archive-row-state ${entry.status==='won'?'won':entry.status==='lost'?'lost':''}">${entry.status==='won'?`Решено за ${entry.attemptsUsed}`:entry.status==='lost'?'Не разгадано':entry.status==='playing'?'В процессе':'Играть'}</span></button>`).join('');
  return `<div class="page-heading"><div><div class="eyebrow">Задания по датам</div><h1>Исторический архив</h1><p>Каждый прошедший день связан с одним фиксированным вопросом. Открывай задание и продолжай с сохранённого места.</p></div><div class="page-heading-actions"><button class="secondary-button" type="button" data-action="month-prev">${icon('back')} Предыдущий</button><span class="badge">${esc(monthName(state.archiveYear,state.archiveMonth))}</span><button class="secondary-button" type="button" data-action="month-next">Следующий ${icon('next')}</button></div></div>
    <section class="content-panel"><div class="toolbar"><div class="filter-group"><select class="select-control" id="archiveCategory" aria-label="Фильтр по категории"><option value="">Все категории</option>${categoryOptions}</select><select class="select-control" id="archivePeriod" aria-label="Фильтр по эпохе"><option value="">Все эпохи</option>${periodOptions}</select></div><span class="utc-label">Дата обновления — ${dateLabel(result.serverDate,{day:'numeric',month:'long',year:'numeric'})} UTC</span></div>
      <div class="archive-grid-wrap"><div class="calendar" role="grid" aria-label="Календарь заданий"><span class="calendar-weekday">Пн</span><span class="calendar-weekday">Вт</span><span class="calendar-weekday">Ср</span><span class="calendar-weekday">Чт</span><span class="calendar-weekday">Пт</span><span class="calendar-weekday">Сб</span><span class="calendar-weekday">Вс</span>${cells.join('')}</div></div>
      <div class="calendar-legend"><span class="legend-item"><i class="legend-dot"></i>Доступно</span><span class="legend-item"><i class="legend-dot won"></i>Победа</span><span class="legend-item"><i class="legend-dot lost"></i>Завершено</span><span class="legend-item">Будущие даты откроются позже</span></div>
      <div class="archive-results">${rows||'<div class="empty-state">В этом месяце нет заданий по выбранным фильтрам.</div>'}</div>
    </section>`;
}

function difficultyControls() {
  return `<div class="difficulty-pills" aria-label="Уровень сложности">${[['easy','Лёгкая'],['medium','Средняя'],['hard','Сложная']].map(([id,label])=>`<button class="difficulty-pill" type="button" data-difficulty="${id}" aria-pressed="${state.difficulty===id}">${label}</button>`).join('')}</div>`;
}

async function renderCategories() {
  const categories=state.categories.map(c=>`<button class="category-card" type="button" data-category="${esc(c.id)}"><span class="category-icon">${esc(c.icon)}</span><h2>${esc(c.name)}</h2><p>${esc(c.description)}</p><span class="category-card-footer"><span>${c.event_count} ${plural(c.event_count,'вопрос','вопроса','вопросов')}</span><strong>Начать ${icon('arrow')}</strong></span></button>`).join('');
  return `<div class="page-heading"><div><div class="eyebrow">Тематические подборки</div><h1>Выбери свою эпоху</h1><p>Каждая подборка использует отдельный пул опубликованных исторических событий. Сложность задаёт знакомство с событием, не число попыток.</p></div>${difficultyControls()}</div>
    <div class="toolbar"><div class="filter-group"><button class="secondary-button" type="button" data-category="">${icon('share')} Случайная категория</button></div><span class="utc-label">Новые события добавляются через редакторский импорт</span></div>
    <section class="category-grid" aria-label="Исторические категории">${categories}</section>`;
}

async function renderPractice() {
  let session=state.practice;
  if (!session) {
    const sessionId=localStorage.getItem(`hrono:practice:${state.clientKey}`);
    if (sessionId) {
      try { session=await api(`/api/sessions/${encodeURIComponent(sessionId)}?clientKey=${encodeURIComponent(state.clientKey)}`); state.practice=session; }
      catch (error) { if (error.status!==404) throw error; localStorage.removeItem(`hrono:practice:${state.clientKey}`); }
    }
  }
  if (!session) return `<div class="page-heading"><div><div class="eyebrow">Без ограничения по раундам</div><h1>Бесконечная игра</h1><p>Тренируйся на новых вопросах. Недавно сыгранные загадки временно исключаются из выбора.</p></div>${difficultyControls()}</div>
    <div class="practice-setup"><p>Настрой сложность и начни. Вопрос выберется на сервере, а ответ останется скрыт до конца раунда.</p><button class="primary-button" type="button" data-action="start-practice">Начать игру ${icon('arrow')}</button></div>
    <div class="empty-state">В тренировке доступны все опубликованные события${state.practiceCategory?` выбранной темы «${esc(state.categories.find(c=>c.id===state.practiceCategory)?.name||'')}»`:''}.</div>`;
  return `<div class="page-heading"><div><div class="eyebrow">Бесконечная игра</div><h1>Тренировка без конца</h1><p>Вопросы, которые ты уже решал недавно, временно пропускаются.</p></div>${difficultyControls()}</div>
    ${gamePanel(session.event,session,session.challengeDate||state.today.date,'practice')}`;
}

async function renderStats() {
  const stats=await api(`/api/stats?clientKey=${encodeURIComponent(state.clientKey)}`);
  const cells=[
    ['Сыграно',stats.gamesPlayed,'всего партий'],['Победы',stats.wins,`${stats.winRate}% от завершённых`],['Серия',stats.currentStreak,`${plural(stats.currentStreak,'день','дня','дней')} подряд`],['Дни в архиве',stats.completedDaily,'завершённых заданий']
  ].map(([label,value,note])=>`<div class="stat-card"><span class="stat-label">${label}</span><strong class="stat-value">${value}</strong><div class="stat-note">${note}</div></div>`).join('');
  const max=Math.max(1,...stats.distribution);
  const dist=stats.distribution.map((value,index)=>`<div class="distribution-row"><span>${index+1}</span><div class="bar-track"><div class="bar-fill" style="width:${value?Math.max(7,Math.round(value/max*100)):0}%">${value?value:''}</div></div><span>${value}</span></div>`).join('');
  const achievements=stats.achievements.map(item=>`<div class="achievement ${item.unlocked?'unlocked':''}"><span class="achievement-icon">${item.unlocked?'✓':'·'}</span><span><strong>${esc(item.title)}</strong><small>${esc(item.description)}</small></span></div>`).join('');
  return `<div class="page-heading"><div><div class="eyebrow">Твоя история</div><h1>Личная статистика</h1><p>Партии и достижения сохраняются на этом устройстве в гостевом профиле. Показатели берутся из сохранённых игровых сессий.</p></div><a href="#today" class="secondary-button">К заданию дня ${icon('arrow')}</a></div>
    <div class="stats-grid">${cells}</div><div class="stats-lower"><section class="stats-subpanel"><h2>Победы по попыткам</h2><div class="distribution">${dist}</div><p class="privacy-note">Незавершённые партии входят в «Сыграно», но не учитываются в проценте побед.</p></section><section class="stats-subpanel"><h2>Достижения</h2><div class="achievement-list">${achievements}</div></section></div>`;
}

function renderRules() {
  return `<div class="page-heading"><div><div class="eyebrow">Коротко и ясно</div><h1>Правила ХРОНО</h1><p>Один ответ — четыре цифры года. Попробуй решить историческую загадку за шесть ходов.</p></div><a href="#today" class="primary-button">Играть сейчас ${icon('arrow')}</a></div>
    <div class="rules-grid"><section class="rule-card"><h2>Как читать цвета</h2><p>После каждой отправленной попытки клетки покажут, что удалось определить.</p><div class="example-row" aria-label="Пример цветовой подсказки"><span class="example-cell correct" aria-label="точное совпадение">1</span><span class="example-cell correct">4</span><span class="example-cell present">2</span><span class="example-cell present">9</span></div><p>В этом примере первые две цифры уже на своих местах; последние две есть в ответе, но стоят не там.</p></section>
      <section class="rule-card"><h2>Повторяющиеся цифры</h2><p>Одинаковые цифры в ответе учитываются по количеству. Точные совпадения расходуются первыми, а для жёлтых клеток остаются только неиспользованные цифры.</p><div class="example-row"><span class="example-cell correct">1</span><span class="example-cell correct">1</span><span class="example-cell absent">1</span><span class="example-cell absent">1</span></div><p>Если в загаданном году только две единицы, третья и четвёртая не получат жёлтый цвет.</p></section>
      <section class="rule-card"><h2>Ввод года</h2><ul class="rule-list"><li><span>01</span><span>Печатай цифры на клавиатуре или вводи их на экранной цифровой клавиатуре.</span></li><li><span>02</span><span>Курсор переходит дальше автоматически. Стрелками можно перемещаться, Backspace удаляет цифру.</span></li><li><span>03</span><span>Вставка четырёх цифр и отправка через Enter работают. Неполный ход не засчитывается.</span></li></ul></section>
      <section class="rule-card"><h2>Исторические даты</h2><p>Если событие произошло до нашей эры, это будет указано в вопросе. Вводятся четыре цифры года без знака эры. После завершения появятся объяснение и ссылка на источник.</p><ul class="rule-list"><li><span>—</span><span>Задание дня определяется серверной датой UTC и закрепляется в календаре.</span></li><li><span>—</span><span>Гостевой прогресс хранится в локальной SQLite базе приложения.</span></li></ul></section></div>`;
}

function renderProfile() {
  return `<div class="page-heading"><div><div class="eyebrow">Профиль устройства</div><h1>Настройки и приватность</h1><p>ХРОНО работает без регистрации. Гостевая статистика связана со случайным идентификатором на этом устройстве.</p></div></div>
    <section class="content-panel"><div class="settings-list"><div class="settings-row"><span class="settings-label"><strong>Тема оформления</strong><small>Выбери тёмное или светлое оформление.</small></span><button class="switch" type="button" role="switch" aria-checked="${state.theme==='light'}" data-action="theme" aria-label="Светлая тема"></button></div>
      <div class="settings-row"><span class="settings-label"><strong>Гостевой профиль</strong><small>Сессии и статистика остаются в базе этого экземпляра приложения.</small></span><span class="badge">Активен на этом устройстве</span></div>
      <div class="settings-row"><span class="settings-label"><strong>Аккаунты и синхронизация</strong><small>Авторизация и облачный перенос не подключены в локальной версии.</small></span><span class="badge">Не настроено</span></div>
      <div class="settings-row"><span class="settings-label"><strong>Удалить локальный прогресс</strong><small>Сбросит историю этого гостевого профиля и его настройки.</small></span><button class="secondary-button" type="button" data-action="clear-profile">Удалить данные</button></div>
    </div><p class="privacy-note">В этой версии сервер сохраняет партии и попытки в локальном файле SQLite, а браузер хранит случайный ключ гостевого профиля и выбранную тему. Имя, почта, рекламный идентификатор и сторонняя аналитика не собираются.</p></section>`;
}

function renderAdmin() {
  const token=sessionStorage.getItem('hrono:admin-token')||'';
  const example=JSON.stringify({id:'sample-event-2001',year:2001,era:'CE',exactDate:'2001-09-11',title:'Краткое название события',question:'В каком году произошло событие?',explanation:'Проверяемая историческая справка.',period:'Новейшая история',category:'recent-history',difficulty:'medium',region:'Мир',keywords:['пример'],factCheckStatus:'draft',published:false,translations:[{locale:'ru',question:'В каком году произошло событие?'}],sources:[{title:'Название архива или справочника',url:'https://example.org/source'}]},null,2);
  return `<div class="page-heading"><div><div class="eyebrow">Редакторский доступ</div><h1>Управление контентом</h1><p>Импортируй проверенные записи и назначай опубликованный вопрос на определённую дату. Все административные запросы проверяются серверным токеном.</p></div></div>
    <section class="content-panel"><div class="admin-form" style="max-width:520px;margin-bottom:18px"><label class="settings-label" for="adminToken"><strong>Токен администратора</strong><small>Задаётся только в переменной ADMIN_TOKEN на сервере.</small></label><div class="filter-group"><input class="input-control" id="adminToken" type="password" autocomplete="current-password" placeholder="Вставь серверный токен" value="${esc(token)}"><button class="secondary-button" type="button" data-action="admin-connect">Проверить доступ</button></div><div class="admin-status" id="adminStatus" aria-live="polite"></div></div>
    <div id="adminPanel" class="hidden"><div class="status-row" id="adminOverview"></div><div class="toolbar"><span class="utc-label">Экспорт позволяет подготовить пакет правок и затем загрузить его повторно.</span><button class="secondary-button" type="button" data-action="export-content">Экспортировать все вопросы ${icon('download')}</button></div><div class="admin-grid"><section class="admin-card"><h2>Импорт вопросов</h2><p>Передай один объект, массив событий или объект с полем events. Импорт атомарен; опубликованными станут только записи со статусом reviewed, источником и переводом на русский язык.</p><form class="admin-form" id="importForm"><textarea class="textarea-control" id="importJson" aria-label="JSON событий">${esc(example)}</textarea><button class="primary-button" type="submit">Проверить и импортировать</button><div class="admin-status" id="importStatus" aria-live="polite"></div></form></section>
    <section class="admin-card"><h2>Назначить задание дня</h2><p>Можно выбрать только опубликованный и проверенный вопрос из базы.</p><form class="admin-form" id="scheduleForm"><input class="input-control" name="date" type="date" aria-label="Дата задания" required><select class="select-control" name="eventId" aria-label="Вопрос для назначения" required><option value="">Загрузка вопросов…</option></select><button class="secondary-button" type="submit">Сохранить назначение</button><div class="admin-status" id="scheduleStatus" aria-live="polite"></div></form></section>
    <section class="admin-card"><h2>Добавить или обновить категорию</h2><p>Новые категории появятся в навигации и подборках после перезагрузки. Сначала сохрани категорию, затем импортируй её события.</p><form class="admin-form" id="categoryForm"><textarea class="textarea-control" id="categoryJson" aria-label="JSON категорий" style="min-height:120px">${esc(JSON.stringify({id:'history-of-maps',name:'История картографии',description:'Карты, измерения и представления о мире.',icon:'⌖',sortOrder:20},null,2))}</textarea><button class="secondary-button" type="submit">Сохранить категорию</button><div class="admin-status" id="categoryStatus" aria-live="polite"></div></form></section></div></div></section>`;
}

async function startGame(date, mode) {
  const message=document.getElementById('gameMessage');
  const button=document.querySelector('[data-action="start-game"]');
  if(button) button.disabled=true;
  if(message) { message.className='game-message'; message.textContent='Открываю игровую сессию…'; }
  try {
    const session=await api('/api/sessions',{method:'POST',body:{clientKey:state.clientKey,mode,date}});
    localStorage.setItem(`hrono:session:${state.clientKey}:${mode}:${date}`,session.id);
    await render();
    setTimeout(focusActiveCell,40);
  } catch(error) { if(message){message.className='game-message error';message.textContent=error.message;} else notify(error.message); if(button)button.disabled=false; }
}

function focusActiveCell() {
  const input=document.querySelector('.tile-input:not([readonly])');
  if(input) input.focus({preventScroll:true});
}

function bindGame(session, date, mode) {
  const form=document.getElementById('guessForm');
  document.querySelector('[data-action="hard-mode"]')?.addEventListener('change',event=>{state.hardMode=event.target.checked;localStorage.setItem('hrono:hard-mode',String(state.hardMode));render();});
  if (form) {
    const inputs=[...form.closest('.game-panel').querySelectorAll('.tile-input')];
    const submitButton=document.querySelector('[data-action="submit-guess"]');
    const syncSubmit=()=> { if(submitButton)submitButton.disabled=inputs.some(input=>!/^\d$/.test(input.value)); };
    inputs.forEach((input,index)=>{
      input.addEventListener('input',()=>{
        if(input.readOnly)return;
        const cleaned=input.value.replace(/\D/g,'').slice(-1);
        input.value=cleaned;
        input.classList.add('pop');
        setTimeout(()=>input.classList.remove('pop'),180);
        if(cleaned){const next=inputs.find((cell,i)=>i>index&&!cell.readOnly);if(next)next.focus();}
        syncSubmit();
      });
      input.addEventListener('keydown',event=>{
        if(event.key==='Backspace'&&!input.value&&index>0){event.preventDefault();const prev=[...inputs.slice(0,index)].reverse().find(cell=>!cell.readOnly);if(prev){prev.value='';prev.focus();syncSubmit();}}
        else if(event.key==='ArrowLeft'&&index>0){event.preventDefault();[...inputs.slice(0,index)].reverse().find(cell=>!cell.readOnly)?.focus();}
        else if(event.key==='ArrowRight'&&index<inputs.length-1){event.preventDefault();inputs.find((cell,i)=>i>index&&!cell.readOnly)?.focus();}
        else if(event.key==='Enter'){event.preventDefault();form.requestSubmit();}
      });
      input.addEventListener('paste',event=>{
        const value=(event.clipboardData||window.clipboardData).getData('text').replace(/\D/g,'').slice(0,4);
        if(value.length===4){event.preventDefault();inputs.forEach((cell,i)=>{if(!cell.readOnly)cell.value=value[i]||'';});syncSubmit();[...inputs].reverse().find(cell=>!cell.readOnly)?.focus();}
      });
    });
    syncSubmit();
    form.addEventListener('submit',event=>{event.preventDefault();submitGuess(session,inputs);});
  }
  document.querySelector('[data-action="start-game"]')?.addEventListener('click',()=>startGame(date,mode));
  document.querySelector('[data-action="clear-input"]')?.addEventListener('click',()=>{document.querySelectorAll('.tile-input:not([readonly])').forEach(input=>input.value='');focusActiveCell();document.querySelector('[data-action="submit-guess"]')?.setAttribute('disabled','');});
  if (session && ['won','lost'].includes(session.status)) bindShareActions(session);
  document.querySelector('[data-action="next-practice"]')?.addEventListener('click',()=>startPractice(state.practiceCategory));
}

async function submitGuess(session, inputs) {
  const guess=inputs.map(input=>input.value).join('');
  if(!/^\d{4}$/.test(guess)){const msg=document.getElementById('gameMessage');msg.className='game-message error';msg.textContent='Для попытки нужны все четыре цифры.';return;}
  const button=document.querySelector('[data-action="submit-guess"]');
  if(button)button.disabled=true;
  const message=document.getElementById('gameMessage');
  if(message){message.className='game-message';message.textContent='Проверяю цифры…';}
  try {
    const scrollPosition=window.scrollY;
    const result=await api(`/api/sessions/${encodeURIComponent(session.id)}/guess`,{method:'POST',body:{clientKey:state.clientKey,guess}});
    session.guesses.push({position:result.position,value:guess,feedback:result.feedback});
    session.attemptsUsed=result.position;
    session.attemptsRemaining=result.attemptsRemaining;
    session.status=result.status;
    if(result.event)session.event=result.event;
    if(session.mode==='practice')state.practice=session;
    await render();
    window.scrollTo({top:scrollPosition,behavior:'instant'});
    if(session.status==='playing')setTimeout(focusActiveCell,30);
  } catch(error) {
    if(error.session){await render();return;}
    const msg=document.getElementById('gameMessage');
    if(msg){msg.className='game-message error';msg.textContent=error.message;}
    if(button)button.disabled=false;
  }
}

function challengeNumber(session) { return String(dayNumber(session.challengeDate || state.today.date)).padStart(3,'0'); }
function resultText(session) {
  const rows=(session.guesses||[]).map(row=>row.feedback.map(status=>status==='correct'?'🟩':status==='present'?'🟨':'⬛').join('')).join('\n');
  const solved=session.status==='won'?`Решено за ${session.attemptsUsed}/6 попыток.`:'Не разгадано · 6/6.';
  const date=session.challengeDate||state.today.date;
  const url=`${state.baseUrl.replace(/\/$/,'')}/#${session.mode==='practice'?'practice':'today'}`;
  return `ХРОНО #${challengeNumber(session)}\n\n${rows}\n\n${solved}\nПопробуй угадать исторический год!\n${url}`;
}

function bindShareActions(session) {
  document.querySelector('[data-action="copy-result"]')?.addEventListener('click',async()=>{
    try { await navigator.clipboard.writeText(resultText(session)); notify('Результат скопирован.'); }
    catch { fallbackCopy(resultText(session)); }
  });
  document.querySelector('[data-action="share-result"]')?.addEventListener('click',async()=>{
    const data={title:'ХРОНО',text:resultText(session),url:`${state.baseUrl.replace(/\/$/,'')}/#today`};
    try { if(navigator.share)await navigator.share(data); else {await navigator.clipboard.writeText(resultText(session));notify('Результат скопирован.');} }
    catch(error){if(error.name!=='AbortError')notify('Не удалось открыть меню отправки.');}
  });
  document.querySelector('[data-action="download-result"]')?.addEventListener('click',()=>downloadResult(session));
}

function fallbackCopy(text) {
  const field=document.createElement('textarea'); field.value=text; field.style.position='fixed';field.style.opacity='0';document.body.append(field);field.select();
  try { document.execCommand('copy'); notify('Результат скопирован.'); } catch { notify('Скопируй результат вручную из буфера обмена.'); }
  field.remove();
}

function downloadResult(session) {
  const canvas=document.createElement('canvas'); canvas.width=960; canvas.height=1040;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#101314';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#c4f36b';ctx.font='700 28px system-ui';ctx.fillText('ХРОНО',76,103);
  ctx.fillStyle='#eef1eb';ctx.font='600 48px system-ui';ctx.fillText(`Задание #${challengeNumber(session)}`,76,180);
  ctx.fillStyle='#98a19a';ctx.font='400 25px system-ui';ctx.fillText(session.status==='won'?`Решено за ${session.attemptsUsed}/6 попыток`:'Попытки закончились',76,226);
  const size=112,gap=14,startX=115,startY=290;
  session.guesses.forEach((row,r)=>row.feedback.forEach((status,c)=>{
    const x=startX+c*(size+gap),y=startY+r*(size+gap);
    ctx.fillStyle=status==='correct'?'#578a68':status==='present'?'#c09b50':'#41494a';
    ctx.beginPath();ctx.roundRect(x,y,size,size,14);ctx.fill();
    ctx.fillStyle='#f7f8f4';ctx.font='650 51px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(row.value[c],x+size/2,y+size/2+1);
  }));
  ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.fillStyle='#eef1eb';ctx.font='600 27px system-ui';ctx.fillText('История в четырёх цифрах',76,930);
  ctx.fillStyle='#98a19a';ctx.font='400 19px system-ui';ctx.fillText('Угадай следующий исторический год',76,970);
  canvas.toBlob(blob=>{if(!blob){notify('Не удалось подготовить изображение.');return;}const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`hrono-${challengeNumber(session)}.png`;link.click();URL.revokeObjectURL(link.href);},'image/png');
}

async function startPractice(category=state.practiceCategory) {
  try {
    const practice=await api('/api/sessions',{method:'POST',body:{clientKey:state.clientKey,mode:'practice',category,difficulty:state.difficulty,exclude:[]}});
    state.practice=practice;state.practiceCategory=category;
    localStorage.setItem(`hrono:practice:${state.clientKey}`,practice.id);
    location.hash='#practice';
    if(currentRoute()==='practice') await render();
  } catch(error) { notify(error.message); }
}

function bindArchive() {
  document.querySelector('[data-action="month-prev"]')?.addEventListener('click',()=>{
    state.archiveMonth--;if(state.archiveMonth<1){state.archiveMonth=12;state.archiveYear--;}render();
  });
  document.querySelector('[data-action="month-next"]')?.addEventListener('click',()=>{
    state.archiveMonth++;if(state.archiveMonth>12){state.archiveMonth=1;state.archiveYear++;}render();
  });
  document.getElementById('archiveCategory')?.addEventListener('change',event=>{state.archiveCategory=event.target.value;render();});
  document.getElementById('archivePeriod')?.addEventListener('change',event=>{state.archivePeriod=event.target.value;render();});
  document.querySelectorAll('[data-date]').forEach(button=>button.addEventListener('click',()=>{state.selectedDate=button.dataset.date;location.hash='#today';}));
}

function bindCategories() {
  document.querySelectorAll('[data-difficulty]').forEach(button=>button.addEventListener('click',()=>{state.difficulty=button.dataset.difficulty;render();}));
  document.querySelectorAll('[data-category]').forEach(button=>button.addEventListener('click',()=>startPractice(button.dataset.category||CATEGORY_ANY)));
  document.querySelector('[data-action="start-practice"]')?.addEventListener('click',()=>startPractice(state.practiceCategory));
}

async function loadAdminOverview(token) {
  const status=document.getElementById('adminStatus');
  try {
    const data=await api('/api/admin/overview',{headers:{authorization:`Bearer ${token}`}});
    const eventData=await api('/api/admin/events',{headers:{authorization:`Bearer ${token}`}});
    sessionStorage.setItem('hrono:admin-token',token);
    document.getElementById('adminPanel')?.classList.remove('hidden');
    document.getElementById('adminOverview').innerHTML=`<span class="status-chip">Вопросы<strong>${data.events}</strong></span><span class="status-chip">Опубликовано<strong>${data.published}</strong></span><span class="status-chip">Задания в календаре<strong>${data.scheduled}</strong></span>`;
    const selector=document.querySelector('#scheduleForm select[name="eventId"]');
    if(selector) selector.innerHTML='<option value="">Выбери опубликованный вопрос…</option>'+eventData.events.map(event=>`<option value="${esc(event.id)}" ${event.published&&event.fact_check_status==='reviewed'?'':'disabled'}>${esc(event.title)} · ${event.year}${event.era==='BCE'?' до н. э.':''} · ${esc(event.category_name)}${event.published?'':' · черновик'}</option>`).join('');
    if(status){status.className='admin-status success';status.textContent='Доступ подтверждён. Токен действует только до закрытия вкладки.';}
    bindAdmin(token);
  } catch(error) {
    sessionStorage.removeItem('hrono:admin-token');
    if(status){status.className='admin-status error';status.textContent=error.message;}
  }
}

function bindAdmin(token) {
  document.querySelector('[data-action="export-content"]')?.addEventListener('click',async()=>{
    try {
      const data=await api('/api/admin/export',{headers:{authorization:`Bearer ${token}`}});
      const blob=new Blob([JSON.stringify(data.events,null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='hrono-events-export.json';link.click();URL.revokeObjectURL(link.href);notify('Экспорт контента сохранён.');
    } catch(error) { notify(error.message); }
  });
  document.getElementById('categoryForm')?.addEventListener('submit',async event=>{
    event.preventDefault();const status=document.getElementById('categoryStatus');status.className='admin-status';status.textContent='Проверяю категорию…';
    try {const data=await api('/api/admin/categories',{method:'POST',headers:{authorization:`Bearer ${token}`},body:JSON.parse(document.getElementById('categoryJson').value)});status.className='admin-status success';status.textContent=data.message;state.categories=(await api('/api/categories')).categories;}
    catch(error){status.className='admin-status error';status.textContent=error.message;}
  });
  document.getElementById('importForm')?.addEventListener('submit',async event=>{
    event.preventDefault(); const status=document.getElementById('importStatus');status.className='admin-status';status.textContent='Проверяю набор…';
    try { const data=await api('/api/admin/import',{method:'POST',headers:{authorization:`Bearer ${token}`},body:JSON.parse(document.getElementById('importJson').value)});status.className='admin-status success';status.textContent=data.message; }
    catch(error){status.className='admin-status error';status.textContent=error.message;}
  });
  document.getElementById('scheduleForm')?.addEventListener('submit',async event=>{
    event.preventDefault();const status=document.getElementById('scheduleStatus');status.className='admin-status';status.textContent='Сохраняю назначение…';
    const form=new FormData(event.currentTarget);
    try {const data=await api('/api/admin/schedule',{method:'POST',headers:{authorization:`Bearer ${token}`},body:{date:form.get('date'),eventId:form.get('eventId')}});status.className='admin-status success';status.textContent=data.message;}
    catch(error){status.className='admin-status error';status.textContent=error.message;}
  });
}

function bindAdminPage() {
  document.querySelector('[data-action="admin-connect"]')?.addEventListener('click',()=>loadAdminOverview(document.getElementById('adminToken').value));
  const token=sessionStorage.getItem('hrono:admin-token');
  if(token)loadAdminOverview(token);
}

function bindProfile() {
  document.querySelector('[data-action="clear-profile"]')?.addEventListener('click',async()=>{
    if(!confirm('Удалить историю этого гостевого профиля? Это действие нельзя отменить.'))return;
    try {
      await api('/api/profile',{method:'DELETE',body:{clientKey:state.clientKey}});
      localStorage.removeItem('hrono:guest');
      for(const key of Object.keys(localStorage)) if(key.startsWith('hrono:session:')||key.startsWith('hrono:practice:'))localStorage.removeItem(key);
      location.reload();
    } catch(error) { notify(`Не удалось удалить данные: ${error.message}`); }
  });
}

async function render() {
  state.route=currentRoute();
  pageLoading();
  try {
    const page=state.route;
    if (!state.today) state.today=await api('/api/today');
    if (!state.categories.length) state.categories=(await api('/api/categories')).categories;
    if (state.archiveYear < 2026) {state.archiveYear=2026;state.archiveMonth=1;}
    let content='', active=page;
    if(page==='today'||page==='play') { active='today';content=await renderToday(); }
    else if(page==='archive') content=await renderArchive();
    else if(page==='categories') content=await renderCategories();
    else if(page==='practice') content=await renderPractice();
    else if(page==='stats') content=await renderStats();
    else if(page==='rules') content=renderRules();
    else if(page==='profile') content=renderProfile();
    else if(page==='admin') content=renderAdmin();
    else { active='';content='<div class="not-found"><strong>404</strong><p>Такого раздела нет. Вернись к заданию дня.</p><a class="primary-button" href="#today">На главную</a></div>'; }
    root.innerHTML=shell(content,active);
    setTheme(state.theme);
    bindShell();
    if(page==='today'||page==='play') {const date=state.selectedDate||state.today.date;bindGame(state.visibleSession,date,date===state.today.date?'daily':'archive');}
    if(page==='archive')bindArchive();
    if(page==='categories'){bindCategories();}
    if(page==='practice'){bindCategories();bindGame(state.practice,state.practice?.challengeDate||state.today.date,'practice');}
    if(page==='admin')bindAdminPage();
    if(page==='profile')bindProfile();
  } catch(error) {
    root.innerHTML=shell(`<section class="not-found"><strong>…</strong><h1>Архив временно недоступен</h1><p>${esc(error.message)} Проверь, что сервер ХРОНО запущен.</p><button class="primary-button" type="button" data-action="retry">Повторить</button></section>`,state.route);
    bindShell();document.querySelector('[data-action="retry"]')?.addEventListener('click',render);
  }
}

async function init() {
  setTheme(state.theme);
  try {
    const config=await api('/api/config');
    state.baseUrl=config.baseUrl||window.location.origin;
    state.today=await api('/api/today');
    state.archiveYear=Number(state.today.date.slice(0,4));state.archiveMonth=Number(state.today.date.slice(5,7));
    state.categories=(await api('/api/categories')).categories;
  } catch { /* render() shows an actionable offline state */ }
  window.addEventListener('hashchange',render);
  await render();
}

init();
