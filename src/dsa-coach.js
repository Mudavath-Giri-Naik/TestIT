// DSA preset: renders the Interview Coach result (structured JSON from
// src/main/interviewCoach.js) as a chat message. Model text is always set via
// textContent; only code goes through highlight(), which HTML-escapes it.
(function () {
  'use strict';

  const SECTION_TITLES = [
    'Understanding the question', 'Constraints', 'Solving the example by hand', 'Brute force', 'Optimizing',
    'Coding it', 'Dry run', 'Edge cases', 'Summary', 'Follow-up questions',
  ];

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function button(label, onClick, cls = 'dsa-btn') {
    const b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  async function copyText(text, btn) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove();
    }
    if (btn) {
      const old = btn.textContent;
      btn.textContent = ok ? 'Copied ✓' : 'Copy failed';
      setTimeout(() => { btn.textContent = old; }, 1300);
    }
  }

  // ── Small dependency-free syntax highlighter ──
  const KEYWORDS = {
    python: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return self True try while with yield int str list dict set tuple len range float bool',
    clike: 'abstract auto bool boolean break byte case catch char class const constexpr continue default delete do double else enum extends false final finally float for fn fun func function go if impl implements import in include inline int interface let long map match mut namespace new nil null nullptr of override package private protected pub public range return self short signed sizeof static string String struct super switch template this throw throws true try type typedef unsigned use using val var vector virtual void while yield Integer List ArrayList HashMap Map Set HashSet Deque ArrayDeque PriorityQueue Arrays Math std unordered_map unordered_set pair queue stack deque priority_queue',
  };
  const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function highlight(code, language) {
    const lang = (language || '').toLowerCase();
    const isPy = lang.includes('python') || lang === 'py';
    const kw = new Set(KEYWORDS[isPy ? 'python' : 'clike'].split(' '));
    const re = isPy
      ? /("""[\s\S]*?"""|'''[\s\S]*?''')|(#.*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)/g
      : /(\/\*[\s\S]*?\*\/)|(\/\/.*|^\s*#\s*\w+.*$)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?[fFlL]?\b)|([A-Za-z_]\w*)/gm;
    const lines = [[]];
    const push = (text, cls) => {
      text.split('\n').forEach((part, i) => {
        if (i > 0) lines.push([]);
        if (part) lines[lines.length - 1].push(cls ? `<span class="${cls}">${escapeHtml(part)}</span>` : escapeHtml(part));
      });
    };
    let last = 0, m;
    while ((m = re.exec(code))) {
      if (m.index > last) push(code.slice(last, m.index));
      const [tok, block, com, str, num, ident] = m;
      if (block) push(tok, isPy ? 'tk-str' : 'tk-com');
      else if (com) push(tok, 'tk-com');
      else if (str) push(tok, 'tk-str');
      else if (num) push(tok, 'tk-num');
      else if (ident) push(tok, kw.has(tok) ? 'tk-kw' : /^\s*\(/.test(code.slice(re.lastIndex)) ? 'tk-fn' : null);
      last = re.lastIndex;
    }
    if (last < code.length) push(code.slice(last));
    return lines.map(l => `<span class="line">${l.join('') || ' '}</span>`).join('\n');
  }

  // ── Blocks ──
  function renderBlock(b) {
    switch (b.type) {
      case 'say': {
        const n = el('div', 'dsa-say');
        n.append(el('span', 'dsa-ico', '🗣️'), el('p', null, b.text));
        return n;
      }
      case 'term': {
        const n = el('div', 'dsa-term');
        const row = el('div', 'row');
        row.append(el('span', 'dsa-ico', '🗣️'), el('p', null, b.text));
        n.append(el('span', 'chip', `💡 ${b.term}`), row);
        return n;
      }
      case 'pause': {
        const n = el('div', 'dsa-pause');
        n.append(el('span', null, '⏸️'), el('span', null, b.note));
        return n;
      }
      case 'board': {
        const n = el('div', 'dsa-board');
        const head = el('div', 'dsa-bhead');
        const copy = button('Copy', () => copyText(b.text, copy));
        head.append(el('span', null, '📝 Whiteboard'), el('span', 'sp'), copy);
        n.append(head, el('pre', null, b.text));
        return n;
      }
      case 'interviewer_question': {
        const n = el('div', 'dsa-ask');
        const body = el('div');
        body.append(el('span', 'lbl', 'Interviewer may ask'), el('p', null, b.text));
        n.append(el('span', 'dsa-ico', '❓'), body);
        return n;
      }
      case 'complexity': {
        const n = el('div', 'dsa-cx');
        const head = el('div', 'dsa-cx-head');
        head.append(el('span', 'name', b.which === 'optimized' ? '⚡ Optimized' : '🐢 Brute force'),
          el('span', 'dsa-badge', `Time ${b.time}`), el('span', 'dsa-badge', `Space ${b.space}`));
        n.append(head, el('div', 'why', b.why));
        return n;
      }
      case 'code': {
        const n = el('div', 'dsa-code');
        const head = el('div', 'dsa-bhead');
        const copy = button('Copy', () => copyText(b.code, copy));
        head.append(el('span', null, b.language), el('span', 'sp'), copy);
        const pre = el('pre');
        const code = el('code');
        code.innerHTML = highlight(b.code, b.language);
        pre.append(code);
        n.append(head, pre);
        return n;
      }
      default:
        return el('div');
    }
  }

  function renderComparison(c) {
    const wrap = el('div');
    wrap.style.display = 'grid';
    wrap.style.gap = '6px';
    const t = el('table', 'dsa-compare');
    const hr = el('tr');
    ['', 'Brute force', 'Optimized'].forEach(h => hr.append(el('th', null, h)));
    const thead = el('thead');
    thead.append(hr);
    const tbody = el('tbody');
    [['Time', 'time'], ['Space', 'space']].forEach(([label, key]) => {
      const tr = el('tr');
      const a = el('td'); a.append(el('code', null, c.brute_force[key]));
      const b = el('td', 'opt'); b.append(el('code', null, c.optimized[key]));
      tr.append(el('td', null, label), a, b);
      tbody.append(tr);
    });
    t.append(thead, tbody);
    const imp = el('div', 'dsa-improve');
    imp.append(el('span', 'dsa-badge good', '▲ Improvement'), el('span', null, c.improvement));
    wrap.append(t, imp);
    return wrap;
  }

  // ── Plain-text versions (Copy full script, chat history) ──
  function scriptText(data) {
    const out = [`${data.problem_title}${data.difficulty ? ` (${data.difficulty})` : ''} · ${data.language}`, ''];
    data.sections.forEach((s, i) => {
      out.push(`${i + 1}. ${s.title}`, '');
      if (s.id === 'summary' && data.comparison) {
        const c = data.comparison;
        out.push(`📊 Brute force: time ${c.brute_force.time}, space ${c.brute_force.space}`,
          `📊 Optimized: time ${c.optimized.time}, space ${c.optimized.space}`,
          `📊 Improvement: ${c.improvement}`, '');
      }
      s.blocks.forEach(b => {
        if (b.type === 'say') out.push(`🗣️ ${b.text}`);
        else if (b.type === 'term') out.push(`💡 ${b.term}: ${b.text}`);
        else if (b.type === 'pause') out.push(`⏸️ (${b.note})`);
        else if (b.type === 'board') out.push(`📝\n${b.text}`);
        else if (b.type === 'interviewer_question') out.push(`❓ ${b.text}`);
        else if (b.type === 'complexity') out.push(`⏱️ ${b.which === 'optimized' ? 'Optimized' : 'Brute force'}: time ${b.time}, space ${b.space}. ${b.why}`);
        else if (b.type === 'code') out.push('```' + b.language.toLowerCase() + '\n' + b.code + '\n```');
        out.push('');
      });
    });
    return out.join('\n').trim() + '\n';
  }
  function finalCode(data) {
    const sec = data.sections.find(s => s.id === 'code');
    const codes = (sec ? sec.blocks : []).filter(b => b.type === 'code');
    return codes.length ? codes[codes.length - 1].code : '';
  }

  // ── Message builders ──
  function renderResult(data, { model, modelNote, onRegenerate, scrollRoot } = {}) {
    const msg = el('div', 'msg ai dsa-msg');

    const head = el('div', 'dsa-head');
    head.append(el('div', 'dsa-title', data.problem_title));
    const badges = el('div', 'dsa-badges');
    if (data.difficulty) badges.append(el('span', `dsa-badge ${data.difficulty.toLowerCase()}`, data.difficulty));
    badges.append(el('span', 'dsa-badge', data.language));
    if (model) badges.append(el('span', 'dsa-badge', model));
    head.append(badges);

    const actions = el('div', 'dsa-actions');
    const copyScript = button('Copy full script', () => copyText(scriptText(data), copyScript));
    const copyCode = button('Copy code', () => copyText(finalCode(data), copyCode));
    const focusBtn = button('Focus', () => setFocus(!msg.classList.contains('focus')));
    focusBtn.title = 'Show one section at a time';
    actions.append(copyScript, copyCode, focusBtn);
    if (onRegenerate) actions.append(button('Regenerate', onRegenerate));
    head.append(actions);
    msg.append(head);
    if (modelNote) msg.append(el('div', 'dsa-note', `💡 ${modelNote}`));

    const nav = el('div', 'dsa-nav');
    const list = el('div', 'dsa-sections');
    const chips = [];
    const cards = [];
    let current = 0;

    data.sections.forEach((s, i) => {
      const card = el('div', 'dsa-section');
      card.dataset.idx = String(i);
      const sh = el('div', 'dsa-section-head');
      sh.append(el('span', 'n', String(i + 1)), el('h3', null, s.title));
      const blocks = el('div', 'dsa-blocks');
      if (s.id === 'summary' && data.comparison) blocks.append(renderComparison(data.comparison));
      s.blocks.forEach(b => blocks.append(renderBlock(b)));
      card.append(sh, blocks);
      list.append(card);
      cards.push(card);

      const chip = el('button', 'dsa-chip');
      chip.type = 'button';
      chip.title = s.title;
      chip.append(el('span', 'n', String(i + 1)), el('span', null, s.title));
      chip.addEventListener('click', () => goTo(i));
      nav.append(chip);
      chips.push(chip);
    });

    const focusbar = el('div', 'dsa-focusbar');
    const prev = button('← Prev', () => goTo(current - 1));
    const where = el('span', 'where');
    const next = button('Next →', () => goTo(current + 1), 'dsa-btn primary');
    focusbar.append(prev, where, next);

    msg.append(nav, list, focusbar);

    function setActive(i) {
      current = i;
      chips.forEach((c, j) => c.classList.toggle('active', j === i));
      const chip = chips[i];
      if (chip) nav.scrollTo({ left: chip.offsetLeft - nav.clientWidth / 2 + chip.clientWidth / 2, behavior: 'smooth' });
      cards.forEach((c, j) => c.classList.toggle('current', j === i));
      where.textContent = `${i + 1}/${cards.length} · ${data.sections[i].title}`;
      prev.disabled = i === 0;
      next.disabled = i === cards.length - 1;
    }
    function goTo(i) {
      i = Math.max(0, Math.min(cards.length - 1, i));
      setActive(i);
      if (msg.classList.contains('focus')) msg.scrollIntoView({ block: 'start' });
      else cards[i].scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function setFocus(on) {
      msg.classList.toggle('focus', on);
      focusBtn.classList.toggle('on', on);
      focusBtn.textContent = on ? 'Exit focus' : 'Focus';
      goTo(current);
    }

    // Highlight the chip of the section currently at the top of the chat.
    if ('IntersectionObserver' in window) {
      const obs = new IntersectionObserver((entries) => {
        if (msg.classList.contains('focus')) return;
        const vis = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis.length) setActive(Number(vis[0].target.dataset.idx));
      }, { root: scrollRoot || null, rootMargin: '-15% 0px -70% 0px' });
      cards.forEach(c => obs.observe(c));
    }
    setActive(0);
    return msg;
  }

  const STAGES = [
    [0, 'Reading the screenshot…'], [6, 'Understanding the problem…'], [14, 'Working out the brute force…'],
    [26, 'Finding the optimization…'], [40, 'Writing and checking the code…'], [60, 'Dry-running the examples…'],
    [85, 'Almost there — hard problems take a bit…'],
  ];

  function renderLoading() {
    const msg = el('div', 'msg ai dsa-msg');
    const bar = el('div', 'dsa-progress');
    const txt = el('span', 'msgtxt', STAGES[0][1]);
    const t = el('span', 't', '0s');
    bar.append(el('span', 'dsa-spin'), txt, t);
    const list = el('div', 'dsa-sections');
    SECTION_TITLES.forEach((title, i) => {
      const sec = el('div', 'dsa-sk-sec');
      const l = el('div', 'dsa-sk line');
      l.style.width = `${45 + (i * 13) % 40}%`;
      sec.append(el('div', 'ttl', `${i + 1}. ${title}`), el('div', 'dsa-sk bubble'), l);
      list.append(sec);
    });
    msg.append(bar, list);
    const start = Date.now();
    const timer = setInterval(() => {
      const s = Math.floor((Date.now() - start) / 1000);
      t.textContent = `${s}s`;
      txt.textContent = STAGES.filter(([at]) => s >= at).pop()[1];
    }, 500);
    msg.stop = () => clearInterval(timer);
    return msg;
  }

  function renderError({ title, message, tips, details, onRetry }) {
    const msg = el('div', 'msg ai dsa-msg');
    const box = el('div', 'dsa-error');
    box.append(el('h3', null, `😕 ${title}`), el('p', null, message));
    if (tips && tips.length) {
      const ul = el('ul');
      tips.forEach(x => ul.append(el('li', null, x)));
      box.append(ul);
    }
    if (details && details.length) {
      const d = el('details');
      d.append(el('summary', null, 'Details'));
      details.forEach(x => d.append(el('div', null, `• ${x}`)));
      box.append(d);
    }
    if (onRetry) {
      const row = el('div', 'dsa-actions');
      row.append(button('Try again', onRetry, 'dsa-btn primary'));
      box.append(row);
    }
    msg.append(box);
    return msg;
  }

  window.DsaCoach = { renderResult, renderLoading, renderError, scriptText, finalCode, highlight };
})();
