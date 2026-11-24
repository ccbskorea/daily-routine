/* 데일리 루틴 — 앱 로직 (localStorage 기반, 백엔드 없음) */
(() => {
  'use strict';

  const STORE = 'dailyRoutine.v2';
  const LEGACY = 'dailyRoutine.v1';
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const GROUPS = [
    { id: 'morning', label: '모닝', emoji: '☀️' },
    { id: 'day', label: '데이', emoji: '🌤' },
    { id: 'night', label: '나이트', emoji: '🌙' }
  ];
  const DEFAULT_ROUTINES = [
    ['💧', '아침 공복 미지근한 물 한 잔', 'morning'],
    ['🧘‍♀️', '스트레칭 15분', 'morning'],
    ['💊', '영양제 챙겨 먹기', 'morning'],
    ['🏃‍♀️', '러닝 뛰기', 'day'],
    ['✨', '화이트랩스(치아미백) 이용 체크', 'night']
  ];
  const EMOJIS = [
    '💧', '🧘‍♀️', '💊', '✨', '🏃‍♀️', '📚', '🏋️‍♀️', '🥗',
    '☀️', '🌙', '🛏️', '🚶‍♀️', '✍️', '🎧', '🧴', '🦷',
    '💻', '🎯', '💌', '🚭', '☕', '🍵', '🐶', '💸',
    '🧹', '🎨', '🎹', '🌱', '⏰', '🥛', '🍎', '📝'
  ];

  const $ = (id) => document.getElementById(id);

  /* ---------- 날짜 · 숫자 유틸 ---------- */

  const pad = (n) => String(n).padStart(2, '0');
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayKey = () => keyOf(new Date());
  const parseKey = (k) => {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const dayDiff = (a, b) => Math.round((b - a) / 86400000);
  const fmtMD = (k) => {
    const d = parseKey(k);
    return `${d.getMonth() + 1}.${pad(d.getDate())}`;
  };
  const fmtKo = (k) => {
    const d = parseKey(k);
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  };
  const fmtKoWD = (k) => {
    const d = parseKey(k);
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
  };

  function toMin(hm) {
    if (!hm || typeof hm !== 'string') return null;
    const [h, m] = hm.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
  }
  function sleepMin(rec) {
    if (!rec) return null;
    const b = toMin(rec.bed);
    const w = toMin(rec.wake);
    if (b == null || w == null || b === w) return null;
    let d = w - b;
    if (d < 0) d += 1440;
    return d;
  }
  function durStr(min) {
    if (min == null) return '—';
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h && m) return `${h}시간 ${m}분`;
    if (h) return `${h}시간`;
    return `${m}분`;
  }
  function paceStr(sec) {
    if (sec == null || isNaN(sec)) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}'${pad(s)}"`;
  }
  function kmStr(km) {
    if (km == null || isNaN(km)) return '—';
    return Number(km).toFixed(1).replace(/\.0$/, '');
  }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* ---------- 저장소 ---------- */

  let state = loadState();
  let viewYear, viewMonth;
  let selectedDay = todayKey();
  let editingId = null;
  let editingLensId = null;
  let pickedEmoji = EMOJIS[0];
  let pickedGroup = 'morning';
  let confirmAction = null;
  let toastTimer = null;
  let readTimer = null;
  let quoteTimer = null;
  let lastChecked = null;

  function blankState() {
    return {
      version: 2,
      routines: [],
      records: {},
      sleep: {},
      runs: {},
      reading: {},
      quotes: {},
      lenses: []
    };
  }

  function migrateLegacy(raw) {
    const s = blankState();
    try {
      const old = JSON.parse(raw);
      if (!old || !Array.isArray(old.routines)) return null;
      s.records = old.records && typeof old.records === 'object' ? old.records : {};
      s.routines = old.routines.map((r, i) => ({
        id: r.id || uid(),
        emoji: r.emoji || '✅',
        name: String(r.name || '루틴'),
        group: r.group || guessGroup(r.name || ''),
        createdAt: r.createdAt || todayKey(),
        deletedAt: r.deletedAt || null,
        order: typeof r.order === 'number' ? r.order : i
      }));
      return s;
    } catch (e) {
      return null;
    }
  }

  function guessGroup(name) {
    if (/물|스트레칭|영양제|아침|모닝/.test(name)) return 'morning';
    if (/화이트랩스|미백|나이트|잠|취침/.test(name)) return 'night';
    return 'day';
  }

  function loadState() {
    let raw = null;
    try { raw = localStorage.getItem(STORE); } catch (e) { raw = null; }

    if (raw) {
      try {
        const p = JSON.parse(raw);
        if (p && Array.isArray(p.routines)) {
          const s = blankState();
          s.routines = p.routines.map((r, i) => ({
            id: r.id || uid(),
            emoji: r.emoji || '✅',
            name: String(r.name || '루틴'),
            group: r.group || guessGroup(r.name || ''),
            createdAt: r.createdAt || todayKey(),
            deletedAt: r.deletedAt || null,
            order: typeof r.order === 'number' ? r.order : i
          }));
          s.records = p.records && typeof p.records === 'object' ? p.records : {};
          s.sleep = p.sleep && typeof p.sleep === 'object' ? p.sleep : {};
          s.runs = p.runs && typeof p.runs === 'object' ? p.runs : {};
          s.reading = p.reading && typeof p.reading === 'object' ? p.reading : {};
          s.quotes = p.quotes && typeof p.quotes === 'object' ? p.quotes : {};
          s.lenses = Array.isArray(p.lenses) ? p.lenses : [];
          return s;
        }
      } catch (e) { /* 손상된 데이터는 아래에서 새로 시작 */ }
    }

    try {
      const legacy = localStorage.getItem(LEGACY);
      if (legacy) {
        const migrated = migrateLegacy(legacy);
        if (migrated) { saveState(migrated); return migrated; }
      }
    } catch (e) { /* 무시 */ }

    const t = todayKey();
    const fresh = blankState();
    fresh.routines = DEFAULT_ROUTINES.map((r, i) => ({
      id: uid(),
      emoji: r[0],
      name: r[1],
      group: r[2],
      createdAt: t,
      deletedAt: null,
      order: i
    }));
    saveState(fresh);
    return fresh;
  }

  function saveState(s = state) {
    try { localStorage.setItem(STORE, JSON.stringify(s)); } catch (e) { /* 저장 실패는 조용히 무시 */ }
  }

  /* ---------- 루틴 계산 ---------- */

  function routinesOn(dateStr) {
    return state.routines
      .filter((r) => r.createdAt <= dateStr && (!r.deletedAt || r.deletedAt > dateStr))
      .sort((a, b) => a.order - b.order);
  }

  function dayStats(dateStr) {
    const list = routinesOn(dateStr);
    const rec = state.records[dateStr] || {};
    const done = list.filter((r) => rec[r.id]).length;
    const total = list.length;
    return { list, rec, total, done, rate: total ? Math.round((done / total) * 100) : 0, full: total > 0 && done === total };
  }

  function currentStreak() {
    const today = parseKey(todayKey());
    let cursor = today;
    if (!dayStats(todayKey()).full) cursor = addDays(today, -1);
    let streak = 0;
    for (let i = 0; i < 3650; i++) {
      if (dayStats(keyOf(cursor)).full) { streak++; cursor = addDays(cursor, -1); } else break;
    }
    return streak;
  }

  function bestStreak() {
    if (!state.routines.length) return 0;
    const start = parseKey(state.routines.map((r) => r.createdAt).sort()[0]);
    const end = parseKey(todayKey());
    let best = 0, run = 0;
    for (let d = start; d <= end; d = addDays(d, 1)) {
      if (dayStats(keyOf(d)).full) { run++; if (run > best) best = run; } else run = 0;
    }
    return best;
  }

  function monthCompleteCount(y, m) {
    const last = new Date(y, m + 1, 0).getDate();
    const tk = todayKey();
    let n = 0;
    for (let d = 1; d <= last; d++) {
      const k = `${y}-${pad(m + 1)}-${pad(d)}`;
      if (k > tk) break;
      if (dayStats(k).full) n++;
    }
    return n;
  }

  /* ---------- 토스트 · 공통 ---------- */

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => { t.hidden = true; }, 260);
    }, 1700);
  }

  function flash(id, msg) {
    const node = $(id);
    if (!node) return;
    node.textContent = msg || '저장됐어요';
    node.classList.add('saved');
    setTimeout(() => { if (node) node.classList.remove('saved'); }, 1400);
  }

  function checkIcon() {
    return '<span class="check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.8l4.4 4.4L19 7.4"/></svg></span>';
  }

  /* ---------- 헤더 ---------- */

  function greet() {
    const h = new Date().getHours();
    if (h >= 5 && h < 11) return '좋은 아침이에요, 유정 님 ☀️';
    if (h >= 11 && h < 14) return '즐거운 점심이에요, 유정 님 🍚';
    if (h >= 14 && h < 18) return '좋은 오후예요, 유정 님 🌤';
    if (h >= 18 && h < 23) return '좋은 저녁이에요, 유정 님 🌙';
    return '늦은 밤에도 반가워요, 유정 님 ✨';
  }

  function renderHeader() {
    const now = new Date();
    $('todayLabel').textContent = `${now.getMonth() + 1}월 ${now.getDate()}일 ${WEEKDAYS[now.getDay()]}요일`;
    $('greeting').textContent = greet();
  }

  /* ---------- 오늘: 요약 ---------- */

  function renderSummary() {
    const s = dayStats(todayKey());
    $('rateNum').textContent = s.rate;
    $('streakNum').textContent = currentStreak();
    $('barFill').style.width = `${s.rate}%`;
    $('bar').setAttribute('aria-valuenow', String(s.rate));
    $('summaryCard').classList.toggle('done', s.full);

    let sub;
    if (!s.total) sub = '루틴을 추가하고 하루를 시작해 보세요';
    else if (s.full) sub = '오늘 루틴 모두 완료! 정말 잘했어요 🎉';
    else if (s.done === 0) sub = `${s.total}개 중 0개 완료 · 첫 체크를 해볼까요?`;
    else sub = `${s.total}개 중 ${s.done}개 완료 · ${s.total - s.done}개만 더!`;
    $('summarySub').textContent = sub;
  }

  /* ---------- 오늘: 루틴 목록 ---------- */

  function routineButton(r, done, justId, onToggle) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `routine${done ? ' done' : ''}${r.id === justId && done ? ' just-checked' : ''}`;
    btn.dataset.id = r.id;
    btn.setAttribute('aria-pressed', done ? 'true' : 'false');
    btn.setAttribute('aria-label', `${r.name} ${done ? '완료 취소' : '완료 체크'}`);
    btn.innerHTML = `<span class="routine-emoji" aria-hidden="true">${r.emoji}</span><span class="routine-name">${escapeHtml(r.name)}</span>${checkIcon()}`;
    btn.addEventListener('click', onToggle);
    return btn;
  }

  function renderToday() {
    const s = dayStats(todayKey());
    const wrap = $('routineGroups');
    wrap.innerHTML = '';
    $('listCount').textContent = `${s.done} / ${s.total}`;

    if (!s.list.length) {
      wrap.innerHTML = '<div class="empty-state"><b>아직 루틴이 없어요</b>아래 버튼으로 첫 루틴을 추가해 보세요</div>';
    } else {
      const known = GROUPS.map((g) => g.id);
      GROUPS.forEach((g) => {
        const items = s.list.filter((r) => r.group === g.id);
        if (!items.length) return;
        const label = document.createElement('p');
        label.className = 'group-label';
        label.textContent = `${g.emoji} ${g.label}`;
        wrap.appendChild(label);
        const ul = document.createElement('ul');
        ul.className = 'routine-list';
        items.forEach((r) => {
          const li = document.createElement('li');
          li.appendChild(routineButton(r, !!s.rec[r.id], lastChecked, () => toggle(todayKey(), r.id)));
          ul.appendChild(li);
        });
        wrap.appendChild(ul);
      });
      const rest = s.list.filter((r) => !known.includes(r.group));
      if (rest.length) {
        const label = document.createElement('p');
        label.className = 'group-label';
        label.textContent = '📌 기타';
        wrap.appendChild(label);
        const ul = document.createElement('ul');
        ul.className = 'routine-list';
        rest.forEach((r) => {
          const li = document.createElement('li');
          li.appendChild(routineButton(r, !!s.rec[r.id], lastChecked, () => toggle(todayKey(), r.id)));
          ul.appendChild(li);
        });
        wrap.appendChild(ul);
      }
    }
    renderTiles();
  }

  function renderTiles() {
    const t = todayKey();
    const sl = sleepMin(state.sleep[t]);
    const run = state.runs[t];
    const rd = state.reading[t];
    const q = state.quotes[t];

    const tiles = [
      { tab: 'run', label: '😴 수면', value: sl != null ? durStr(sl) : '기록 전', on: sl != null },
      { tab: 'run', label: '🏃 러닝', value: run ? `${kmStr(run.km)}km${run.pace ? ` · ${paceStr(run.pace)}` : ''}` : '기록 전', on: !!run },
      { tab: 'log', label: '📖 독서', value: rd && (rd.amount || rd.book) ? (rd.amount || '제목 기록') : '기록 전', on: !!(rd && (rd.amount || rd.book || rd.memo)) },
      { tab: 'log', label: '✍️ 필사', value: q && q.text ? '1문장 기록' : '기록 전', on: !!(q && q.text) }
    ];

    const grid = $('statusTiles');
    grid.innerHTML = '';
    tiles.forEach((x) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `tile ${x.on ? 'filled' : 'empty'}`;
      b.innerHTML = `<span class="tile-label">${x.label}</span><span class="tile-value">${escapeHtml(x.value)}</span>`;
      b.addEventListener('click', () => switchTab(x.tab));
      grid.appendChild(b);
    });
  }

  function toggle(dateStr, routineId) {
    if (dateStr > todayKey()) return;
    const rec = state.records[dateStr] || (state.records[dateStr] = {});
    if (rec[routineId]) delete rec[routineId];
    else rec[routineId] = true;
    if (!Object.keys(rec).length) delete state.records[dateStr];
    saveState();

    lastChecked = dateStr === todayKey() ? routineId : null;
    renderToday();
    renderSummary();
    renderCalendar();
    renderStats();
    lastChecked = null;
    if (!$('dayOverlay').hidden) renderDaySheet();
  }

  /* ---------- 러닝·수면 ---------- */

  function runEntries() {
    return Object.keys(state.runs)
      .filter((k) => state.runs[k] && typeof state.runs[k].km === 'number')
      .sort()
      .map((k) => ({ date: k, ...state.runs[k] }));
  }

  function renderRun() {
    const t = todayKey();
    const rec = state.sleep[t] || { bed: '', wake: '' };
    $('bedInput').value = rec.bed || '';
    $('wakeInput').value = rec.wake || '';
    updateSleepResult();
    renderSleepBars();

    const run = state.runs[t];
    $('runDist').value = run && run.km ? String(run.km) : '';
    $('paceMin').value = run && run.pace != null ? String(Math.floor(run.pace / 60)) : '';
    $('paceSec').value = run && run.pace != null ? String(run.pace % 60) : '';
    $('runTodayLabel').textContent = run ? '오늘 기록됨' : '오늘';
    $('runSave').textContent = run ? '오늘 러닝 수정 저장' : '러닝 저장';

    renderChart();
    renderRunList();
  }

  function updateSleepResult() {
    const bed = readTimeStr($('bedInput'));
    const wake = readTimeStr($('wakeInput'));
    const min = sleepMin({ bed, wake });
    const durEl = $('sleepDur');
    const subEl = $('sleepSub');
    if (min == null) {
      durEl.textContent = '—';
      subEl.textContent = '시간을 넣으면 총 수면 시간이 계산돼요';
      return;
    }
    durEl.textContent = durStr(min);
    if (min > 960) {
      subEl.textContent = '15시간이 넘어요 · 시간을 한 번 확인해 주세요';
    } else if (min < 240) {
      subEl.textContent = '조금 짧아요 · 오늘은 일찍 쉬어 볼까요';
    } else if (min >= 420 && min <= 540) {
      subEl.textContent = '딱 좋은 수면 시간이에요 👍';
    } else {
      subEl.textContent = `${bed} → ${wake} · ${durStr(min)} 잤어요`;
    }
    // 7일 평균
    let sum = 0, n = 0;
    for (let i = 0; i < 7; i++) {
      const k = keyOf(addDays(parseKey(todayKey()), -i));
      const m = sleepMin(state.sleep[k]);
      if (m != null) { sum += m; n++; }
    }
    $('sleepAvg').textContent = n ? `7일 평균 ${durStr(Math.round(sum / n))}` : '7일 평균 —';
  }

  function renderSleepBars() {
    const wrap = $('sleepBars');
    wrap.innerHTML = '';
    const base = parseKey(todayKey());
    const vals = [];
    for (let i = 6; i >= 0; i--) {
      const k = keyOf(addDays(base, -i));
      vals.push({ k, min: sleepMin(state.sleep[k]) });
    }
    const maxV = Math.max(540, ...vals.map((v) => v.min || 0));
    vals.forEach((v) => {
      const col = document.createElement('div');
      col.className = `sleep-bar${v.min != null ? ' on' : ''}`;
      const h = v.min != null ? Math.max(8, Math.round((v.min / maxV) * 40)) : 3;
      col.innerHTML = `<i style="height:${h}px"></i><span>${WEEKDAYS[parseKey(v.k).getDay()]}</span>`;
      col.title = v.min != null ? `${fmtKo(v.k)} ${durStr(v.min)}` : `${fmtKo(v.k)} 기록 없음`;
      wrap.appendChild(col);
    });
  }

  function saveSleep() {
    const t = todayKey();
    const bed = readTimeStr($('bedInput'));
    const wake = readTimeStr($('wakeInput'));
    if (!bed && !wake) delete state.sleep[t];
    else state.sleep[t] = { bed, wake };
    saveState();
    updateSleepResult();
    renderSleepBars();
    renderTiles();
  }

  // 입력된 숫자에서 완성된 HH:MM만 꺼낸다 (미완성이면 '')
  function readTimeStr(el) {
    const d = (el.value || '').replace(/\D/g, '');
    if (d.length !== 4) return '';
    const h = Math.min(23, parseInt(d.slice(0, 2), 10) || 0);
    const m = Math.min(59, parseInt(d.slice(2, 4), 10) || 0);
    return `${pad(h)}:${pad(m)}`;
  }

  // "2330" → "23:30", "233" → "23:3"(입력 중) → blur 시 "23:30", "7" → "07:00"
  function normalizeTime(el, onBlur) {
    let d = (el.value || '').replace(/\D/g, '').slice(0, 4);
    if (!d) {
      el.value = '';
      return '';
    }
    if (!onBlur) {
      el.value = d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
      return readTimeStr(el);
    }
    if (d.length <= 2) d = `${d.padStart(2, '0')}00`;
    else if (d.length === 3) d = `${d}0`;
    const h = Math.min(23, parseInt(d.slice(0, 2), 10) || 0);
    const m = Math.min(59, parseInt(d.slice(2, 4), 10) || 0);
    el.value = `${pad(h)}:${pad(m)}`;
    return el.value;
  }

  function renderChart() {
    const entries = runEntries().filter((e) => e.pace != null);
    const wrap = $('chartWrap');
    const deltaEl = $('paceDelta');
    const bestEl = $('bestRow');

    if (!entries.length) {
      wrap.innerHTML = '<p class="chart-empty">러닝을 기록하면 여기에 페이스 추이가 그려져요</p>';
      deltaEl.textContent = '—';
      deltaEl.className = 'chip-accent';
      bestEl.innerHTML = '';
      return;
    }

    if (entries.length === 1) {
      const e = entries[0];
      wrap.innerHTML = `<div class="chart-single"><span class="cs-pace">${paceStr(e.pace)}</span><span class="cs-sub">첫 러닝 기록 · ${fmtKo(e.date)} · 1km당</span></div>`;
    } else {
      const recent = entries.slice(-10);
    const paces = recent.map((e) => e.pace);
    const lo = Math.min(...paces);
    const hi = Math.max(...paces);
    const span = Math.max(hi - lo, 8);
    const W = 320, H = 140, PL = 18, PR = 16, PT = 18, PB = 24;
    const n = recent.length;
    const xs = (i) => (n === 1 ? W / 2 : PL + (i * (W - PL - PR)) / (n - 1));
    const ys = (p) => PT + ((p - lo) / span) * (H - PT - PB);

    let line = '';
    let dots = '';
    recent.forEach((e, i) => {
      const x = xs(i);
      const y = ys(e.pace);
      line += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)} `;
      const isLast = i === n - 1;
      dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${isLast ? 5 : 3.6}" fill="${isLast ? '#6C63FF' : '#fff'}" stroke="#6C63FF" stroke-width="2"/>`;
    });

    const area = n > 1
      ? `${line}L${xs(n - 1).toFixed(1)} ${H - PB} L${xs(0).toFixed(1)} ${H - PB} Z`
      : '';

    wrap.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="최근 러닝 페이스 추이">
        <defs>
          <linearGradient id="paceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#6C63FF" stop-opacity=".22"/>
            <stop offset="1" stop-color="#6C63FF" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <line x1="${PL}" y1="${PT}" x2="${W - PR}" y2="${PT}" stroke="#EFEDF8" stroke-width="1" stroke-dasharray="3 4"/>
        <line x1="${PL}" y1="${H - PB}" x2="${W - PR}" y2="${H - PB}" stroke="#EFEDF8" stroke-width="1" stroke-dasharray="3 4"/>
        ${area ? `<path d="${area}" fill="url(#paceFill)"/>` : ''}
        ${line ? `<path d="${line.trim()}" fill="none" stroke="#6C63FF" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
        ${dots}
        <text x="${PL}" y="${PT - 5}" font-size="9" fill="#A5A2B6" font-family="-apple-system, sans-serif">빠름 ${paceStr(lo)}</text>
        <text x="${PL}" y="${H - PB + 13}" font-size="9" fill="#A5A2B6" font-family="-apple-system, sans-serif">느림 ${paceStr(hi)}</text>
      </svg>
      <div class="chart-caption"><span>${fmtMD(recent[0].date)}</span><span>최근 ${n}회</span><span>${fmtMD(recent[n - 1].date)}</span></div>`;
    }

    // 이전 기록 대비
    let deltaText = '기록 1회';
    let deltaCls = 'chip-accent';
    if (entries.length >= 2) {
      const cur = entries[entries.length - 1];
      const prev = entries[entries.length - 2];
      const d = cur.pace - prev.pace;
      if (d < 0) { deltaText = `지난보다 ${Math.abs(d)}초 빨라짐 ⚡`; deltaCls = 'chip-accent good'; }
      else if (d > 0) { deltaText = `지난보다 ${d}초 느려짐`; deltaCls = 'chip-accent bad'; }
      else { deltaText = '지난 기록과 동일'; }
    }
    deltaEl.textContent = deltaText;
    deltaEl.className = deltaCls;

    const allPaces = entries.map((e) => e.pace);
    const best = Math.min(...allPaces);
    const avg = Math.round(allPaces.reduce((a, b) => a + b, 0) / allPaces.length);
    const bestEntry = entries.find((e) => e.pace === best);
    bestEl.innerHTML = `
      <span class="best-pill">최고 페이스 <b>${paceStr(best)}</b> · ${fmtMD(bestEntry.date)}</span>
      <span class="best-pill">평균 <b>${paceStr(avg)}</b></span>`;
  }

  function renderRunList() {
    const entries = runEntries().slice().reverse().slice(0, 10);
    const ul = $('runList');
    $('runCount').textContent = `${runEntries().length}회`;
    ul.innerHTML = '';
    if (!entries.length) {
      ul.innerHTML = '<li class="rec-empty">아직 러닝 기록이 없어요</li>';
      return;
    }
    entries.forEach((e) => {
      const li = document.createElement('li');
      li.className = 'rec-item';
      li.innerHTML = `
        <div class="rec-main">
          <div class="rec-top">
            <span class="rec-name">${kmStr(e.km)}km</span>
            <span class="rec-date">${e.date === todayKey() ? '오늘' : fmtKoWD(e.date)}</span>
          </div>
          <div class="rec-sub">${e.pace != null ? `페이스 ${paceStr(e.pace)} · 1km당` : '페이스 미입력'}</div>
        </div>
        <span class="rec-num">${e.pace != null ? paceStr(e.pace) : '—'}</span>
        <button class="rec-del" type="button" aria-label="삭제">✕</button>`;
      li.querySelector('.rec-del').addEventListener('click', () => {
        askConfirm(`${fmtKo(e.date)} 러닝 기록을 삭제할까요?`, '삭제', () => {
          delete state.runs[e.date];
          saveState();
          renderRun();
          renderTiles();
          toast('삭제했어요');
        });
      });
      ul.appendChild(li);
    });
  }

  function saveRun() {
    const t = todayKey();
    const km = parseFloat($('runDist').value);
    if (!km || km <= 0) {
      toast('거리를 입력해 주세요');
      $('runDist').focus();
      return;
    }
    const pm = $('paceMin').value === '' ? null : parseInt($('paceMin').value, 10);
    const ps = $('paceSec').value === '' ? 0 : parseInt($('paceSec').value, 10);
    let pace = null;
    if (pm != null && !isNaN(pm)) pace = pm * 60 + (isNaN(ps) ? 0 : Math.min(59, ps));
    if (pace != null && pace <= 0) pace = null;

    state.runs[t] = { km: Math.round(km * 100) / 100, pace, at: new Date().toISOString() };

    // 오늘 '러닝' 루틴 자동 체크
    const runRoutine = routinesOn(t).find((r) => /러닝|달리기|run/i.test(r.name));
    if (runRoutine) {
      const rec = state.records[t] || (state.records[t] = {});
      rec[runRoutine.id] = true;
    }
    saveState();
    renderRun();
    renderToday();
    renderSummary();
    renderCalendar();
    renderStats();
    $('runStatus').textContent = '저장됐어요 · 오늘 루틴의 러닝도 체크했어요';
    toast('러닝 기록 저장했어요');
  }

  /* ---------- 기록: 독서 · 필사 ---------- */

  function renderLog() {
    const t = todayKey();
    const rd = state.reading[t] || {};
    $('bookInput').value = rd.book || '';
    $('readAmount').value = rd.amount || '';
    $('readMemo').value = rd.memo || '';
    const q = state.quotes[t] || {};
    $('quoteInput').value = q.text || '';
    $('quoteSource').value = q.source || '';
    renderBookList();
    renderReadingList();
    renderQuoteList();
  }

  function renderBookList() {
    const titles = [...new Set(Object.values(state.reading).map((r) => r && r.book).filter(Boolean))].slice(0, 4);
    const box = $('bookChips');
    if (!box) return;
    box.innerHTML = '';
    if (!titles.length) return;
    titles.forEach((title) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'book-chip';
      b.textContent = title;
      b.addEventListener('click', () => {
        $('bookInput').value = title;
        saveReading();
        toast('책 제목을 채웠어요');
      });
      box.appendChild(b);
    });
  }

  function saveReading() {
    const t = todayKey();
    const book = $('bookInput').value.trim();
    const amount = $('readAmount').value.trim();
    const memo = $('readMemo').value.trim();
    if (!book && !amount && !memo) delete state.reading[t];
    else state.reading[t] = { book, amount, memo };
    saveState();
    flash('readStatus');
    renderBookList();
    renderReadingList();
    renderTiles();
  }

  function renderReadingList() {
    const keys = Object.keys(state.reading).filter((k) => {
      const r = state.reading[k];
      return r && (r.book || r.amount || r.memo);
    }).sort().reverse();
    $('readCount').textContent = `${keys.length}일`;
    const ul = $('readList');
    ul.innerHTML = '';
    if (!keys.length) {
      ul.innerHTML = '<li class="rec-empty">독서 기록이 쌓이면 여기에서 모아 볼 수 있어요</li>';
      return;
    }
    keys.slice(0, 20).forEach((k) => {
      const r = state.reading[k];
      const li = document.createElement('li');
      li.className = 'rec-item';
      const sub = [r.amount ? r.amount : '', r.memo ? r.memo : ''].filter(Boolean).join(' · ');
      li.innerHTML = `
        <div class="rec-main">
          <div class="rec-top">
            <span class="rec-name">${escapeHtml(r.book || '제목 미기록')}</span>
            <span class="rec-date">${k === todayKey() ? '오늘' : fmtKo(k)}</span>
          </div>
          <div class="rec-sub">${escapeHtml(sub || '메모 없음')}</div>
        </div>
        <button class="rec-del" type="button" aria-label="삭제">✕</button>`;
      li.querySelector('.rec-del').addEventListener('click', () => {
        askConfirm(`${fmtKo(k)} 독서 기록을 삭제할까요?`, '삭제', () => {
          delete state.reading[k];
          saveState();
          renderLog();
          renderTiles();
          toast('삭제했어요');
        });
      });
      ul.appendChild(li);
    });
  }

  function saveQuote() {
    const t = todayKey();
    const text = $('quoteInput').value.trim();
    const source = $('quoteSource').value.trim();
    if (!text) delete state.quotes[t];
    else state.quotes[t] = { text, source };
    saveState();
    flash('quoteStatus');
    renderQuoteList();
    renderTiles();
  }

  function renderQuoteList() {
    const keys = Object.keys(state.quotes).filter((k) => state.quotes[k] && state.quotes[k].text).sort().reverse();
    $('quoteCount').textContent = `${keys.length}문장`;
    const ul = $('quoteList');
    ul.innerHTML = '';
    if (!keys.length) {
      ul.innerHTML = '<li class="rec-empty">오늘의 한 문장이 모이면 여기에 쌓여요</li>';
      return;
    }
    keys.forEach((k) => {
      const q = state.quotes[k];
      const li = document.createElement('li');
      li.className = 'quote-card';
      li.innerHTML = `
        <p class="quote-text">${escapeHtml(q.text)}</p>
        <p class="quote-meta">${k === todayKey() ? '오늘' : fmtKo(k)}${q.source ? ` · ${escapeHtml(q.source)}` : ''}</p>
        <button class="rec-del" type="button" aria-label="삭제">✕</button>`;
      li.querySelector('.rec-del').addEventListener('click', () => {
        askConfirm(`${fmtKo(k)} 필사를 삭제할까요?`, '삭제', () => {
          delete state.quotes[k];
          saveState();
          renderLog();
          renderTiles();
          toast('삭제했어요');
        });
      });
      ul.appendChild(li);
    });
  }

  /* ---------- 달력 ---------- */

  function renderCalendar() {
    const y = viewYear, m = viewMonth;
    $('calTitle').textContent = `${y}년 ${m + 1}월`;
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const lead = first.getDay();
    const totalCells = Math.ceil((lead + last.getDate()) / 7) * 7;
    const grid = $('calGrid');
    const tk = todayKey();
    grid.innerHTML = '';

    for (let i = 0; i < totalCells; i++) {
      const dayNum = i - lead + 1;
      if (dayNum < 1 || dayNum > last.getDate()) {
        const blank = document.createElement('span');
        blank.className = 'day blank';
        grid.appendChild(blank);
        continue;
      }
      const dateStr = `${y}-${pad(m + 1)}-${pad(dayNum)}`;
      const isFuture = dateStr > tk;
      const st = dayStats(dateStr);
      const cls = ['day'];
      if (!isFuture) {
        if (st.total > 0 && st.full) cls.push('full');
        else if (st.total > 0 && st.done > 0) cls.push('part');
        else if (st.total > 0) cls.push('zero');
      }
      if (dateStr === tk) cls.push('today');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = cls.join(' ');
      btn.dataset.date = dateStr;
      btn.setAttribute('aria-label', isFuture
        ? `${m + 1}월 ${dayNum}일 (예정)`
        : `${m + 1}월 ${dayNum}일 ${st.total ? `달성률 ${st.rate}퍼센트` : '기록 없음'}`);
      btn.innerHTML = `<span class="num">${dayNum}</span>${!isFuture && st.total > 0 && st.done > 0 && !st.full ? '<i class="dot"></i>' : ''}`;
      btn.addEventListener('click', () => openDay(dateStr));
      grid.appendChild(btn);
    }
  }

  function renderStats() {
    const now = new Date();
    $('statMonth').textContent = monthCompleteCount(now.getFullYear(), now.getMonth());
    $('statBest').textContent = bestStreak();
    $('statTotal').textContent = routinesOn(todayKey()).length;
    renderLenses();
  }

  /* ---------- 렌즈 트래커 ---------- */

  function lensInfo(l) {
    const opened = parseKey(l.openedAt);
    const today = parseKey(todayKey());
    const n = Math.max(0, dayDiff(opened, today));
    const cycle = Number(l.cycle) > 0 ? Number(l.cycle) : 30;
    const replaceDate = addDays(opened, cycle);
    const remain = cycle - n;
    return { n, cycle, replaceDate, remain };
  }

  function renderLenses() {
    const active = state.lenses.filter((l) => !l.replacedAt);
    const box = $('lensActive');
    box.innerHTML = '';

    if (!active.length) {
      box.innerHTML = '<div class="empty-state"><b>등록된 렌즈가 없어요</b>개봉일을 등록하면 교체 시기를 알려드려요</div>';
    } else {
      active.sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1)).forEach((l) => {
        const info = lensInfo(l);
        const card = document.createElement('div');
        card.className = `lens-card${info.remain < 0 ? ' over' : info.remain <= 3 ? ' warn' : ''}`;

        let statusText;
        if (info.remain > 3) statusText = `<b>${info.remain}일</b> 남았어요`;
        else if (info.remain > 0) statusText = `<b>곧 교체할 때예요</b> · ${info.remain}일 남음`;
        else if (info.remain === 0) statusText = '<b>오늘 교체하는 날이에요</b>';
        else statusText = `<b>교체 시기가 ${Math.abs(info.remain)}일 지났어요</b>`;

        const pct = Math.min(100, Math.round((info.n / info.cycle) * 100));
        card.innerHTML = `
          <div class="lens-top">
            <div>
              <p class="lens-name">${escapeHtml(l.name || '렌즈')}</p>
              <p class="lens-meta">${l.power ? `도수 ${escapeHtml(l.power)} · ` : ''}${info.cycle}일 주기${l.note ? ` · ${escapeHtml(l.note)}` : ''}</p>
            </div>
            <span class="lens-dday">D+${info.n}</span>
          </div>
          <div class="bar small" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div class="bar-fill" style="width:${pct}%"></div></div>
          <p class="lens-note">개봉 ${fmtKo(l.openedAt)} · 교체 예정 <b>${fmtKo(keyOf(info.replaceDate))}</b> · ${statusText}</p>
          <div class="lens-actions">
            <button class="btn ghost sm" type="button" data-act="replace">교체했어요</button>
            <button class="btn ghost sm" type="button" data-act="edit">수정</button>
            <button class="rec-del" type="button" data-act="delete" aria-label="삭제">✕</button>
          </div>`;

        card.querySelector('[data-act="replace"]').addEventListener('click', () => {
          askConfirm(`‘${l.name}’을 교체 처리할까요? 같은 제품이 오늘 개봉으로 새로 등록돼요.`, '교체', () => {
            const target = state.lenses.find((x) => x.id === l.id);
            if (target) target.replacedAt = todayKey();
            state.lenses.push({
              id: uid(),
              name: l.name,
              power: l.power || '',
              cycle: info.cycle,
              note: l.note || '',
              openedAt: todayKey(),
              replacedAt: null
            });
            saveState();
            renderLenses();
            toast('새 렌즈로 교체했어요');
          });
        });
        card.querySelector('[data-act="edit"]').addEventListener('click', () => openLensEditor(l.id));
        card.querySelector('[data-act="delete"]').addEventListener('click', () => {
          askConfirm(`‘${l.name}’ 기록을 삭제할까요?`, '삭제', () => {
            state.lenses = state.lenses.filter((x) => x.id !== l.id);
            saveState();
            renderLenses();
            toast('삭제했어요');
          });
        });
        box.appendChild(card);
      });
    }

    const past = state.lenses.filter((l) => l.replacedAt).sort((a, b) => (a.replacedAt < b.replacedAt ? 1 : -1));
    const ul = $('lensHistory');
    ul.innerHTML = '';
    if (!past.length) {
      ul.innerHTML = '<li class="rec-empty">교체한 렌즈 기록이 여기에 쌓여요</li>';
    } else {
      past.slice(0, 12).forEach((l) => {
        const used = Math.max(0, dayDiff(parseKey(l.openedAt), parseKey(l.replacedAt)));
        const li = document.createElement('li');
        li.className = 'rec-item';
        li.innerHTML = `
          <div class="rec-main">
            <div class="rec-top">
              <span class="rec-name">${escapeHtml(l.name || '렌즈')}</span>
              <span class="rec-date">${fmtMD(l.openedAt)} ~ ${fmtMD(l.replacedAt)}</span>
            </div>
            <div class="rec-sub">${l.power ? `도수 ${escapeHtml(l.power)} · ` : ''}${used}일 사용</div>
          </div>`;
        ul.appendChild(li);
      });
    }
  }

  function openLensEditor(id) {
    editingLensId = id || null;
    const l = id ? state.lenses.find((x) => x.id === id) : null;
    $('lensTitle').textContent = l ? '렌즈 수정' : '새 렌즈 등록';
    $('lensName').value = l ? l.name : '';
    $('lensPower').value = l ? l.power || '' : '';
    $('lensCycle').value = l ? String(l.cycle || 30) : '30';
    $('lensOpened').value = l ? l.openedAt : todayKey();
    $('lensNote').value = l ? l.note || '' : '';
    openOverlay('lensOverlay');
  }

  function saveLens() {
    const name = $('lensName').value.trim();
    if (!name) {
      toast('제품명을 입력해 주세요');
      $('lensName').focus();
      return;
    }
    const cycle = Math.max(1, Math.min(365, parseInt($('lensCycle').value, 10) || 30));
    const opened = $('lensOpened').value || todayKey();
    const data = {
      name,
      power: $('lensPower').value.trim(),
      cycle,
      note: $('lensNote').value.trim(),
      openedAt: opened
    };
    const wasEditing = !!editingLensId;
    if (wasEditing) {
      const l = state.lenses.find((x) => x.id === editingLensId);
      if (l) Object.assign(l, data);
    } else {
      state.lenses.push({ id: uid(), replacedAt: null, ...data });
    }
    saveState();
    closeOverlay('lensOverlay');
    editingLensId = null;
    renderLenses();
    toast(wasEditing ? '수정했어요' : '렌즈를 등록했어요');
  }

  /* ---------- 날짜별 기록 시트 ---------- */

  function openDay(dateStr) {
    selectedDay = dateStr;
    renderDaySheet();
    openOverlay('dayOverlay');
  }

  function renderDaySheet() {
    const d = parseKey(selectedDay);
    const isToday = selectedDay === todayKey();
    const future = selectedDay > todayKey();
    const st = dayStats(selectedDay);

    $('dayTitle').textContent = isToday
      ? `오늘 · ${d.getMonth() + 1}월 ${d.getDate()}일`
      : `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}요일`;

    const body = $('dayBody');
    body.innerHTML = '';

    const rateRow = document.createElement('div');
    rateRow.className = 'day-rate';
    rateRow.innerHTML = `<b>${st.total ? `${st.rate}%` : '—'}</b>
      <span class="mini-bar"><i style="width:${st.rate}%"></i></span>
      <span>${st.total ? `${st.done}/${st.total} 완료` : '기록 없음'}</span>`;
    body.appendChild(rateRow);

    if (!st.list.length) {
      const p = document.createElement('p');
      p.className = 'sheet-empty';
      p.textContent = '이 날은 아직 루틴이 없었어요.';
      body.appendChild(p);
    } else {
      const ul = document.createElement('ul');
      ul.className = 'day-list';
      st.list.forEach((r) => {
        const done = !!st.rec[r.id];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `day-item${done ? ' done' : ''}`;
        btn.disabled = future;
        btn.setAttribute('aria-pressed', done ? 'true' : 'false');
        btn.innerHTML = `<span class="routine-emoji" aria-hidden="true">${r.emoji}</span><span class="routine-name">${escapeHtml(r.name)}</span>${checkIcon()}`;
        btn.addEventListener('click', () => toggle(selectedDay, r.id));
        const li = document.createElement('li');
        li.appendChild(btn);
        ul.appendChild(li);
      });
      body.appendChild(ul);
    }

    // 이 날의 다른 기록
    const sl = sleepMin(state.sleep[selectedDay]);
    const run = state.runs[selectedDay];
    const rd = state.reading[selectedDay];
    const q = state.quotes[selectedDay];

    const extra = document.createElement('div');
    extra.className = 'day-extra';
    extra.innerHTML = `
      <div class="ex"><span class="ex-label">😴 수면</span><span class="ex-value${sl != null ? '' : ' none'}">${sl != null ? durStr(sl) : '기록 없음'}</span></div>
      <div class="ex"><span class="ex-label">🏃 러닝</span><span class="ex-value${run ? '' : ' none'}">${run ? `${kmStr(run.km)}km${run.pace != null ? ` · ${paceStr(run.pace)}` : ''}` : '기록 없음'}</span></div>
      <div class="ex"><span class="ex-label">📖 독서</span><span class="ex-value${rd ? '' : ' none'}">${rd ? escapeHtml([rd.book, rd.amount].filter(Boolean).join(' · ') || '메모만 기록') : '기록 없음'}</span></div>
      <div class="ex"><span class="ex-label">✍️ 필사</span><span class="ex-value${q && q.text ? '' : ' none'}">${q && q.text ? '1문장' : '기록 없음'}</span></div>
      ${q && q.text ? `<div class="ex ex-quote"><span class="ex-label">필사</span><span class="ex-value">“${escapeHtml(q.text)}”</span></div>` : ''}`;
    body.appendChild(extra);

    const note = document.createElement('p');
    note.className = 'sheet-note';
    if (future) note.textContent = '아직 오지 않은 날이에요.';
    else if (isToday) note.textContent = '탭해서 오늘 기록을 바꿀 수 있어요.';
    else note.textContent = '지난 날짜의 루틴도 탭해서 고칠 수 있어요.';
    body.appendChild(note);
  }

  /* ---------- 루틴 관리 ---------- */

  function renderManage() {
    const list = routinesOn(todayKey());
    const ul = $('manageList');
    ul.innerHTML = '';
    if (!list.length) {
      ul.innerHTML = '<li class="empty-state"><b>루틴이 없어요</b>아래에서 새 루틴을 추가해 주세요</li>';
      return;
    }
    list.forEach((r, idx) => {
      const g = GROUPS.find((x) => x.id === r.group);
      const li = document.createElement('li');
      li.className = 'manage-item';
      li.innerHTML = `<span class="routine-emoji" aria-hidden="true">${r.emoji}</span>
        <span class="routine-name">${escapeHtml(r.name)}</span>
        <span class="m-group">${g ? g.label : '기타'}</span>
        <span class="order-btns">
          <button type="button" class="up" aria-label="위로 이동" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="down" aria-label="아래로 이동" ${idx === list.length - 1 ? 'disabled' : ''}>↓</button>
        </span>
        <button type="button" class="act edit" aria-label="수정">✏️</button>
        <button type="button" class="act del" aria-label="삭제">🗑</button>`;
      li.querySelector('.up').addEventListener('click', () => moveRoutine(r.id, -1));
      li.querySelector('.down').addEventListener('click', () => moveRoutine(r.id, 1));
      li.querySelector('.edit').addEventListener('click', () => openEditor(r.id));
      li.querySelector('.del').addEventListener('click', () => {
        askConfirm(`‘${r.name}’ 루틴을 삭제할까요? 지난 기록은 유지돼요.`, '삭제', () => {
          const item = state.routines.find((x) => x.id === r.id);
          if (item) item.deletedAt = todayKey();
          saveState();
          renderManage();
          renderToday();
          renderSummary();
          renderStats();
          toast('삭제했어요');
        });
      });
      ul.appendChild(li);
    });
  }

  function moveRoutine(id, dir) {
    const list = routinesOn(todayKey());
    const idx = list.findIndex((r) => r.id === id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= list.length) return;
    const a = state.routines.find((r) => r.id === list[idx].id);
    const b = state.routines.find((r) => r.id === list[target].id);
    const tmp = a.order;
    a.order = b.order;
    b.order = tmp;
    saveState();
    renderManage();
    renderToday();
  }

  /* ---------- 루틴 추가·수정 ---------- */

  function buildEmojiGrid() {
    const grid = $('emojiGrid');
    grid.innerHTML = '';
    EMOJIS.forEach((e) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `emoji-btn${e === pickedEmoji ? ' sel' : ''}`;
      b.textContent = e;
      b.setAttribute('aria-label', `이모지 ${e}`);
      b.addEventListener('click', () => {
        pickedEmoji = e;
        grid.querySelectorAll('.emoji-btn').forEach((x) => x.classList.toggle('sel', x.textContent === e));
      });
      grid.appendChild(b);
    });
  }

  function setGroupSeg(group) {
    pickedGroup = group;
    $('groupSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.group === group));
  }

  function openEditor(id) {
    editingId = id || null;
    const item = id ? state.routines.find((r) => r.id === id) : null;
    pickedEmoji = item ? item.emoji : EMOJIS[0];
    $('editorTitle').textContent = item ? '루틴 수정' : '루틴 추가';
    $('nameInput').value = item ? item.name : '';
    setGroupSeg(item ? item.group || 'day' : 'morning');
    buildEmojiGrid();
    openOverlay('editorOverlay');
    setTimeout(() => { if (!item) $('nameInput').focus(); }, 260);
  }

  function saveEditor() {
    const raw = $('nameInput').value.trim();
    if (!raw) {
      toast('루틴 이름을 입력해 주세요');
      $('nameInput').focus();
      return;
    }
    const name = raw.slice(0, 30);
    if (editingId) {
      const r = state.routines.find((x) => x.id === editingId);
      if (r) { r.emoji = pickedEmoji; r.name = name; r.group = pickedGroup; }
      toast('수정했어요');
    } else {
      const maxOrder = state.routines.reduce((m, r) => Math.max(m, r.order), -1);
      state.routines.push({
        id: uid(),
        emoji: pickedEmoji,
        name,
        group: pickedGroup,
        createdAt: todayKey(),
        deletedAt: null,
        order: maxOrder + 1
      });
      toast('루틴을 추가했어요');
    }
    saveState();
    closeOverlay('editorOverlay');
    editingId = null;
    if (!$('manageOverlay').hidden) renderManage();
    renderToday();
    renderSummary();
    renderStats();
  }

  /* ---------- 공통 다이얼로그 ---------- */

  function askConfirm(text, yesLabel, fn) {
    $('confirmText').textContent = text;
    $('confirmYes').textContent = yesLabel || '확인';
    confirmAction = fn;
    openOverlay('confirmOverlay');
  }

  function openOverlay(id) {
    const ov = $(id);
    ov.hidden = false;
    document.body.classList.add('locked');
    requestAnimationFrame(() => ov.classList.add('show'));
  }

  function closeOverlay(id) {
    const ov = $(id);
    ov.classList.remove('show');
    setTimeout(() => {
      ov.hidden = true;
      const anyOpen = ['dayOverlay', 'manageOverlay', 'editorOverlay', 'lensOverlay', 'confirmOverlay'].some((k) => !$(k).hidden);
      if (!anyOpen) document.body.classList.remove('locked');
    }, 240);
  }

  /* ---------- 탭 ---------- */

  function switchTab(name) {
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
    document.querySelectorAll('.tab').forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (name === 'today') { renderSummary(); renderToday(); }
    if (name === 'run') renderRun();
    if (name === 'log') renderLog();
    if (name === 'cal') { renderCalendar(); renderStats(); }
  }

  /* ---------- 이벤트 ---------- */

  function bind() {
    document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

    $('addBtn').addEventListener('click', () => openEditor(null));
    $('manageBtn').addEventListener('click', () => { renderManage(); openOverlay('manageOverlay'); });
    $('manageAdd').addEventListener('click', () => openEditor(null));
    $('manageClose').addEventListener('click', () => closeOverlay('manageOverlay'));

    ['bedInput', 'wakeInput'].forEach((id) => {
      const el = $(id);
      el.addEventListener('input', () => { normalizeTime(el); updateSleepResult(); });
      el.addEventListener('blur', () => { normalizeTime(el, true); saveSleep(); });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); normalizeTime(el, true); saveSleep(); el.blur(); }
      });
    });

    $('runSave').addEventListener('click', saveRun);
    ['runDist', 'paceMin', 'paceSec'].forEach((id) => {
      $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveRun(); } });
    });

    $('bookInput').addEventListener('input', () => { clearTimeout(readTimer); readTimer = setTimeout(saveReading, 600); });
    $('readAmount').addEventListener('input', () => { clearTimeout(readTimer); readTimer = setTimeout(saveReading, 600); });
    $('readMemo').addEventListener('input', () => { clearTimeout(readTimer); readTimer = setTimeout(saveReading, 600); });
    $('bookInput').addEventListener('change', () => { clearTimeout(readTimer); saveReading(); });

    $('quoteInput').addEventListener('input', () => { clearTimeout(quoteTimer); quoteTimer = setTimeout(saveQuote, 700); });
    $('quoteSource').addEventListener('input', () => { clearTimeout(quoteTimer); quoteTimer = setTimeout(saveQuote, 700); });

    // 앱을 빠져나가기 전에도 저장되도록 포커스를 잃을 때 즉시 저장
    ['bookInput', 'readAmount', 'readMemo'].forEach((id) => {
      $(id).addEventListener('blur', () => { clearTimeout(readTimer); saveReading(); });
    });
    ['quoteInput', 'quoteSource'].forEach((id) => {
      $(id).addEventListener('blur', () => { clearTimeout(quoteTimer); saveQuote(); });
    });

    $('lensAdd').addEventListener('click', () => openLensEditor(null));
    $('lensCancel').addEventListener('click', () => { closeOverlay('lensOverlay'); editingLensId = null; });
    $('lensSave').addEventListener('click', saveLens);

    $('dayClose').addEventListener('click', () => closeOverlay('dayOverlay'));

    $('editorCancel').addEventListener('click', () => { closeOverlay('editorOverlay'); editingId = null; });
    $('editorSave').addEventListener('click', saveEditor);
    $('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveEditor(); } });
    $('groupSeg').querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => setGroupSeg(b.dataset.group));
    });

    $('confirmNo').addEventListener('click', () => { confirmAction = null; closeOverlay('confirmOverlay'); });
    $('confirmYes').addEventListener('click', () => {
      const fn = confirmAction;
      confirmAction = null;
      closeOverlay('confirmOverlay');
      if (fn) fn();
    });

    $('prevMonth').addEventListener('click', () => {
      viewMonth--;
      if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      renderCalendar();
    });
    $('nextMonth').addEventListener('click', () => {
      viewMonth++;
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      renderCalendar();
    });

    ['dayOverlay', 'manageOverlay', 'editorOverlay', 'lensOverlay', 'confirmOverlay'].forEach((id) => {
      const ov = $(id);
      ov.addEventListener('click', (e) => {
        if (e.target !== ov) return;
        if (id === 'editorOverlay') editingId = null;
        if (id === 'lensOverlay') editingLensId = null;
        if (id === 'confirmOverlay') confirmAction = null;
        closeOverlay(id);
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      ['editorOverlay', 'lensOverlay', 'confirmOverlay', 'dayOverlay', 'manageOverlay'].forEach((id) => {
        if (!$(id).hidden) closeOverlay(id);
      });
    });

    window.addEventListener('storage', (e) => {
      if (e.key === STORE) {
        state = loadState();
        renderAll();
      }
    });

    // 자정이 지나면 '오늘' 화면 갱신
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        renderHeader();
        renderAll();
      }
    });
  }

  function renderAll() {
    renderSummary();
    renderToday();
    renderCalendar();
    renderStats();
    if ($('view-run').classList.contains('active')) renderRun();
    if ($('view-log').classList.contains('active')) renderLog();
  }

  /* ---------- 시작 ---------- */

  function init() {
    const now = new Date();
    viewYear = now.getFullYear();
    viewMonth = now.getMonth();
    renderHeader();
    bind();
    renderAll();
    switchTab('today');

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
