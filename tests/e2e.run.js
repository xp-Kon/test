/* 端到端：jsdom 里真实加载 site/index.html，驱动 UI 走完练习、考试、错题、统计。
   运行： node e2e/run.js  */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SITE = process.env.SITE_DIR ? path.resolve(process.env.SITE_DIR) : path.join(__dirname, '..');
const DATA = JSON.parse(fs.readFileSync(path.join(SITE, 'data', 'banks.json'), 'utf8'));

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; return true; }
  fail++; fails.push(name + (detail ? ' -> ' + detail : ''));
  return false;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 3000, step = 40) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (fn()) return true; } catch { /* not ready */ }
    await sleep(step);
  }
  return false;
}

/* jsdom 31 不再导出 ResourceLoader：把外链脚本内联进 HTML 再执行 */
function inlineHtml() {
  let out = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
  out = out.replace(/<script src="([^"]+)"><\/script>/g, (_m, src) => {
    const file = path.join(SITE, src.replace(/^\.\//, ''));
    return '<script>' + fs.readFileSync(file, 'utf8') + '</script>';
  });
  return out;
}
const INLINE_HTML = inlineHtml();

(async function main() {
  const jsErrors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => jsErrors.push(String(e && e.message || e)));
  vc.on('error', (...a) => jsErrors.push(a.join(' ')));

  const dom = new JSDOM(INLINE_HTML, {
    url: 'https://xp-kon.github.io/test/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.fetch = (url) => {
        const rel = String(url).replace(/^\.\//, '');
        if (rel.endsWith('data/banks.json')) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(DATA) });
        }
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
      };
      window.scrollTo = () => {};
      window.confirm = () => true;
      window.prompt = (_msg, def) => def + 'X';
    }
  });

  const { window } = dom;
  const doc = window.document;
  const $ = sel => doc.querySelector(sel);
  const $$ = sel => Array.from(doc.querySelectorAll(sel));
  const text = sel => ($(sel) ? $(sel).textContent.trim() : '');
  function click(elOrSel) {
    const el = typeof elOrSel === 'string' ? $(elOrSel) : elOrSel;
    if (!el) throw new Error('click miss: ' + elOrSel);
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    return el;
  }
  const allQ = {};
  DATA.banks.forEach(b => b.questions.forEach(q => { allQ[q.id] = q; }));

  /* ---------- 1. 启动 ---------- */
  const booted = await waitFor(() => $$('.stat').length === 5, 5000);
  ok(booted, '首页渲染出 5 个统计卡');
  const statValues = $$('.stat .v').map(e => e.textContent.trim());
  ok(statValues.includes('1239'), '首页题目总数显示 1239', statValues.join('/'));
  ok(text('#nav-banks') === '4', '侧栏题库数为 4', text('#nav-banks'));
  ok($$('.bank-card').length === 4, '首页 4 个题库卡片');

  /* ---------- 2. 进入练习并开始 ---------- */
  click('[data-nav="practice"]');
  await waitFor(() => $('#p-bank'), 2000);
  ok(!!$('#p-bank'), '练习启动器出现');
  ok($$('#p-mode .mode-card').length === 3, '三种练习方式');
  click('[data-act="start-practice"]');
  ok(await waitFor(() => $('.q-card'), 3000), '练习会话渲染出题目卡');
  ok(/1 \/ \d+/.test(text('.page-head .num-chip')), '初始为第 1 题', text('.page-head .num-chip'));

  /* ---------- 3. 答对自动下一题 ---------- */
  function currentQIndexLabel() { return text('.page-head .num-chip'); }
  // 找一道单选题，用快捷键作答（A-H）
  // 从题库里按题干定位当前题
  function currentQuestion() {
    const stems = Object.keys(allQ).map(id => allQ[id]);
    const s = text('.stem');
    return stems.filter(q => s.startsWith(q.stem.slice(0, 20)))[0] || null;
  }
  let cq = currentQuestion();
  ok(!!cq, '能从 DOM 反查当前题目', text('.stem').slice(0, 20));
  // 若当前不是单选/判断，就跳到第一题里首个单选/判断
  if (cq && cq.qtype !== 'single' && cq.qtype !== 'judge') {
    // 用答题卡跳到任意单选题
    const idx = (window.__quiz.practice.questions || []).findIndex(q => q.qtype === 'single' || q.qtype === 'judge');
    if (idx >= 0) {
      const cells = $$('.nav-grid .cell');
      click(cells[idx]);
      await sleep(120);
      cq = currentQuestion();
    }
  }
  ok(cq && (cq.qtype === 'single' || cq.qtype === 'judge'), '定位到可即时判分的题', cq && cq.qtype);

  const lettersBefore = currentQIndexLabel();
  const correctLetters = cq.qtype === 'judge' ? (cq.answer === '对' ? ['A'] : ['B']) : cq.answer.split('');
  const L = window.QuizLogic;
  // 先验证错误作答停在原题
  const wrongLetter = L.LETTERS.split('').filter(x => cq.options.length > L.LETTERS.indexOf(x) && correctLetters.indexOf(x) < 0)[0];
  if (wrongLetter) {
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: wrongLetter, bubbles: true }));
    await sleep(150);
    ok(!!$('.result-line.bad') || !!$('.analysis'), '答错后展示对错与解析');
    ok(currentQIndexLabel() === lettersBefore, '答错后停在原题不跳转', currentQIndexLabel());
  } else {
    ok(true, '答错后停在原题（该题无可选错误项，跳过）');
    ok(true, '答错后展示解析（同上跳过）');
  }

  // 回到该题重新答对（模拟：直接跳到下一题前先记录），用新题验证自动跳转
  const nextIdx = window.__quiz.practice.idx + 1 < window.__quiz.practice.questions.length ? window.__quiz.practice.idx + 1 : 0;
  click($$('.nav-grid .cell')[nextIdx]);
  await sleep(150);
  let cq2 = currentQuestion();
  if (cq2 && cq2.qtype === 'fill') { // 主观题不参与自动跳转
    const idx3 = window.__quiz.practice.questions.findIndex(q => q.qtype === 'single' || q.qtype === 'judge');
    click($$('.nav-grid .cell')[idx3]);
    await sleep(150);
    cq2 = currentQuestion();
  }
  if (cq2 && (cq2.qtype === 'single' || cq2.qtype === 'judge')) {
    const labelBefore = currentQIndexLabel();
    const right = cq2.qtype === 'judge' ? (cq2.answer === '对' ? 'A' : 'B') : cq2.answer.split('')[0];
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: right, bubbles: true }));
    await sleep(150);
    ok(!!$('.result-line.ok'), '答对即时显示正确');
    const advanced = await waitFor(() => currentQIndexLabel() !== labelBefore, 2000);
    ok(advanced, '答对后自动进入下一题', labelBefore + ' -> ' + currentQIndexLabel());
  } else {
    ok(true, '答对即时反馈（当前题非客观题，跳过）');
    ok(true, '答对自动下一题（跳过）');
  }

  /* ---------- 4. 多选题流程 ---------- */
  const multiIdx = window.__quiz.practice.questions.findIndex(q => q.qtype === 'multiple');
  if (multiIdx >= 0) {
    click($$('.nav-grid .cell')[multiIdx]);
    await sleep(150);
    const mq = currentQuestion();
    ok(mq.qtype === 'multiple', '跳到多选题');
    // 点两个选项后确认
    click('.opt');
    await sleep(60);
    click('.opt:nth-of-type(2)');
    await sleep(60);
    ok(!!$('[data-act="confirm"]'), '多选题出现确认按钮');
    click('[data-act="confirm"]');
    await sleep(200);
    ok(!!$('.result-line.ok') || !!$('.result-line.bad'), '多选题确认后给出判分');
    ok(window.__quiz.state.records.some(r => r.qid === mq.id), '多选题作答写入记录');
  } else {
    ok(true, '多选流程（题库无多选题，跳过）'); ok(true, ''); ok(true, ''); ok(true, '');
  }

  /* ---------- 5. 填空题自评 ---------- */
  const fillIdx = window.__quiz.practice.questions.findIndex(q => q.qtype === 'fill');
  if (fillIdx >= 0) {
    click($$('.nav-grid .cell')[fillIdx]);
    await sleep(150);
    const fq = currentQuestion();
    const ta = $('#fill-input');
    ok(!!ta, '填空题渲染文本框');
    if (ta) {
      ta.value = '我的作答内容';
      ta.dispatchEvent(new window.Event('input', { bubbles: true }));
      click('[data-act="confirm"]');
      await sleep(150);
      ok(!!$('[data-act="self-ok"]'), '填空提交后出现自评按钮');
      click('[data-act="self-ok"]');
      await sleep(200);
      const rec = window.__quiz.state.records.filter(r => r.qid === fq.id).pop();
      ok(rec && rec.ok === 1, '自评「答对」写入 ok=1', JSON.stringify(rec));
    }
  } else {
    ok(true, '填空流程（无填空题，跳过）'); ok(true, ''); ok(true, ''); ok(true, '');
  }

  /* ---------- 6. 半截作答不丢 ---------- */
  const p = window.__quiz.practice;
  const draftTarget = p.questions.findIndex((q, i) => q.qtype === 'multiple' && !p.graded[q.id] && i !== p.idx);
  if (draftTarget >= 0) {
    click($$('.nav-grid .cell')[draftTarget]);
    await sleep(120);
    const dq = currentQuestion();
    click('.opt');
    await sleep(80);
    const selBefore = window.QuizLogic.normalizeSelection(window.__quiz.practice.drafts[dq.id].sel || '');
    const domSelBefore = $$('.opt.sel').length;
    click($$('.nav-grid .cell')[0]);
    await sleep(120);
    click($$('.nav-grid .cell')[draftTarget]);
    await sleep(120);
    const selAfter = window.QuizLogic.normalizeSelection(window.__quiz.practice.drafts[dq.id].sel || '');
    const domSelAfter = $$('.opt.sel').length;
    ok(selBefore !== '' && selBefore === selAfter, '切题后未提交的多选仍保留（缓存）', selBefore + '/' + selAfter);
    ok(domSelBefore > 0 && domSelAfter === domSelBefore, '切题回来后选中态仍然可见（界面）', domSelBefore + '/' + domSelAfter);
  } else {
    ok(true, '半截作答保留（无可测题目，跳过）');
  }

  /* ---------- 7. 收藏 / 错题本 ---------- */
  const favBefore = text('#nav-fav');
  click('[data-act="fav"]');
  await sleep(150);
  ok(text('#nav-fav') !== favBefore, '收藏后侧栏计数变化', favBefore + ' -> ' + text('#nav-fav'));
  ok(Number(text('#nav-wrong')) > 0, '答错后错题本计数 > 0', text('#nav-wrong'));

  click('[data-nav="wrong"]');
  await waitFor(() => $('.card'), 2000);
  ok($$('.card').length >= 1, '错题本页面渲染');
  ok($$('.card .opt').length > 0, '错题本用选项行展示（带题号徽标）', $$('.card .opt').length);
  ok($$('.card .opt.wrong').length > 0, '上次选错的选项标红', $$('.card .opt.wrong').length);
  ok($$('.card .opt.correct').length > 0, '正确选项标绿');
  ok($$('.card .pick-wrong').length > 0, '显示「你上次选：X」', $$('.card .pick-wrong').length);
  const resolveBtn = $('[data-act="wrong-resolve"]');
  const wrongBefore = text('#nav-wrong');
  if (resolveBtn) {
    click(resolveBtn);
    await sleep(150);
    ok(text('#nav-wrong') !== wrongBefore, '「标记已掌握」后错题计数下降', wrongBefore + ' -> ' + text('#nav-wrong'));
  } else {
    ok(true, '错题本无条目可标记'); 
  }

  /* ---------- 7b. 题库管理：桌面表 + 移动卡片 ---------- */
  click('[data-nav="banks"]');
  await waitFor(() => $('.mob-card'), 2500);
  ok($$('.desk-only table.data').length === 1, '题库页保留桌面宽表');
  ok($$('.mob-list .mob-card').length === 4, '题库页移动端 4 张卡片', $$('.mob-list .mob-card').length);
  ok($$('.mob-kv').length === 4, '每张卡片含统计格', $$('.mob-kv').length);
  ok(($$('.mob-actions .btn').length >= 12), '卡片内操作按钮齐全', $$('.mob-actions .btn').length);

  /* ---------- 8. 考试流程 ---------- */
  click('[data-nav="exam"]');
  await waitFor(() => $('#e-bank'), 2000);
  ok(!!$('#e-bank') && !!$('#e-count'), '考试启动器渲染');
  click('[data-act="start-exam"]');
  ok(await waitFor(() => $('#exam-timer'), 3000), '考试会话启动并显示倒计时');
  ok(/^29:\d\d$|^30:00$/.test(text('#exam-timer')), '倒计时初值约 30 分钟', text('#exam-timer'));
  // 答 3 题
  const ex = window.__quiz.exam;
  ok(ex && ex.questions.length === 20, '默认抽 20 题', ex && ex.questions.length);
  for (let i = 0; i < 3; i++) {
    click($$('[data-act="e-jump"]')[i]);
    await sleep(80);
    const oq = ex.questions[ex.idx];
    if (oq.qtype !== 'fill') click('.opt');
    await sleep(60);
  }
  ok(Object.keys(ex.answers).length >= 3, '考试中作答被记录', Object.keys(ex.answers).length);
  click('[data-act="submit-exam"]');
  await waitFor(() => $('#confirm-submit'), 2000);
  ok(!!$('#confirm-submit'), '交卷前有确认弹窗');
  click('#confirm-submit');
  ok(await waitFor(() => $('.score-ring'), 3000), '交卷后显示得分环形图');
  const scoreTxt = text('.score-ring .n');
  ok(/^\d+(\.\d+)?$/.test(scoreTxt), '得分是数字', scoreTxt);
  ok(window.__quiz.state.exams.length === 1, '考试记录已保存', window.__quiz.state.exams.length);
  const savedExam = window.__quiz.state.exams[0];
  ok(savedExam.total > 0 && savedExam.total <= 20, '考试记录题目数合理', savedExam.total);
  click('[data-act="close-exam-result"]');
  await sleep(200);

  /* ---------- 9. 统计页 ---------- */
  click('[data-nav="stats"]');
  await waitFor(() => $('.chart'), 2000);
  ok($$('.chart .bar-wrap').length === 14, '统计页近 14 天柱状图', $$('.chart .bar-wrap').length);
  const statTxt = $$('.stat .v').map(e => e.textContent.trim());
  ok(statTxt.includes('1239'), '统计页题目总数 1239', statTxt.join('/'));
  ok($$('.dist-row').length === 4, '题型分布 4 行');
  ok($$('.mob-list .mob-card').length >= 1, '统计页按题库有移动卡片', $$('.mob-list .mob-card').length);
  ok($$('.desk-only table.data').length >= 1, '统计页保留桌面表格');
  const persisted = JSON.parse(window.localStorage.getItem('quizmaster.web.v1') || '{}');
  ok((persisted.records || []).length > 0, 'localStorage 已持久化作答记录', (persisted.records || []).length);
  ok((persisted.exams || []).length === 1, 'localStorage 已持久化考试记录');

  /* ---------- 9c. 看题（带答案）· 单题滑动 ---------- */
  click('[data-nav="browse"]');
  ok(await waitFor(() => $('#b-swipe'), 3000), '看题页渲染单题滑动容器');
  ok($$('.b-card').length === 1, '看题页一次只显示一题', $$('.b-card').length);
  const meta0 = text('.swipe-meta .num-chip');
  ok(/第 1 \/ \d+ 题/.test(meta0), '显示题号指示', meta0);
  ok($$('.b-card .opt.correct').length > 0, '选项高亮正确答案');
  ok($$('.b-card .result-line').length > 0, '显示答案行');
  const stem0 = text('.b-card .stem');
  click('[data-act="browse-next"]');
  await sleep(220);
  const meta1 = text('.swipe-meta .num-chip');
  ok(meta1 !== meta0, '点「下一题」切题', meta0 + ' -> ' + meta1);
  ok(text('.b-card .stem') !== stem0, '题干随之切换');
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await sleep(180);
  ok(text('.swipe-meta .num-chip') !== meta1, '方向键 → 也能切题');
  // 触摸左滑
  const shell = $('#b-swipe');
  const beforeSwipe = text('.swipe-meta .num-chip');
  const t1 = new window.Event('touchstart', { bubbles: true });
  t1.changedTouches = [{ clientX: 320, clientY: 300 }];
  shell.dispatchEvent(t1);
  const t2 = new window.Event('touchend', { bubbles: true });
  t2.changedTouches = [{ clientX: 140, clientY: 305 }];
  shell.dispatchEvent(t2);
  await sleep(220);
  ok(text('.swipe-meta .num-chip') !== beforeSwipe, '手指左滑切到下一题', beforeSwipe + ' -> ' + text('.swipe-meta .num-chip'));
  // 右滑回上一题
  const beforeBack = text('.swipe-meta .num-chip');
  const t3 = new window.Event('touchstart', { bubbles: true });
  t3.changedTouches = [{ clientX: 120, clientY: 300 }];
  shell.dispatchEvent(t3);
  const t4 = new window.Event('touchend', { bubbles: true });
  t4.changedTouches = [{ clientX: 320, clientY: 305 }];
  shell.dispatchEvent(t4);
  await sleep(220);
  ok(text('.swipe-meta .num-chip') !== beforeBack, '手指右滑回到上一题');
  // 隐藏答案
  click('[data-act="browse-answer"]');
  await sleep(180);
  ok($$('.b-card .result-line').length === 0, '隐藏答案后不显示答案行');
  click('[data-act="browse-answer"]');
  await sleep(150);
  // 关键词搜索
  const kwEl = $('#b-kw');
  ok(!!kwEl, '看题页有搜索框');
  kwEl.value = '分词';
  kwEl.dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(420);
  const kwMeta = text('.swipe-meta .num-chip');
  const kwTotal = Number((kwMeta.match(/\/ (\d+) 题/) || [0, 0])[1]);
  ok(kwTotal > 0 && kwTotal < 60, '搜索后结果条数减少', kwMeta);
  ok(/第 1 \//.test(kwMeta), '搜索后回到第 1 题', kwMeta);
  // 题型筛选
  click('[data-act="browse-type"][data-key="judge"]');
  await sleep(250);
  const judgeMeta = text('.swipe-meta .num-chip');
  const judgeTotal = Number((judgeMeta.match(/\/ (\d+) 题/) || [0, 0])[1]);
  ok($$('.b-card .badge').length && text('.b-card .badge').indexOf('判断') >= 0, '筛选后当前题为判断题', text('.b-card .badge'));
  ok(judgeTotal > 0 && judgeTotal < kwTotal, '叠加题型筛选后条数更少', judgeMeta);
  click('[data-act="browse-type"][data-key="judge"]');
  await sleep(180);

  /* ---------- 9c2. 看题进度记忆 ---------- */
  click('[data-act="browse-next"]');
  await sleep(220);
  const savedBrowse = JSON.parse(window.localStorage.getItem('quizmaster.web.browse.v1') || 'null');
  ok(savedBrowse && savedBrowse.pos > 0, '看题进度写入 localStorage', savedBrowse && savedBrowse.pos);
  const posNow = text('.swipe-meta .num-chip');
  const dom5 = new JSDOM(INLINE_HTML, {
    url: 'https://xp-kon.github.io/test/', runScripts: 'dangerously',
    pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(DATA) });
      w.scrollTo = () => {};
      w.localStorage.setItem('quizmaster.web.v1', JSON.stringify(persisted));
      w.localStorage.setItem('quizmaster.web.browse.v1', JSON.stringify(savedBrowse));
    }
  });
  const w5 = dom5.window;
  await waitFor(() => w5.document.querySelectorAll('.stat').length === 5, 5000);
  w5.document.querySelector('[data-nav="browse"]').dispatchEvent(new w5.MouseEvent('click', { bubbles: true }));
  ok(await waitFor(() => w5.document.querySelector('#b-swipe'), 2500), '重进看题页可渲染');
  const meta5 = w5.document.querySelector('.swipe-meta .num-chip').textContent.trim();
  ok(meta5 === posNow, '看题位置已恢复到上次', posNow + ' / ' + meta5);
  const kw5 = w5.document.querySelector('#b-kw');
  ok(kw5 && kw5.value === savedBrowse.keyword, '搜索关键词一并恢复', kw5 && kw5.value);
  const bank5 = w5.document.querySelector('#b-bank');
  ok(bank5 && Number(bank5.value) === savedBrowse.bankId, '题库选择一并恢复', bank5 && bank5.value);
  ok(!!w5.document.querySelector('[data-act="browse-first"]'), '提供「回到第 1 题」');
  w5.document.querySelector('[data-act="browse-first"]').dispatchEvent(new w5.MouseEvent('click', { bubbles: true }));
  await sleep(200);
  ok(/第 1 \//.test(w5.document.querySelector('.swipe-meta .num-chip').textContent), '点回到第 1 题生效');

  /* ---------- 9d. 填空题分空作答 ---------- */
  click('[data-nav="practice"]');
  await waitFor(() => $('#p-bank'), 2500);
  if ($('[data-act="discard-session"]')) { click('[data-act="discard-session"]'); await sleep(150); }
  // 选一个含「多空填空题」的题库再开始
  const mlBank = DATA.banks.filter(b => b.questions.some(q => q.qtype === 'fill' && window.QuizLogic.blankCount(q.stem) >= 2))[0];
  ok(!!mlBank, '存在含多空填空题的题库', mlBank && mlBank.name);
  if (mlBank && $('#p-bank')) { $('#p-bank').value = String(mlBank.id); }
  click('[data-act="start-practice"]');
  await waitFor(() => $('.q-card'), 3000);
  const pNow = window.__quiz.practice;
  const multiBlankIdx = pNow.questions.findIndex(q =>
    q.qtype === 'fill' && window.QuizLogic.blankCount(q.stem) >= 2);
  ok(multiBlankIdx >= 0, '题库中存在多空填空题', multiBlankIdx);
  if (multiBlankIdx >= 0) {
    click($$('.nav-grid .cell')[multiBlankIdx]);
    await sleep(200);
    const inputs = $$('[data-blank]');
    const wantBlanks = window.QuizLogic.blankCount(pNow.questions[pNow.idx].stem);
    ok(inputs.length === wantBlanks, '按空位数量渲染独立输入框', inputs.length + '/' + wantBlanks);
    inputs.forEach((inp, i) => {
      inp.value = '我的第' + (i + 1) + '空';
      inp.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    click('[data-act="confirm"]');
    await sleep(220);
    const refs = $$('.blank-ref');
    ok(refs.length >= wantBlanks, '提交后逐空展示参考答案', refs.length);
    ok($$('.blank-ref .blank-ans').length >= wantBlanks, '每个空都有参考文本');
    ok(!!$('[data-act="self-ok"]'), '多空提交后仍可自评');
    click('[data-act="self-ok"]');
    await sleep(200);
    const fillRec = window.__quiz.state.records.filter(r => r.qid === pNow.questions[multiBlankIdx].id).pop();
    ok(fillRec && /；/.test(fillRec.sel), '多空作答按「；」拼接入库', fillRec && fillRec.sel);
  }

  /* ---------- 9e. 练习进度记忆 ---------- */
  const savedSess = JSON.parse(window.localStorage.getItem('quizmaster.web.session.v1') || 'null');
  ok(savedSess && savedSess.qids && savedSess.qids.length > 0, '练习进度已写入 localStorage', savedSess && savedSess.qids.length);
  ok(savedSess && savedSess.idx > 0, '记录了当前题号', savedSess && savedSess.idx);
  const dom4 = new JSDOM(INLINE_HTML, {
    url: 'https://xp-kon.github.io/test/', runScripts: 'dangerously',
    pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(DATA) });
      w.scrollTo = () => {};
      w.localStorage.setItem('quizmaster.web.v1', JSON.stringify(persisted));
      w.localStorage.setItem('quizmaster.web.session.v1', JSON.stringify(savedSess));
    }
  });
  const w4 = dom4.window;
  await waitFor(() => w4.document.querySelectorAll('.stat').length === 5, 5000);
  const navP = w4.document.querySelector('[data-nav="practice"]');
  navP.dispatchEvent(new w4.MouseEvent('click', { bubbles: true }));
  const hasResume = await waitFor(() => w4.document.querySelector('[data-act="resume-practice"]'), 2500);
  ok(hasResume, '重进练习页出现「继续练习」卡片');
  if (!hasResume) {
    console.log('    DEBUG sess=' + (w4.localStorage.getItem('quizmaster.web.session.v1') || 'null').slice(0, 120));
    console.log('    DEBUG main=' + (w4.document.querySelector('#main') || { innerHTML: '' }).innerHTML.slice(0, 160));
  }
  const resumeCardTxt = w4.document.querySelector('.resume-card') ? w4.document.querySelector('.resume-card').textContent : '';
  ok(/停在第 \d+ \/ \d+ 题/.test(resumeCardTxt), '显示停留位置', resumeCardTxt.slice(0, 40));
  const resumeBtn = w4.document.querySelector('[data-act="resume-practice"]');
  resumeBtn.dispatchEvent(new w4.MouseEvent('click', { bubbles: true }));
  ok(await waitFor(() => w4.document.querySelector('.q-card'), 3000), '点击继续后进入练习会话');
  const resumed = w4.__quiz.practice;
  ok(resumed && resumed.idx === savedSess.idx, '恢复到上次的题号', resumed && (resumed.idx + '/' + savedSess.idx));
  ok(resumed && Object.keys(resumed.graded).length >= 1, '已作答记录一并恢复', resumed && Object.keys(resumed.graded).length);

  /* ---------- 10. 刷新后进度保留 ---------- */
  const dom2 = new JSDOM(INLINE_HTML, {
    url: 'https://xp-kon.github.io/test/', runScripts: 'dangerously',
    pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(DATA) });
      w.scrollTo = () => {};
      w.localStorage.setItem('quizmaster.web.v1', JSON.stringify(persisted));
    }
  });
  const ok2 = await waitFor(() => dom2.window.document.querySelectorAll('.stat').length === 5, 5000);
  const accText = ok2 ? Array.from(dom2.window.document.querySelectorAll('.stat .v')).map(e => e.textContent.trim()) : [];
  ok(ok2 && accText.some(t => /%/.test(t)), '刷新后首页仍显示正确率（进度已恢复）', accText.join('/'));

  /* ---------- 9b. 窄屏（420px）统计页 ---------- */
  const dom3 = new JSDOM(INLINE_HTML, {
    url: 'https://xp-kon.github.io/test/', runScripts: 'dangerously',
    pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(DATA) });
      w.scrollTo = () => {};
      Object.defineProperty(w, 'innerWidth', { value: 420, configurable: true });
      w.localStorage.setItem('quizmaster.web.v1', JSON.stringify(persisted));
    }
  });
  const w3 = dom3.window;
  const ok3 = await waitFor(() => w3.document.querySelectorAll('.stat').length === 5, 5000);
  ok(ok3, '窄屏：首页渲染');
  const navBtn = Array.from(w3.document.querySelectorAll('[data-nav="stats"]'))[0];
  navBtn.dispatchEvent(new w3.MouseEvent('click', { bubbles: true }));
  ok(await waitFor(() => w3.document.querySelector('.chart'), 2500), '窄屏：统计页渲染');
  const bars = w3.document.querySelectorAll('.chart .bar-wrap').length;
  ok(bars === 7, '窄屏统计图只画 7 天（不挤成一条线）', bars);
  const titleTxt = w3.document.querySelector('.card-title').textContent;
  ok(/近 7 天作答/.test(titleTxt), '窄屏标题显示「近 7 天作答」', titleTxt);
  ok(w3.document.querySelectorAll('.mob-list .mob-card').length >= 1, '窄屏：按题库为移动卡片');
  ok(w3.document.querySelectorAll('.desk-only').length >= 1, '窄屏：桌面容器仍在 DOM（由 CSS 隐藏）');

  /* ---------- 9f. 错题重练：全部答对后「完成练习」必须有响应 ---------- */
  const st6 = window.__quiz.state;
  const wq = window.__quiz.data.banks[0].questions.filter(q => q.qtype === 'single').slice(0, 2);
  wq.forEach(q => L.recordAnswer(st6, q, (q.answer === 'A' ? 'B' : 'A'), false, 'practice'));
  L.saveState(window.localStorage, st6);
  click('[data-nav="wrong"]');
  await sleep(250);
  click('[data-act="list-practice"]');
  await sleep(250);
  const P6 = window.__quiz.practice;
  ok(P6 && P6.questions.length >= 2, '错题重练会话已建立', P6 && P6.questions.length);
  for (let i = 0; i < P6.questions.length; i++) {
    const q = P6.questions[P6.idx];
    const right = q.qtype === 'judge' ? (q.answer === '对' ? 'A' : 'B') : q.answer.split('')[0];
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: right, bubbles: true }));
    await sleep(820);
  }
  ok(!!$('[data-act="finish-practice"]'), '最后一题答对后仍停留在题目页');
  click('[data-act="finish-practice"]');
  await sleep(320);
  ok(!!$('.mask') && /本次练习完成/.test(text('.modal header')), '点击完成练习弹出练习总结', text('.modal header'));
  const closeBtn = $('[data-act="close-practice-result"]');
  if (closeBtn) { click(closeBtn); await sleep(200); }
  ok(!!$('#p-bank'), '关闭总结后回到练习启动器');

  /* ---------- 汇总 ---------- */
  ok(jsErrors.length === 0, '无 JS 运行时错误', jsErrors.slice(0, 3).join(' | '));
  console.log('PASS ' + pass + ' FAIL ' + fail);
  if (fail) { fails.slice(0, 15).forEach(f => console.log('  FAIL: ' + f)); process.exit(1); }
  process.exit(0);
})().catch(e => {
  fails.slice(0, 12).forEach(f => console.log('  FAIL: ' + f));
  console.log('PASS ' + pass + ' FAIL ' + (fail + 1));
  console.log('  FAIL: 脚本异常 ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
  process.exit(1);
});