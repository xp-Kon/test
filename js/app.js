/*!
 * 智题 Web 版 · 界面层
 * 页面结构对齐桌面版：首页 / 题库 / 练习 / 考试 / 错题本 / 收藏 / 统计
 */
(function () {
  'use strict';
  var L = window.QuizLogic;
  var main = document.getElementById('main');
  var modalHost = document.getElementById('modal-host');
  var toastHost = document.getElementById('toast-host');

  var store = {
    getItem: function (k) { try { return localStorage.getItem(k); } catch { return null; } },
    setItem: function (k, v) { try { localStorage.setItem(k, v); } catch { toast('存储空间不足，进度可能未保存'); } }
  };

  var App = {
    data: { banks: [] },
    state: L.emptyState(),
    page: 'home',
    practice: null,
    exam: null
  };
  window.__quiz = App;   // 便于调试与自动化检查

  /* ---------------- 工具 ---------------- */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtPct(n) { return (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '') + '%'; }
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function fmtDate(ts) {
    var d = new Date(ts);
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function toast(msg) {
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    toastHost.appendChild(el);
    setTimeout(function () { el.remove(); }, 1900);
  }
  function save() { L.saveState(store, App.state); }
  function banks() { return L.allBanks(App.data, App.state); }
  function qOf(qid) { return L.findQuestion(banks(), qid); }
  function qOfMap() {
    var m = {};
    banks().forEach(function (b) { (b.questions || []).forEach(function (q) { m[q.id] = q; }); });
    return m;
  }
  function typeBadge(q) {
    var c = L.TYPE_COLORS[q.qtype] || ['#F3F4FA', '#697086'];
    return '<span class="badge" style="background:' + c[0] + ';color:' + c[1] + '">' + esc(L.TYPE_NAMES[q.qtype] || q.qtype) + '</span>';
  }
  function lettersOf(q) {
    var n = q.qtype === 'judge' ? 2 : (q.options || []).length;
    return L.LETTERS.slice(0, Math.max(0, Math.min(8, n))).split('');
  }
  function answerText(q) {
    if (q.qtype === 'judge') return q.answer;
    if (q.qtype === 'fill') return q.answer;
    return (q.answer || '').split('').join(' ');
  }
  function hasBank() { return banks().length > 0; }

  /* ---------------- 路由 ---------------- */
  function route(page) {
    App.page = page || 'home';
    if (App.page !== 'practice' && App.page !== 'exam') { App.practice = App.practice && App.page === 'practice' ? App.practice : null; }
    document.querySelectorAll('.nav-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.nav === App.page);
    });
    render();
  }
  function render() {
    var p = App.page;
    if (p === 'home') return renderHome();
    if (p === 'banks') return renderBanks();
    if (p === 'practice') return renderPractice();
    if (p === 'browse') return renderBrowse();
    if (p === 'exam') return renderExam();
    if (p === 'wrong') return renderList('wrong');
    if (p === 'fav') return renderList('fav');
    if (p === 'stats') return renderStats();
    return renderHome();
  }
  function updateCounters() {
    var st = App.state;
    var nb = document.getElementById('nav-banks');
    var nw = document.getElementById('nav-wrong');
    var nf = document.getElementById('nav-fav');
    if (nb) nb.textContent = banks().length;
    if (nw) nw.textContent = L.activeWrongIds(st).length;
    if (nf) nf.textContent = Object.keys(st.favs).length;
  }

  /* ---------------- 首页 ---------------- */
  function renderHome() {
    var ov = L.overview(App.data, App.state);
    var bs = L.bankStats(banks(), App.state);
    var exams = App.state.exams.slice(-5).reverse();
    var html = '' +
      '<div class="page-head"><div><div class="page-title">开始今天的刷题吧</div>' +
      '<div class="page-sub">' + (ov.questions ? '共 ' + ov.questions + ' 道题 · 已练 ' + ov.practiced + ' 道 · 连续打卡 ' + L.streakDays(App.state) + ' 天' : '题库准备好了，先导入或直接开始练习') + '</div></div>' +
      '<div class="row"><button class="btn primary" data-act="quick-practice">开始练习</button>' +
      '<button class="btn ghost" data-act="quick-exam">模拟考试</button></div></div>' +
      '<div class="stat-row">' + statCard('题库数量', ov.banks, '已导入的题库', 'var(--primary)') +
      statCard('题目总数', ov.questions, '全部题库累计', 'var(--violet)') +
      statCard('累计作答', ov.answers, '练习与考试总计', 'var(--blue)') +
      statCard('总正确率', ov.answers ? fmtPct(ov.accuracy) : '—', '按作答次数统计', 'var(--green)') +
      statCard('待消灭错题', ov.wrong, '错题本剩余', 'var(--red)') + '</div>';

    html += '<div class="card" style="margin-top:14px"><div class="card-title">我的题库</div>';
    if (!bs.length) {
      html += '<div class="empty"><b>还没有题库</b>前往「题库管理」导入 CSV / TXT，或用构建脚本把 xlsx 转成静态题库</div>';
    } else {
      html += '<div class="bank-grid">';
      bs.forEach(function (b) {
        html += '<div class="bank-card">' +
          '<div class="bank-name">' + esc(b.name) + '</div>' +
          '<div class="chips"><span class="chip">共 ' + b.count + ' 题</span>' +
          '<span class="chip">已练 ' + b.practiced + '</span>' +
          '<span class="chip">正确率 ' + (b.attempts ? fmtPct(b.accuracy) : '—') + '</span>' +
          (b.wrong ? '<span class="chip" style="background:var(--red-bg);color:#B91C1C">错题 ' + b.wrong + '</span>' : '') + '</div>' +
          '<div class="row" style="margin-top:4px">' +
          '<button class="btn mini" data-act="bank-practice" data-id="' + b.id + '">练习</button>' +
          '<button class="btn mini ghost" data-act="bank-exam" data-id="' + b.id + '">考试</button>' +
          '</div></div>';
      });
      html += '</div>';
    }
    html += '</div>';

    if (exams.length) {
      html += '<div class="card" style="margin-top:14px"><div class="card-title">最近的考试</div>' +
        '<table class="exam-table"><thead><tr><th>考试</th><th>题数</th><th>得分</th><th>用时</th><th>时间</th></tr></thead><tbody>';
      exams.forEach(function (e) {
        html += '<tr><td>' + esc(e.title) + '</td><td>' + e.total + '</td><td><b>' + e.score + '</b></td>' +
          '<td>' + fmtTime(e.duration) + '</td><td class="muted">' + fmtDate(e.ts) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    main.innerHTML = html;
    updateCounters();
  }
  function statCard(title, value, sub, color) {
    return '<div class="stat"><div class="k">' + title + '</div>' +
      '<div class="v" style="color:' + color + '">' + value + '</div><div class="s">' + sub + '</div></div>';
  }

  /* ---------------- 题库管理 ---------------- */
  function renderBanks() {
    var bs = L.bankStats(banks(), App.state);
    var html = '<div class="page-head"><div><div class="page-title">题库管理</div>' +
      '<div class="page-sub">查看题目构成、导入新题库、清理不需要的题库</div></div>' +
      '<button class="btn primary" data-act="open-import">导入题库</button></div>';
    if (!bs.length) {
      html += '<div class="empty"><b>还没有题库</b>支持 CSV / TXT（UTF-8 或 GBK 的文本）；xlsx 可用 tools/build_static_data.py 预转</div>';
    } else {
      html += '<div class="card"><div class="table-wrap desk-only"><table class="data"><thead><tr>' +
        '<th>题库</th><th class="num">总题数</th><th class="num">单选</th><th class="num">多选</th><th class="num">判断</th><th class="num">填空/简答</th>' +
        '<th class="num">已练</th><th class="num">正确率</th><th class="num">错题</th><th class="num">收藏</th><th>操作</th></tr></thead><tbody>';
      bs.forEach(function (b) {
        var removable = b.source && b.source.indexOf('imported:') === 0;
        html += '<tr><td><b>' + esc(b.name) + '</b><div class="muted">' + esc(b.source || '内置题库') + '</div></td>' +
          '<td class="num">' + b.count + '</td><td class="num">' + b.single + '</td><td class="num">' + b.multiple + '</td>' +
          '<td class="num">' + b.judge + '</td><td class="num">' + b.fill + '</td>' +
          '<td class="num">' + b.practiced + '</td><td class="num">' + (b.attempts ? fmtPct(b.accuracy) : '—') + '</td>' +
          '<td class="num">' + (b.wrong || 0) + '</td><td class="num">' + (b.favorites || 0) + '</td>' +
          '<td><div class="row" style="gap:6px;flex-wrap:nowrap">' +
          '<button class="btn mini" data-act="bank-practice" data-id="' + b.id + '">练习</button>' +
          '<button class="btn mini ghost" data-act="bank-exam" data-id="' + b.id + '">考试</button>' +
          '<button class="btn mini ghost" data-act="bank-rename" data-id="' + b.id + '">改名</button>' +
          (removable ? '<button class="btn mini danger" data-act="bank-del" data-id="' + b.id + '">删除</button>' : '') +
          '</div></td></tr>';
      });
      html += '</tbody></table></div>' + mobBankCards(bs) + '</div>';
    }
    html += '<div class="card" style="margin-top:14px"><div class="card-title">导入说明</div>' +
      '<div class="muted" style="line-height:1.9">' +
      '· 支持 <b>CSV / TXT</b>，表头建议：<code>题型,题干,选项A,选项B,选项C,选项D,答案,解析</code>；无表头时自动探测题干列与答案列。<br>' +
      '· 判断题答案写 <code>对/错</code> 或 <code>A/B</code>；多选题答案写 <code>ABD</code>；填空题答案可写 <code>（1）…；（2）…</code>。<br>' +
      '· <b>xlsx / docx</b>：静态站无法直接解析 Office 压缩包，请用仓库内 <code>tools/build_static_data.py</code> 生成 <code>data/banks.json</code>。' +
      '</div></div>';
    main.innerHTML = html;
    updateCounters();
  }

  /* 移动端：题库表改成卡片列表（手机上宽表无法阅读） */
  function mobBankCards(bs) {
    var html = '<div class="mob-only mob-list">';
    bs.forEach(function (b) {
      var removable = b.source && b.source.indexOf('imported:') === 0;
      html += '<div class="mob-card">' +
        '<div class="mob-title">' + esc(b.name) + '</div>' +
        '<div class="muted" style="font-size:11px;margin-bottom:8px;word-break:break-all">' + esc(b.source || '内置题库') + '</div>' +
        '<div class="mob-kv">' +
        '<span>总题数<b>' + b.count + '</b></span>' +
        '<span>已练<b>' + b.practiced + '</b></span>' +
        '<span>正确率<b>' + (b.attempts ? fmtPct(b.accuracy) : '—') + '</b></span>' +
        '<span>错题<b style="color:var(--red)">' + (b.wrong || 0) + '</b></span>' +
        '</div>' +
        '<div class="muted" style="font-size:11.5px;margin:6px 0 10px">' +
        (b.flagged ? '<span style="color:#B45309">⚠ ' + b.flagged + ' 道选项待校对 · </span>' : '') +
        '单选 ' + b.single + ' · 多选 ' + b.multiple +
        ' · 判断 ' + b.judge + ' · 填空/简答 ' + b.fill + ' · 收藏 ' + (b.favorites || 0) + '</div>' +
        '<div class="mob-actions">' +
        '<button class="btn mini" data-act="bank-practice" data-id="' + b.id + '">练习</button>' +
        '<button class="btn mini ghost" data-act="bank-exam" data-id="' + b.id + '">考试</button>' +
        '<button class="btn mini ghost" data-act="bank-rename" data-id="' + b.id + '">改名</button>' +
        (removable ? '<button class="btn mini danger" data-act="bank-del" data-id="' + b.id + '">删除</button>' : '') +
        '</div></div>';
    });
    return html + '</div>';
  }

  function openImport() {
    var html = '<div class="modal"><header>导入题库</header><div class="body">' +
      '<div class="field"><label>题库名称</label><input type="text" id="imp-name" placeholder="留空则用文件名"></div>' +
      '<div class="field" style="margin-top:12px"><label>选择文件（.csv / .txt）</label><input type="file" id="imp-file" accept=".csv,.txt,text/plain,text/csv"></div>' +
      '<div id="imp-result" style="margin-top:14px"></div></div>' +
      '<footer><button class="btn ghost" data-act="close-modal">取消</button>' +
      '<button class="btn primary" data-act="do-import" id="imp-go" disabled>确认导入</button></footer></div>';
    showModal(html);
    var fileInput = document.getElementById('imp-file');
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result || '');
        var rows = L.parseDelimited(text);
        var warnings = [];
        var nextId = (App.state.seq || 1);
        var qs = L.questionsFromRows(rows, nextId, warnings);
        qs = L.dedupe(qs, warnings);
        var box = document.getElementById('imp-result');
        var types = {};
        qs.forEach(function (q) { types[q.qtype] = (types[q.qtype] || 0) + 1; });
        box.innerHTML = '<div class="card" style="box-shadow:none;padding:14px">' +
          '<div><b>识别到 ' + qs.length + ' 道题</b> <span class="muted">' +
          Object.keys(types).map(function (k) { return (L.TYPE_NAMES[k] || k) + ' ' + types[k]; }).join(' · ') + '</span></div>' +
          (warnings.length ? '<ul class="warn-list">' + warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '') +
          (qs.length ? '<div class="muted" style="margin-top:10px">示例：' + esc(qs[0].stem.slice(0, 48)) + (qs[0].stem.length > 48 ? '…' : '') + '</div>' : '') +
          '</div>';
        document.getElementById('imp-go').disabled = !qs.length;
      };
      reader.readAsText(f, 'utf-8');
    });
  }

  function doImport() {
    var input = document.getElementById('imp-file');
    var f = input && input.files && input.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      var rows = L.parseDelimited(String(reader.result || ''));
      var warnings = [];
      var nextId = App.state.seq || 1;
      var qs = L.questionsFromRows(rows, nextId, warnings);
      qs = L.dedupe(qs, warnings);
      if (!qs.length) { toast('没有识别到题目'); return; }
      var name = (document.getElementById('imp-name').value || f.name.replace(/\.[^.]+$/, '') || '未命名题库').slice(0, 60);
      var bankId = Math.max.apply(null, [0].concat(banks().map(function (b) { return b.id; }))) + 1;
      App.state.imported.push({
        id: bankId, name: name, source: 'imported:' + f.name,
        created_at: fmtDate(Date.now()), questions: qs
      });
      App.state.seq = nextId + qs.length;
      save();
      closeModal();
      toast('已导入 ' + qs.length + ' 道题');
      renderBanks();
    };
    reader.readAsText(f, 'utf-8');
  }


  /* ---------------- 练习进度记忆 ---------------- */
  var SESSION_KEY = 'quizmaster.web.session.v1';

  function saveSession() {
    var P = App.practice;
    if (!P) return;
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        qids: P.questions.map(function (q) { return q.id; }),
        idx: P.idx, mode: P.mode, title: P.title, label: P.label,
        graded: P.graded, drafts: P.drafts, results: P.results,
        updatedAt: Date.now()
      }));
    } catch { /* 存储满时忽略 */ }
  }

  function loadSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || !Array.isArray(s.qids) || !s.qids.length) return null;
      return s;
    } catch { return null; }
  }

  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }

  function sessionSummary() {
    var s = loadSession();
    if (!s) return null;
    return {
      raw: s,
      total: s.qids.length,
      pos: Math.min((s.idx || 0) + 1, s.qids.length),
      answered: Object.keys(s.graded || {}).length,
      title: s.title || '上次练习',
      label: s.label || '练习',
      updatedAt: s.updatedAt || 0
    };
  }

  function resumePractice() {
    var s = loadSession();
    if (!s) { toast('没有可恢复的练习'); return; }
    var map = qOfMap();
    var qs = [];
    s.qids.forEach(function (id) { if (map[id]) qs.push(map[id]); });
    if (!qs.length) { clearSession(); toast('上次练习的题目已不存在'); render(); return; }
    var idx = Math.min(Math.max(0, s.idx || 0), qs.length - 1);
    App.practice = {
      questions: qs, idx: idx, mode: s.mode || 'practice',
      graded: s.graded || {}, drafts: s.drafts || {}, results: s.results || [],
      title: s.title || '继续练习', label: s.label || '练习', bank: null
    };
    route('practice');
  }

  /* ---------------- 练习 ---------------- */
  function bankOptions(selected) {
    return banks().map(function (b) {
      return '<option value="' + b.id + '"' + (selected === b.id ? ' selected' : '') + '>' + esc(b.name) + '（' + (b.questions || []).length + ' 题）</option>';
    }).join('');
  }

  function renderPractice() {
    if (App.practice) return renderPracticeSession();
    return renderPracticeLauncher();
  }

  function renderPracticeLauncher(presetBank) {
    var selBank = presetBank || (App.lastBankId || (banks()[0] && banks()[0].id));
    var resumeInfo = sessionSummary();
    var resumeHtml = '';
    if (resumeInfo) {
      resumeHtml = '<div class="card resume-card" style="margin-bottom:14px;border-color:var(--primary)">' +
        '<div class="row"><div style="flex:1;min-width:0">' +
        '<div class="card-title" style="margin-bottom:4px">继续上次练习</div>' +
        '<div class="muted">' + esc(resumeInfo.title) + ' · ' + esc(resumeInfo.label) +
        ' · 停在第 ' + resumeInfo.pos + ' / ' + resumeInfo.total + ' 题 · 已作答 ' + resumeInfo.answered + ' 题' +
        (resumeInfo.updatedAt ? ' · ' + fmtDate(resumeInfo.updatedAt) : '') + '</div></div>' +
        '<div class="row" style="flex:none">' +
        '<button class="btn primary" data-act="resume-practice">继续练习</button>' +
        '<button class="btn ghost" data-act="discard-session">重新开始</button>' +
        '</div></div></div>';
    }
    var mode = App.lastMode || 'normal';
    var scope = App.lastScope || 'all';
    var html = resumeHtml + '<div class="page-head"><div><div class="page-title">刷题练习</div>' +
      '<div class="page-sub">选择题库与练习方式，随时开始随时暂停</div></div></div>' +
      '<div class="card">' +
      '<div class="field"><label>选择题库</label><select id="p-bank">' + bankOptions(selBank) + '</select></div>' +
      '<div class="field" style="margin-top:16px"><label>练习方式</label><div class="mode-grid" id="p-mode">' +
      modeCard('normal', '顺序练习', '按题库顺序作答，即时反馈对错', mode) +
      modeCard('random', '随机练习', '随机打乱顺序，巩固记忆', mode) +
      modeCard('back', '背题模式', '直接展示答案与解析，快速过题', mode) +
      '</div></div>' +
      '<div class="field" style="margin-top:16px"><label>题目范围</label><div class="row" id="p-scope">' +
      scopeRadio('all', '全部题目', scope) + scopeRadio('wrong', '只练错题', scope) + scopeRadio('fav', '只练收藏', scope) +
      '</div></div>' +
      '<div class="field" style="margin-top:16px"><label>题型筛选</label><div class="row" id="p-types">' +
      typeCheck('single', '单选题') + typeCheck('multiple', '多选题') + typeCheck('judge', '判断题') + typeCheck('fill', '填空/简答') +
      '</div></div>' +
      '<div class="row" style="margin-top:20px"><button class="btn primary" data-act="start-practice">开始练习</button>' +
      '<span class="muted">答对自动进入下一题，答错停留看解析 · A–H / 1–8 选择 · Enter 确认或下一题 · ← → 切题</span></div>' +
      '</div>';
    if (!hasBank()) html = '<div class="empty" style="margin-top:14px"><b>请先导入题库</b>前往「题库管理」导入文件</div>' + html;
    main.innerHTML = html;
    updateCounters();
  }

  function modeCard(key, title, desc, cur) {
    return '<button class="mode-card' + (key === cur ? ' on' : '') + '" data-act="pick-mode" data-key="' + key + '">' +
      '<span class="t">' + title + '</span><span class="d">' + desc + '</span></button>';
  }
  function scopeRadio(key, label, cur) {
    return '<label style="display:inline-flex;gap:6px;align-items:center;font-size:13px">' +
      '<input type="radio" name="scope" value="' + key + '"' + (key === cur ? ' checked' : '') + '>' + label + '</label>';
  }
  function typeCheck(key, label) {
    return '<label style="display:inline-flex;gap:6px;align-items:center;font-size:13px">' +
      '<input type="checkbox" name="qtype" value="' + key + '" checked>' + label + '</label>';
  }

  function startPractice(preset) {
    var bankSel = document.getElementById('p-bank');
    var bankId = preset ? preset.bankId : (bankSel ? Number(bankSel.value) : null);
    var modeKey = preset && preset.mode ? preset.mode : (App.lastMode || 'normal');
    var scope = preset && preset.scope ? preset.scope : (App.lastScope || 'all');
    var types = [];
    if (!preset || !preset.keepTypes) {
      document.querySelectorAll('input[name=qtype]').forEach(function (cb) { if (cb.checked) types.push(cb.value); });
      if (!types.length) types = null;
    } else types = null;
    var order = modeKey === 'random' ? 'random' : 'normal';
    var sess = L.buildSession({
      banks: banks(), state: App.state, bankId: bankId,
      scope: scope, order: order, types: types, limit: 0
    });
    if (!sess.questions.length) { toast('该范围内没有题目，换个筛选条件试试'); return; }
    App.lastBankId = bankId; App.lastMode = modeKey; App.lastScope = scope;
    clearSession();
    App.practice = {
      questions: sess.questions, idx: 0, bank: sess.bank,
      mode: modeKey === 'back' ? 'back' : 'practice',
      graded: {}, drafts: {}, results: [], title: sess.bank ? sess.bank.name : '练习',
      label: modeKey === 'back' ? '背题模式' : (modeKey === 'random' ? '随机练习' : '顺序练习')
    };
    render();
  }

  /* 未提交的半截作答按题缓存，切题不丢失（原版 _show_question 恒传 selected=None） */
  function draftOf(P, qid) {
    if (!P.drafts[qid]) P.drafts[qid] = { sel: '', text: '', parts: [] };
    return P.drafts[qid];
  }

  function renderPracticeSession() {
    var P = App.practice;
    if (!P) return renderPracticeLauncher();
    var q = P.questions[P.idx];
    var graded = P.graded[q.id];
    var draft = P.drafts[q.id] || { sel: '', text: '', parts: [] };
    var back = P.mode === 'back';
    var answered = Object.keys(P.graded).length;

    var html = '<div class="page-head"><div><div class="page-title">' + esc(P.title) + '</div>' +
      '<div class="page-sub">' + esc(P.label) + ' · 已作答 ' + answered + ' / ' + P.questions.length + '</div></div>' +
      '<div class="row"><span class="num-chip">' + (P.idx + 1) + ' / ' + P.questions.length + '</span>' +
      '<button class="btn ghost" data-act="exit-practice">退出练习</button>' +
      (back ? '' : '<button class="btn primary" data-act="finish-practice">完成练习</button>') + '</div></div>' +
      '<div class="progress" style="margin-bottom:14px"><i style="width:' + (answered / P.questions.length * 100) + '%"></i></div>';

    html += '<div class="practice-layout"><div>';
    html += '<div class="card q-card">' + questionHead(q, P.idx, P.questions.length);
    html += questionBody(q, {
      mode: back ? 'back' : 'practice',
      sel: graded ? graded.sel : draft.sel, graded: graded, fillText: draft.text, parts: draft.parts || [],
      favorite: !!App.state.favs[q.id]
    });
    html += '<div class="row" style="margin-top:18px">' +
      '<button class="btn ghost" data-act="prev" ' + (P.idx === 0 ? 'disabled' : '') + '>← 上一题</button>' +
      '<div class="spacer"></div>' +
      '<button class="btn primary" data-act="next">' + (P.idx === P.questions.length - 1 ? '完成练习' : '下一题 →') + '</button></div>';
    html += '</div></div>';

    html += '<div class="stack">' +
      '<div class="card"><div class="card-title">答题卡</div><div class="nav-grid" id="nav-grid">';
    P.questions.forEach(function (qq, i) {
      var g = P.graded[qq.id];
      var cls = 'cell' + (i === P.idx ? ' cur' : '') + (g ? (g.ok === null ? '' : (g.ok ? ' ok' : ' bad')) : '');
      html += '<button class="' + cls + '" data-act="jump" data-idx="' + i + '">' + (i + 1) + '</button>';
    });
    html += '</div><div class="muted" style="margin-top:10px">' + navStat(P) + '</div></div>' +
      '<div class="card"><div class="card-title">本题</div>' +
      '<div class="row" style="gap:8px"><button class="btn mini" data-act="fav">' + (App.state.favs[q.id] ? '★ 取消收藏' : '☆ 收藏本题') + '</button>' +
      (App.state.wrong[q.id] && !App.state.wrong[q.id].resolved ? '<span class="chip" style="background:var(--red-bg);color:#B91C1C">错 ' + App.state.wrong[q.id].count + ' 次</span>' : '') +
      '</div></div></div>';

    html += '</div>';
    main.innerHTML = html;
    updateCounters();
    var ta = document.getElementById('fill-input');
    if (ta && !graded) {
      ta.addEventListener('input', function () { draftOf(App.practice, q.id).text = ta.value; });
    }
    Array.prototype.forEach.call(document.querySelectorAll('[data-blank]'), function (input) {
      input.addEventListener('input', function () {
        var d = draftOf(App.practice, q.id);
        d.parts = d.parts || [];
        d.parts[Number(input.dataset.blank)] = input.value;
      });
    });
  }

  function navStat(P) {
    var ok = 0, bad = 0, pending = 0;
    Object.keys(P.graded).forEach(function (k) {
      var g = P.graded[k];
      if (g.ok === null) pending++; else if (g.ok) ok++; else bad++;
    });
    return '已作答 ' + (ok + bad + pending) + ' / ' + P.questions.length + ' · 答对 ' + ok + ' · 答错 ' + bad + (pending ? ' · 待自评 ' + pending : '');
  }


  function issueBadge(q) {
    if (!q || !q.issues || !q.issues.length) return '';
    return '<span class="chip" style="background:var(--amber-bg);color:#B45309" title="' +
      esc(q.issues.join(' / ')) + '">⚠ ' + esc(q.issues[0]) + '</span>';
  }

  function questionHead(q, idx, total) {
    return '<div class="q-head">' + typeBadge(q) + '<span class="num-chip">第 ' + (idx + 1) + ' 题 / 共 ' + total + '</span>' +
      issueBadge(q) + '</div>';
  }

  function questionBody(q, o) {
    var graded = o.graded || null;
    var answered = !!graded;
    var back = o.mode === 'back';
    var html = '<div class="stem">' + esc(q.stem) + '</div>';

    if (q.qtype === 'fill') {
      var nBlank = L.blankCount(q.stem);
      var refParts = L.splitFillAnswer(q.answer);
      var multiBlank = nBlank >= 2;
      if (!answered && !back) {
        if (multiBlank) {
          html += '<div class="blank-list">';
          for (var bi = 0; bi < nBlank; bi++) {
            html += '<label class="blank-row"><span class="blank-no">第 ' + (bi + 1) + ' 空</span>' +
              '<input type="text" class="blank-input" data-blank="' + bi + '" value="' +
              esc((o.parts || [])[bi] || '') + '" placeholder="填写第 ' + (bi + 1) + ' 空"></label>';
          }
          html += '</div>';
        } else {
          html += '<textarea class="fill-input" id="fill-input" placeholder="写下你的答案（可多行）">' + esc(o.fillText || '') + '</textarea>';
        }
        html += '<div class="row" style="margin-top:12px"><button class="btn primary" data-act="confirm">确认作答</button>' +
          '<span class="muted">' + (multiBlank ? '本题共 ' + nBlank + ' 个空，可逐空填写；提交后与参考答案逐空对照' : '填空/简答为主观题，提交后自评对错') + '</span></div>';
      } else {
        html += blankRefBox(q, graded, refParts, nBlank, multiBlank);
        if (back) {
          html += analysisBox(q);
        } else if (graded && graded.ok === null) {
          html += '<div class="row" style="margin-top:12px"><span class="muted">自评：这道题答对了吗？</span>' +
            '<button class="btn success" data-act="self-ok">我答对了</button>' +
            '<button class="btn danger" data-act="self-bad">我答错了</button></div>';
        } else {
          html += '<div class="row" style="margin-top:10px"><span class="result-line ' + (graded.ok ? 'ok' : 'bad') + '">' +
            (graded.ok ? '✓ 已记为答对' : '✗ 已记为答错') + '</span></div>' + analysisBox(q);
        }
      }
      return html;
    }

    var letters = lettersOf(q);
    var want = L.answerLetters(q);
    var selSet = {};
    L.normalizeSelection(o.sel).split('').forEach(function (c) { selSet[c] = 1; });
    if (answered && graded.sel) {
      selSet = {};
      L.normalizeSelection(graded.sel).split('').forEach(function (c) { selSet[c] = 1; });
    }
    letters.forEach(function (L0, i) {
      var picked = !!selSet[L0];
      var cls = 'opt';
      var label = q.options && q.options[i] !== undefined ? q.options[i] : '';
      if (back) {
        cls += want.indexOf(L0) >= 0 ? ' correct' : ' muted';
      } else if (answered) {
        if (want.indexOf(L0) >= 0) cls += ' correct';
        else if (picked) cls += ' wrong';
        else cls += ' muted';
      } else if (picked) cls += ' sel';
      html += '<button class="' + cls + '" data-act="opt" data-letter="' + L0 + '"' + (answered || back ? ' disabled' : '') + '>' +
        '<span class="letter">' + L0 + '</span><span>' + esc(label) + '</span></button>';
    });

    if (!answered && !back && q.qtype === 'multiple') {
      html += '<div class="row" style="margin-top:12px"><button class="btn primary" data-act="confirm">确认作答</button>' +
        '<span class="muted">多选题可点选多个选项</span></div>';
    }
    if (answered && !back) {
      html += '<div class="row" style="margin-top:6px"><span class="result-line ' + (graded.ok ? 'ok' : 'bad') + '">' +
        (graded.ok ? '✓ 回答正确' : '✗ 回答错误，正确答案：' + answerText(q)) + '</span></div>' + analysisBox(q);
    }
    if (back) html += '<div class="row" style="margin-top:6px"><span class="result-line" style="color:var(--primary-d)">正确答案：' + esc(answerText(q)) + '</span></div>' + analysisBox(q);
    return html;
  }


  /* 填空题参考答案：多空时逐空对照，单空时原样展示 */
  function blankRefBox(q, graded, refParts, nBlank, multiBlank) {
    var html = '';
    if (multiBlank && refParts.length >= 2) {
      var total = refParts.length;
      html += '<div class="analysis" style="background:#fff;border-style:dashed"><div class="h">参考答案 · 共 ' + total + ' 空</div>';
      for (var i = 0; i < total; i++) {
        var userPart = (graded && graded.parts ? graded.parts[i] : '') || '';
        var ref = refParts[i] || '';
        var match = userPart ? L.fillPartsEqual(userPart, ref) : false;
        html += '<div class="blank-ref"><span class="blank-no">第 ' + (i + 1) + ' 空</span>' +
          '<span class="blank-ans">' + esc(ref || '（未给出）') + '</span>' +
          (userPart ? '<span class="blank-mark ' + (match ? 'ok' : 'bad') + '">' + (match ? '✓ 一致' : '✗ ' + esc(userPart)) + '</span>' : '') +
          '</div>';
      }
      html += '</div>';
      if (total < nBlank) {
        html += '<div class="muted" style="margin-top:6px">题干识别到 ' + nBlank + ' 个空，参考答案只分出 ' + total + ' 段，已按参考答案展示</div>';
      }
    } else if (multiBlank) {
      html += '<div class="analysis" style="background:#fff;border-style:dashed"><div class="h">参考答案</div>' + esc(answerText(q)) +
        '<div class="muted" style="margin-top:6px">该题答案未按空分点，整段展示</div></div>';
    } else {
      html += '<div class="analysis" style="background:#fff;border-style:dashed"><div class="h">参考答案</div>' + esc(answerText(q)) + '</div>';
    }
    return html;
  }

  function analysisBox(q) {
    if (!q.analysis) return '';
    return '<div class="analysis"><div class="h">💡 解析</div>' + esc(q.analysis) + '</div>';
  }

  function pickOption(letter) {
    var P = App.practice;
    if (!P) return;
    var q = P.questions[P.idx];
    if (P.mode === 'back' || P.graded[q.id]) return;
    var draft = draftOf(P, q.id);
    if (q.qtype === 'multiple') {
      var cur = L.normalizeSelection(draft.sel).split('');
      var i = cur.indexOf(letter);
      if (i >= 0) cur.splice(i, 1); else cur.push(letter);
      draft.sel = cur.sort().join('');
      render();
      return;
    }
    draft.sel = letter;
    confirmPractice();
  }

  function confirmPractice() {
    var P = App.practice;
    if (!P) return;
    var q = P.questions[P.idx];
    if (P.graded[q.id]) return;
    var draft = draftOf(P, q.id);
    if (q.qtype === 'fill') {
      var nBlank = L.blankCount(q.stem);
      if (nBlank >= 2) {
        var parts = (draft.parts || []).slice(0, nBlank).map(function (t) { return String(t || '').trim(); });
        while (parts.length < nBlank) parts.push('');
        if (!parts.some(function (t) { return t !== ''; })) { toast('请至少填写一个空'); return; }
        P.graded[q.id] = { sel: parts.join('；'), ok: null, parts: parts };
        saveSession();
      } else {
        var text = (draft.text || '').trim();
        if (!text) { toast('请输入答案后再确认'); return; }
        P.graded[q.id] = { sel: text, ok: null, parts: [text] };
      }
      saveSession();
      render();
      return;
    }
    var sel = L.normalizeSelection(draft.sel);
    if (!sel) { toast('请先选择选项'); return; }
    var ok = L.gradeAnswer(q, sel);
    L.recordAnswer(App.state, q, sel, ok, 'practice');
    P.graded[q.id] = { sel: sel, ok: ok };
    P.results.push({ id: q.id, sel: sel, ok: ok });
    save(); saveSession();
    render();
    if (ok) scheduleAdvance(P, P.idx);
  }

  /* 答对自动下一题：留一小段时间展示「✓ 回答正确」，答错则停在原题看解析 */
  var advanceTimer = null;
  function scheduleAdvance(P, idx) {
    if (advanceTimer) clearTimeout(advanceTimer);
    advanceTimer = setTimeout(function () {
      advanceTimer = null;
      if (App.practice !== P || P.idx !== idx || App.page !== 'practice') return;
      if (P.idx >= P.questions.length - 1) finishPractice();
      else gotoIdx(P.idx + 1);
    }, 700);
  }

  function selfGrade(ok) {
    var P = App.practice;
    if (!P) return;
    var q = P.questions[P.idx];
    var g = P.graded[q.id];
    if (!g || g.ok !== null) return;
    g.ok = ok;
    P.results.push({ id: q.id, sel: g.sel, ok: ok });
    L.selfGrade(App.state, q, ok, g.sel);
    save(); saveSession();
    toast(ok ? '已记为答对' : '已记为答错，已加入错题本');
    render();
    if (ok) scheduleAdvance(P, P.idx);
  }

  function gotoIdx(i) {
    var P = App.practice;
    if (!P) return;
    if (i < 0 || i >= P.questions.length) return;
    if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; }
    P.idx = i;
    saveSession();
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function nextQuestion() {
    var P = App.practice;
    if (!P) return;
    if (P.idx >= P.questions.length - 1) return finishPractice();
    gotoIdx(P.idx + 1);
  }

  function finishPractice() {
    var P = App.practice;
    if (!P) return;
    var results = P.results;
    var ok = results.filter(function (r) { return r.ok; }).length;
    var bad = results.filter(function (r) { return r.ok === false; }).length;
    var pending = results.filter(function (r) { return r.ok === null; }).length;
    var unanswered = P.questions.length - results.length;
    showModal('<div class="modal"><header>本次练习完成</header><div class="body">' +
      '<div class="stat-row" style="grid-template-columns:repeat(4,1fr)">' +
      statCard('答对', ok, '题', 'var(--green)') +
      statCard('答错', bad, '已进错题本', 'var(--red)') +
      statCard('未作答', unanswered + pending, pending ? '含待自评 ' + pending : '题', 'var(--ink3)') +
      statCard('正确率', results.length ? fmtPct(L.accuracy(ok, results.length)) : '—', '按已作答计', 'var(--primary)') +
      '</div><div class="muted" style="margin-top:14px">共 ' + P.questions.length + ' 题 · 已作答 ' + results.length + ' 题</div></div>' +
      '<footer><button class="btn ghost" data-act="review-now">查看错题</button>' +
      '<button class="btn primary" data-act="close-practice-result">回到练习首页</button></footer></div>');
    App.practice = null;
    clearSession();
    updateCounters();
  }

  /* ---------------- 考试 ---------------- */
  function renderExam() {
    if (App.exam && !App.exam.done) return renderExamSession();
    return renderExamLauncher();
  }

  function renderExamLauncher(presetBank) {
    var selBank = presetBank || (App.lastBankId || (banks()[0] && banks()[0].id));
    var html = '<div class="page-head"><div><div class="page-title">模拟考试</div>' +
      '<div class="page-sub">随机抽题组卷、倒计时作答、自动评分</div></div></div>' +
      '<div class="card">' +
      '<div class="field"><label>选择题库</label><select id="e-bank">' + bankOptions(selBank) + '</select></div>' +
      '<div class="row" style="margin-top:16px;align-items:flex-end">' +
      '<div class="field" style="flex:1"><label>抽题数量</label><input type="number" id="e-count" value="20" min="1" max="999"></div>' +
      '<div class="field" style="flex:1"><label>考试时长（分钟）</label><input type="number" id="e-time" value="30" min="1" max="300"></div>' +
      '</div>' +
      '<div class="field" style="margin-top:16px"><label>题型范围</label><div class="row" id="e-types">' +
      '<label style="display:inline-flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" name="etype" value="single" checked>单选题</label>' +
      '<label style="display:inline-flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" name="etype" value="multiple" checked>多选题</label>' +
      '<label style="display:inline-flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" name="etype" value="judge" checked>判断题</label>' +
      '<label style="display:inline-flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" name="etype" value="fill">填空/简答</label>' +
      '</div><div class="muted" style="margin-top:6px">填空/简答为主观题，默认不参与机评（勾选后计入“待自评”，不计入得分分母）</div></div>' +
      '<div class="row" style="margin-top:20px"><button class="btn primary" data-act="start-exam">开始考试</button>' +
      '<span class="muted">题目从题库随机抽取；得分 = 答对题数 / 可机评题数 × 100</span></div></div>';
    main.innerHTML = html;
    updateCounters();
  }

  function startExam(preset) {
    var bankId = preset ? preset.bankId : Number(document.getElementById('e-bank').value);
    var count = preset ? 20 : Number(document.getElementById('e-count').value || 20);
    var minutes = preset ? 30 : Number(document.getElementById('e-time').value || 30);
    var types = [];
    if (preset) types = ['single', 'multiple', 'judge'];
    else document.querySelectorAll('input[name=etype]').forEach(function (cb) { if (cb.checked) types.push(cb.value); });
    if (!types.length) { toast('请至少勾选一个题型'); return; }
    var sess = L.buildSession({ banks: banks(), state: App.state, bankId: bankId, scope: 'all', order: 'random', types: types, limit: count });
    if (!sess.questions.length) { toast('该题库没有可考的题目'); return; }
    App.lastBankId = bankId;
    App.exam = {
      questions: sess.questions, idx: 0, bank: sess.bank,
      title: (sess.bank ? sess.bank.name : '题库') + ' · 模拟考试',
      answers: {}, flags: {}, startTs: Date.now(),
      remain: Math.round(minutes * 60), total: sess.questions.length, done: false, submitted: false
    };
    render();
    startExamTimer();
  }

  var examTimer = null;
  function startExamTimer() {
    if (examTimer) clearInterval(examTimer);
    examTimer = setInterval(function () {
      var E = App.exam;
      if (!E || E.done) { clearInterval(examTimer); examTimer = null; return; }
      E.remain -= 1;
      if (E.remain <= 0) {
        E.remain = 0;
        clearInterval(examTimer); examTimer = null;
        toast('时间到，自动交卷！');
        submitExam(true);
        return;
      }
      var el = document.getElementById('exam-timer');
      if (el) {
        el.textContent = fmtTime(E.remain);
        el.className = 'timer' + (E.remain <= 300 ? ' danger' : '');
      }
    }, 1000);
  }

  function renderExamSession() {
    var E = App.exam;
    var q = E.questions[E.idx];
    var ans = E.answers[q.id] || '';
    var html = '<div class="page-head"><div><div class="page-title">' + esc(E.title) + '</div>' +
      '<div class="page-sub">已答 ' + Object.keys(E.answers).length + ' / ' + E.total + ' · 标记 ' +
      Object.keys(E.flags).filter(function (k) { return E.flags[k]; }).length + '</div></div>' +
      '<div class="row"><span class="timer' + (E.remain <= 300 ? ' danger' : '') + '" id="exam-timer">' + fmtTime(E.remain) + '</span>' +
      '<button class="btn primary" data-act="submit-exam">交卷</button></div></div>' +
      '<div class="practice-layout"><div>' +
      '<div class="card q-card">' + questionHead(q, E.idx, E.total) +
      '<div class="stem">' + esc(q.stem) + '</div>';

    if (q.qtype === 'fill') {
      html += '<textarea class="fill-input" id="exam-fill" placeholder="写下你的答案">' + esc(ans) + '</textarea>';
    } else {
      var letters = lettersOf(q);
      var selSet = {};
      L.normalizeSelection(ans).split('').forEach(function (c) { selSet[c] = 1; });
      letters.forEach(function (L0, i) {
        html += '<button class="opt' + (selSet[L0] ? ' sel' : '') + '" data-act="exam-opt" data-letter="' + L0 + '">' +
          '<span class="letter">' + L0 + '</span><span>' + esc(q.options && q.options[i] !== undefined ? q.options[i] : '') + '</span></button>';
      });
    }
    html += '<div class="row" style="margin-top:18px">' +
      '<button class="btn ghost" data-act="e-prev" ' + (E.idx === 0 ? 'disabled' : '') + '>← 上一题</button>' +
      '<button class="btn ghost" data-act="exam-flag">' + (E.flags[q.id] ? '⚑ 取消标记' : '⚐ 标记本题') + '</button>' +
      '<div class="spacer"></div>' +
      '<button class="btn primary" data-act="e-next">' + (E.idx === E.total - 1 ? '最后一题' : '下一题 →') + '</button></div>' +
      '</div></div>';

    html += '<div class="stack"><div class="card"><div class="card-title">答题卡</div><div class="nav-grid">';
    E.questions.forEach(function (qq, i) {
      var cls = 'cell' + (i === E.idx ? ' cur' : '') + (E.answers[qq.id] ? ' ok' : '') + (E.flags[qq.id] ? ' flag' : '');
      html += '<button class="' + cls + '" data-act="e-jump" data-idx="' + i + '">' + (i + 1) + '</button>';
    });
    html += '</div><div class="muted" style="margin-top:10px">未答 ' + (E.total - Object.keys(E.answers).length) + ' 题</div></div>' +
      '<div class="card"><div class="card-title">说明</div><div class="muted" style="line-height:1.8">' +
      '考试中不显示对错与解析；交卷后统一评分。<br>时间到会自动交卷。</div></div></div></div>';
    main.innerHTML = html;
    updateCounters();
    var ta = document.getElementById('exam-fill');
    if (ta) ta.addEventListener('input', function () { App.exam.answers[q.id] = ta.value; });
  }

  function examPick(letter) {
    var E = App.exam;
    if (!E) return;
    var q = E.questions[E.idx];
    if (q.qtype === 'multiple') {
      var cur = L.normalizeSelection(E.answers[q.id] || '').split('');
      var i = cur.indexOf(letter);
      if (i >= 0) cur.splice(i, 1); else cur.push(letter);
      E.answers[q.id] = cur.sort().join('');
    } else {
      E.answers[q.id] = letter;
    }
    render();
  }

  function submitExam(auto) {
    var E = App.exam;
    if (!E || E.submitted) return;
    E.submitted = true;
    if (examTimer) { clearInterval(examTimer); examTimer = null; }
    var key = {};
    E.questions.forEach(function (q) { key[q.id] = q; });
    var correct = 0, gradedCount = 0, pending = 0;
    var detail = {};
    E.questions.forEach(function (q) {
      var sel = E.answers[q.id] || '';
      var ok = L.gradeAnswer(q, sel);
      if (ok === null) { pending += 1; detail[q.id] = { sel: sel, ok: null }; return; }
      gradedCount += 1;
      if (sel) { L.recordAnswer(App.state, q, sel, ok, 'exam'); }
      if (ok) correct += 1;
      detail[q.id] = { sel: sel, ok: ok };
    });
    var score = Math.round(L.accuracy(correct, gradedCount) * 10) / 10;
    var duration = Math.round((Date.now() - E.startTs) / 1000);
    App.state.exams.push({
      id: (App.state.exams.length + 1), bank_id: E.bank ? E.bank.id : null, title: E.title,
      total: gradedCount, correct: correct, pending: pending, score: score,
      duration: duration, ts: Date.now(), detail: detail
    });
    save();
    E.done = true;
    var qsForReview = E.questions.map(function (q) { return q.id; });
    showModal('<div class="modal"><header>考试结果</header><div class="body">' +
      '<div class="row" style="justify-content:center;margin-bottom:8px"><div class="score-ring">' +
      '<div class="n" style="color:' + (score >= 80 ? 'var(--green)' : score >= 60 ? 'var(--amber)' : 'var(--red)') + '">' + score + '</div>' +
      '<div class="muted">得分</div></div></div>' +
      '<div class="stat-row" style="grid-template-columns:repeat(4,1fr)">' +
      statCard('题目数', E.total, '题', 'var(--blue)') +
      statCard('答对', correct, '题', 'var(--green)') +
      statCard('答错', gradedCount - correct, '题', 'var(--red)') +
      statCard('用时', fmtTime(duration), auto ? '自动交卷' : '手动交卷', 'var(--violet)') +
      '</div>' + (pending ? '<div class="muted" style="margin-top:12px">主观题 ' + pending + ' 道未计入评分</div>' : '') +
      '</div><footer><button class="btn ghost" data-act="exam-review" data-ids="' + qsForReview.join(',') + '">错题复盘</button>' +
      '<button class="btn primary" data-act="close-exam-result">完成</button></footer></div>');
    App.exam = null;
    updateCounters();
  }

/* ---------------- 看题（带答案） ---------------- */

  var BROWSE_KEY = 'quizmaster.web.browse.v1';

  function saveBrowse() {
    var B = App.browse;
    if (!B) return;
    try {
      localStorage.setItem(BROWSE_KEY, JSON.stringify({
        bankId: B.bankId, types: B.types || [], keyword: B.keyword || '',
        scope: B.scope || 'all', showAnswer: B.showAnswer !== false,
        pos: B.pos || 0, updatedAt: Date.now()
      }));
    } catch { /* 忽略存储异常 */ }
  }

  function loadBrowse() {
    try {
      var raw = localStorage.getItem(BROWSE_KEY);
      if (!raw) return null;
      var b = JSON.parse(raw);
      if (!b || typeof b !== 'object') return null;
      return b;
    } catch { return null; }
  }

  function browseState() {
    if (!App.browse) {
      var first = banks()[0];
      var saved = loadBrowse();
      if (saved) {
        App.browse = {
          bankId: saved.bankId != null ? saved.bankId : (first ? first.id : null),
          types: Array.isArray(saved.types) ? saved.types : [],
          keyword: saved.keyword || '',
          scope: saved.scope || 'all',
          showAnswer: saved.showAnswer !== false,
          pos: Math.max(0, saved.pos || 0),
          dir: ''
        };
      } else {
        App.browse = { bankId: first ? first.id : null, types: [], keyword: '', scope: 'all',
                       showAnswer: true, pos: 0, dir: '' };
      }
    }
    var ids = banks().map(function (b) { return b.id; });
    if (ids.indexOf(App.browse.bankId) < 0) App.browse.bankId = ids.length ? ids[0] : null;
    return App.browse;
  }

  function browseQuestions() {
    var B = browseState();
    var bank = banks().filter(function (b) { return b.id === B.bankId; })[0];
    var qs = bank ? (bank.questions || []).slice() : [];
    if (B.types.length) qs = qs.filter(function (q) { return B.types.indexOf(q.qtype) >= 0; });
    if (B.scope === 'wrong') {
      var w = L.activeWrongIds(App.state);
      qs = qs.filter(function (q) { return w.indexOf(String(q.id)) >= 0; });
    } else if (B.scope === 'fav') {
      qs = qs.filter(function (q) { return !!App.state.favs[q.id]; });
    }
    var kw = (B.keyword || '').trim().toLowerCase();
    if (kw) {
      qs = qs.filter(function (q) {
        var hay = (q.stem + ' ' + (q.options || []).join(' ') + ' ' + (q.answer || '') + ' ' + (q.analysis || '')).toLowerCase();
        return hay.indexOf(kw) >= 0;
      });
    }
    return qs;
  }

  function browseCard(q, idx) {
    var B = App.browse;
    var letters = lettersOf(q);
    var want = L.answerLetters(q);
    var html = '<div class="card b-card"><div class="q-head">' + typeBadge(q) +
      '<span class="num-chip">' + (idx + 1) + '</span>' + issueBadge(q) +
      (App.state.wrong[q.id] && !App.state.wrong[q.id].resolved
        ? '<span class="chip" style="background:var(--red-bg);color:#B91C1C">错 ' + App.state.wrong[q.id].count + ' 次</span>' : '') +
      '<div class="spacer"></div>' +
      '<button class="btn mini ghost" data-act="browse-fav" data-id="' + q.id + '">' +
      (App.state.favs[q.id] ? '★ 已收藏' : '☆ 收藏') + '</button>' +
      '<button class="btn mini ghost" data-act="browse-single" data-id="' + q.id + '">单题背题</button>' +
      '</div><div class="stem">' + esc(q.stem) + '</div>';

    if (q.qtype === 'fill') {
      var refParts = L.splitFillAnswer(q.answer);
      var nB = refParts.length;
      if (B.showAnswer) {
        if (nB >= 2) {
          html += '<div class="analysis" style="background:#fff;border-style:dashed"><div class="h">参考答案 · 共 ' + nB + ' 空</div>';
          for (var i = 0; i < nB; i++) {
            html += '<div class="blank-ref"><span class="blank-no">第 ' + (i + 1) + ' 空</span>' +
              '<span class="blank-ans">' + esc(refParts[i] || '（未给出）') + '</span></div>';
          }
          html += '</div>';
        } else {
          html += '<div class="analysis" style="background:#fff;border-style:dashed"><div class="h">参考答案</div>' + esc(q.answer) + '</div>';
        }
        html += analysisBox(q);
      } else {
        html += '<div class="muted">（已隐藏答案）</div>';
      }
      return html + '</div>';
    }

    letters.forEach(function (L0, k) {
      var cls = 'opt';
      if (B.showAnswer) cls += want.indexOf(L0) >= 0 ? ' correct' : ' muted';
      html += '<div class="' + cls + '"><span class="letter">' + L0 + '</span><span>' + esc(q.options[k] || '') + '</span></div>';
    });
    if (B.showAnswer) {
      html += '<div class="row" style="margin-top:6px"><span class="result-line" style="color:var(--primary-d)">答案：' + esc(answerText(q)) + '</span></div>';
      html += analysisBox(q);
    } else {
      html += '<div class="muted">（已隐藏答案）</div>';
    }
    return html + '</div>';
  }


  /* 看题模式：左右滑动换题（触摸/拖拽均可），并支持 ← → 键 */
  function bindSwipe() {
    var shell = document.getElementById('b-swipe');
    if (!shell) return;
    var startX = 0, startY = 0, tracking = false;
    function down(x, y) { startX = x; startY = y; tracking = true; }
    function up(x, y) {
      if (!tracking) return;
      tracking = false;
      var dx = x - startX, dy = y - startY;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
      if (dx < 0) browseStep(1); else browseStep(-1);
    }
    shell.addEventListener('touchstart', function (ev) {
      var t = ev.changedTouches[0];
      down(t.clientX, t.clientY);
    }, { passive: true });
    shell.addEventListener('touchend', function (ev) {
      var t = ev.changedTouches[0];
      up(t.clientX, t.clientY);
    }, { passive: true });
    shell.addEventListener('mousedown', function (ev) {
      if (ev.target.closest('button')) return;
      down(ev.clientX, ev.clientY);
    });
    shell.addEventListener('mouseup', function (ev) { up(ev.clientX, ev.clientY); });
  }

  function browseStep(delta) {
    var B = browseState();
    var all = browseQuestions();
    if (!all.length) return;
    var next = Math.min(Math.max(0, B.pos + delta), all.length - 1);
    if (next === B.pos) return;
    B.dir = delta > 0 ? 'next' : 'prev';
    B.pos = next;
    saveBrowse();
    render();
    var shell = document.getElementById('b-swipe');
    if (shell) window.scrollTo({ top: shell.offsetTop - 80, behavior: 'smooth' });
  }

  function renderBrowse() {
    var B = browseState();
    var all = browseQuestions();
    if (B.pos > all.length - 1) B.pos = Math.max(0, all.length - 1);
    if (B.pos < 0) B.pos = 0;
    var cur = all.length ? all[B.pos] : null;
    var counts = { single: 0, multiple: 0, judge: 0, fill: 0 };
    all.forEach(function (q) { if (counts[q.qtype] !== undefined) counts[q.qtype] += 1; });

    function chip(act, key, label, on) {
      return '<button class="chip-btn' + (on ? ' on' : '') + '" data-act="' + act + '" data-key="' + key + '">' + label + '</button>';
    }

    var html = '<div class="page-head"><div><div class="page-title">看题 · 带答案</div>' +
      '<div class="page-sub">整库连续浏览，答案与解析直接展开；当前 ' + all.length + ' 题' +
      (B.keyword ? '（关键词：' + esc(B.keyword) + '）' : '') +
      (B.pos > 0 ? ' · 已从上次位置继续（第 ' + (B.pos + 1) + ' 题）' : '') + '</div></div>' +
      '<div class="row">' +
      (B.pos > 0 ? '<button class="btn ghost" data-act="browse-first">回到第 1 题</button>' : '') +
      '<button class="btn ghost" data-act="browse-answer">' + (B.showAnswer ? '隐藏答案' : '显示答案') + '</button>' +
      (all.length ? '<button class="btn primary" data-act="browse-practice">练这个范围</button>' : '') +
      '</div></div>';

    html += '<div class="card" style="margin-bottom:14px">' +
      '<div class="browse-bar">' +
      '<div class="field"><label>题库</label><select id="b-bank">' + bankOptions(B.bankId) + '</select></div>' +
      '<div class="field"><label>搜索</label><input type="text" id="b-kw" placeholder="题干 / 选项 / 答案 / 解析" value="' + esc(B.keyword) + '"></div>' +
      '</div>' +
      '<div class="row" style="margin-top:12px">' +
      chip('browse-type', 'single', '单选 ' + counts.single, B.types.indexOf('single') >= 0) +
      chip('browse-type', 'multiple', '多选 ' + counts.multiple, B.types.indexOf('multiple') >= 0) +
      chip('browse-type', 'judge', '判断 ' + counts.judge, B.types.indexOf('judge') >= 0) +
      chip('browse-type', 'fill', '填空/简答 ' + counts.fill, B.types.indexOf('fill') >= 0) +
      '<span style="width:8px"></span>' +
      chip('browse-scope', 'all', '全部', B.scope === 'all') +
      chip('browse-scope', 'wrong', '只看错题', B.scope === 'wrong') +
      chip('browse-scope', 'fav', '只看收藏', B.scope === 'fav') +
      '<div class="spacer"></div>' +
      '<span class="muted">共 ' + all.length + ' 题</span>' +
      '</div></div>';

    if (!all.length) {
      html += '<div class="empty"><b>没有匹配的题目</b>换个题库、题型或关键词试试</div>';
    } else {
      html += '<div class="swipe-shell" id="b-swipe" data-dir="' + (B.dir || '') + '">' +
        '<button class="swipe-arrow left" data-act="browse-prev" ' + (B.pos <= 0 ? 'disabled' : '') + ' aria-label="上一题">‹</button>' +
        '<div class="swipe-stage">' +
        '<div class="swipe-meta"><span class="num-chip">第 ' + (B.pos + 1) + ' / ' + all.length + ' 题</span>' +
        '<span class="muted">左右滑动换题 · 键盘 ← →</span></div>' +
        browseCard(cur, B.pos) +
        '</div>' +
        '<button class="swipe-arrow right" data-act="browse-next" ' + (B.pos >= all.length - 1 ? 'disabled' : '') + ' aria-label="下一题">›</button>' +
        '</div>' +
        '<div class="row" style="justify-content:center;margin-top:12px;gap:10px">' +
        '<button class="btn ghost" data-act="browse-prev" ' + (B.pos <= 0 ? 'disabled' : '') + '>← 上一题</button>' +
        '<button class="btn primary" data-act="browse-next" ' + (B.pos >= all.length - 1 ? 'disabled' : '') + '>下一题 →</button>' +
        '</div>';
    }
    main.innerHTML = html;
    updateCounters();
    bindSwipe();

    var sel = document.getElementById('b-bank');
    if (sel) sel.addEventListener('change', function () {
      B.bankId = Number(sel.value); B.pos = 0; B.dir = ''; saveBrowse(); render();
    });
    var kw = document.getElementById('b-kw');
    if (kw) {
      var timer = null;
      kw.addEventListener('input', function () {
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
          B.keyword = kw.value; B.pos = 0; B.dir = ''; saveBrowse(); render();
          var again = document.getElementById('b-kw');
          if (again) {
            again.focus();
            try { again.setSelectionRange(again.value.length, again.value.length); } catch { /* ignore */ }
          }
        }, 240);
      });
    }
  }

  /* ---------------- 错题本 / 收藏 ---------------- */
  function renderList(kind) {
    var isWrong = kind === 'wrong';
    var ids = isWrong ? L.activeWrongIds(App.state) : Object.keys(App.state.favs);
    var map = qOfMap();
    var qs = ids.map(function (id) { return map[id]; }).filter(Boolean);
    if (isWrong) {
      qs.sort(function (a, b) { return (App.state.wrong[b.id].last || 0) - (App.state.wrong[a.id].last || 0); });
    } else {
      qs.sort(function (a, b) { return (App.state.favs[b.id] || 0) - (App.state.favs[a.id] || 0); });
    }
    var title = isWrong ? '错题本' : '收藏夹';
    var html = '<div class="page-head"><div><div class="page-title">' + title + '</div>' +
      '<div class="page-sub">' + (isWrong ? '答错自动收录，答对或手动移除后消失' : '练习中随时收藏，这里集中复习') +
      ' · 共 ' + qs.length + ' 题</div></div>' +
      '<div class="row">' + (qs.length ? '<button class="btn ghost" data-act="list-back" data-kind="' + kind + '">背题过一遍</button>' +
      '<button class="btn primary" data-act="list-practice" data-kind="' + kind + '">开始重练</button>' : '') + '</div></div>';

    if (!qs.length) {
      html += '<div class="empty"><b>' + (isWrong ? '错题本是空的' : '还没有收藏') + '</b>' +
        (isWrong ? '去练习几道题，答错的会自动进来' : '练习时点「收藏本题」即可加入') + '</div>';
    } else {
      html += '<div class="stack">';
      qs.slice(0, 200).forEach(function (q, i) {
        var meta = '';
        if (isWrong) {
          var w = App.state.wrong[q.id];
          meta = '<span class="chip" style="background:var(--red-bg);color:#B91C1C">错 ' + (w ? w.count : 0) + ' 次</span>' +
            (w && w.last ? '<span class="chip">最近 ' + fmtDate(w.last) + '</span>' : '');
        } else {
          meta = '<span class="chip">收藏于 ' + fmtDate(App.state.favs[q.id] || Date.now()) + '</span>';
        }
        html += '<div class="card"><div class="q-head">' + typeBadge(q) + '<span class="num-chip">' + (i + 1) + '</span>' + issueBadge(q) + meta +
          '<div class="spacer"></div>' +
          '<button class="btn mini" data-act="list-open" data-id="' + q.id + '">查看/背题</button>' +
          (isWrong ? '<button class="btn mini ghost" data-act="wrong-resolve" data-id="' + q.id + '">标记已掌握</button>'
            : '<button class="btn mini danger" data-act="fav-del" data-id="' + q.id + '">取消收藏</button>') +
          '</div>' +
          '<div class="stem" style="font-size:14px;margin-bottom:8px">' + esc(q.stem) + '</div>';
        if ((q.options || []).length) {
          html += '<div class="muted" style="line-height:1.8">' + q.options.map(function (o, k) {
            return L.LETTERS[k] + '. ' + esc(o);
          }).join('<br>') + '</div>';
        }
        html += '<div class="analysis"><div class="h">答案</div>' + esc(answerText(q)) +
          (q.analysis ? '<div style="margin-top:8px">' + esc(q.analysis) + '</div>' : '') + '</div></div>';
      });
      html += '</div>';
      if (qs.length > 200) html += '<div class="muted" style="margin-top:10px">仅显示前 200 题，共 ' + qs.length + ' 题</div>';
    }
    main.innerHTML = html;
    updateCounters();
  }

  /* ---------------- 统计 ---------------- */
  function isNarrow() {
    try { return window.matchMedia('(max-width: 900px)').matches; } catch { return window.innerWidth <= 900; }
  }

  function renderStats() {
    var ov = L.overview(App.data, App.state);
    var narrow = isNarrow();
    var days = narrow ? 7 : 14;
    var daily = L.dailyActivity(App.state, days);
    var maxN = Math.max.apply(null, daily.map(function (d) { return d.n; }).concat([1]));
    var byBank = L.accuracyByBank(App.data, App.state);
    var dist = L.typeDistribution(App.data, App.state);
    var distMax = Math.max.apply(null, dist.map(function (d) { return d.n; }).concat([1]));
    var streak = L.streakDays(App.state);

    var html = '<div class="page-head"><div><div class="page-title">学习统计</div>' +
      '<div class="page-sub">连续打卡 ' + streak + ' 天 · 累计作答 ' + ov.answers + ' 次</div></div></div>' +
      '<div class="stat-row">' + statCard('题目总数', ov.questions, '全部题库', 'var(--violet)') +
      statCard('已练题目', ov.practiced, '去重后题数', 'var(--blue)') +
      statCard('正确率（次数）', ov.answers ? fmtPct(ov.accuracy) : '—', '答对次数 / 作答次数', 'var(--green)') +
      statCard('正确率（题目）', ov.practiced ? fmtPct(ov.accuracy_distinct) : '—', '最终答对题 / 练过的题', 'var(--primary)') +
      statCard('待消灭错题', ov.wrong, '错题本剩余', 'var(--red)') + '</div>';

    html += '<div class="card" style="margin-top:14px"><div class="card-title">近 ' + days + ' 天作答</div><div class="chart">';
    daily.forEach(function (d) {
      var h = Math.round(d.n / maxN * 100);
      var lab = narrow ? d.day.slice(5).replace('-', '/') : d.day.slice(5);
      html += '<div class="bar-wrap"><div class="bar' + (d.n ? '' : ' empty') + '" style="height:' + Math.max(h, d.n ? 6 : 2) + '%" title="' +
        d.day + '：' + d.n + ' 题，答对 ' + d.ok + '"></div><div class="lab">' + lab + '</div></div>';
    });
    html += '</div></div>';

    html += '<div class="card" style="margin-top:14px"><div class="card-title">按题库作答</div>';
    if (!byBank.length) html += '<div class="muted">还没有作答记录</div>';
    else {
      html += '<div class="table-wrap desk-only"><table class="data"><thead><tr><th>题库</th><th class="num">作答次数</th><th class="num">正确率</th></tr></thead><tbody>';
      byBank.forEach(function (b) {
        html += '<tr><td>' + esc(b.name) + '</td><td class="num">' + b.n + '</td><td class="num">' + fmtPct(b.accuracy) + '</td></tr>';
      });
      html += '</tbody></table></div>';
      html += '<div class="mob-only mob-list">';
      byBank.forEach(function (b) {
        html += '<div class="mob-card" style="padding:12px 14px">' +
          '<div class="mob-title" style="font-size:13.5px">' + esc(b.name) + '</div>' +
          '<div class="row" style="margin-top:8px;gap:10px">' +
          '<span class="muted">作答 ' + b.n + ' 次</span>' +
          '<span class="timer" style="padding:3px 9px;font-size:12px">' + fmtPct(b.accuracy) + '</span>' +
          '</div>' +
          '<div class="dist-track" style="margin-top:8px"><i style="width:' + Math.max(2, Math.min(100, b.accuracy)) + '%;background:var(--primary)"></i></div>' +
          '</div>';
      });
      html += '</div>';
    }
    html += '</div>';

    html += '<div class="card" style="margin-top:14px"><div class="card-title">题型分布</div><div class="dist">';
    dist.forEach(function (d) {
      var c = L.TYPE_COLORS[d.qtype] || ['#EEF2FF', '#4F46E5'];
      html += '<div class="dist-row"><span>' + (L.TYPE_NAMES[d.qtype] || d.qtype) + '</span>' +
        '<span class="dist-track"><i style="width:' + (d.n / distMax * 100) + '%;background:' + c[1] + '"></i></span>' +
        '<span class="muted">' + d.n + '</span></div>';
    });
    html += '</div></div>';
    main.innerHTML = html;
    updateCounters();
  }

  /* ---------------- 弹窗 ---------------- */
  function showModal(html) {
    modalHost.innerHTML = '<div class="mask" data-act="mask-close">' + html + '</div>';
  }
  function closeModal() { modalHost.innerHTML = ''; }

  /* ---------------- 事件 ---------------- */
  document.addEventListener('click', function (ev) {
    var nav = ev.target.closest('[data-nav]');
    if (nav) { route(nav.dataset.nav); return; }
    var el = ev.target.closest('[data-act]');
    if (!el) return;
    var act = el.dataset.act;
    switch (act) {
      case 'mask-close':
        if (ev.target === el) closeModal();
        return;
      case 'close-modal': closeModal(); return;
      case 'open-import': openImport(); return;
      case 'do-import': doImport(); return;
      case 'quick-practice':
        if (sessionSummary()) { App.page = 'practice'; renderPracticeLauncher(); }
        else route('practice');
        return;
      case 'resume-practice': resumePractice(); return;
      case 'discard-session': clearSession(); toast('已清除上次练习进度'); render(); return;
      case 'quick-exam': route('exam'); return;
      case 'pick-mode':
        App.lastMode = el.dataset.key;
        document.querySelectorAll('#p-mode .mode-card').forEach(function (c) { c.classList.toggle('on', c === el); });
        return;
      case 'bank-practice': startPractice({ bankId: Number(el.dataset.id), mode: 'normal', scope: 'all' }); route('practice'); render(); return;
      case 'bank-exam': startExam({ bankId: Number(el.dataset.id) }); route('exam'); return;
      case 'bank-rename': renameBank(Number(el.dataset.id)); return;
      case 'bank-del': deleteBank(Number(el.dataset.id)); return;
      case 'start-practice': {
        var scopeSel = document.querySelector('input[name=scope]:checked');
        App.lastScope = scopeSel ? scopeSel.value : 'all';
        startPractice({ bankId: Number(document.getElementById('p-bank').value), mode: App.lastMode || 'normal', scope: App.lastScope });
        return;
      }
      case 'start-exam': startExam(); return;
      case 'opt': pickOption(el.dataset.letter); return;
      case 'confirm': confirmPractice(); return;
      case 'self-ok': selfGrade(true); return;
      case 'self-bad': selfGrade(false); return;
      case 'prev': gotoIdx(App.practice ? App.practice.idx - 1 : 0); return;
      case 'next': nextQuestion(); return;
      case 'jump': gotoIdx(Number(el.dataset.idx)); return;
      case 'fav': {
        var P = App.practice;
        if (!P) return;
        var q = P.questions[P.idx];
        var on = L.toggleFav(App.state, q.id);
        save(); toast(on ? '已加入收藏' : '已取消收藏'); render();
        return;
      }
      case 'finish-practice': finishPractice(); return;
      case 'exit-practice':
        App.practice = null; render(); return;
      case 'close-practice-result':
        closeModal(); App.practice = null; route('practice'); return;
      case 'review-now':
        closeModal(); route('wrong'); return;
      case 'exam-opt': examPick(el.dataset.letter); return;
      case 'exam-flag': {
        var E = App.exam; if (!E) return;
        var qq = E.questions[E.idx];
        E.flags[qq.id] = !E.flags[qq.id];
        render(); return;
      }
      case 'e-prev':
        if (App.exam && App.exam.idx > 0) { App.exam.idx -= 1; render(); }
        return;
      case 'e-next':
        if (App.exam && App.exam.idx < App.exam.total - 1) { App.exam.idx += 1; render(); }
        return;
      case 'e-jump':
        if (App.exam) { App.exam.idx = Number(el.dataset.idx); render(); }
        return;
      case 'submit-exam': confirmSubmit(); return;
      case 'close-exam-result': closeModal(); route('exam'); return;
      case 'exam-review': {
        var ids = (el.dataset.ids || '').split(',').map(Number).filter(Boolean);
        closeModal();
        var map2 = qOfMap();
        var qs2 = ids.map(function (id) { return map2[id]; }).filter(Boolean);
        if (!qs2.length) { route('exam'); return; }
        App.practice = { questions: qs2, idx: 0, mode: 'back', graded: {}, drafts: {}, results: [],
                         title: '错题复盘 · 背题模式', label: '背题模式', bank: null };
        route('practice');
        return;
      }
      case 'list-back': {
        var kind = el.dataset.kind;
        var ids2 = kind === 'wrong' ? L.activeWrongIds(App.state) : Object.keys(App.state.favs);
        var map3 = qOfMap();
        var qs3 = ids2.map(function (id) { return map3[id]; }).filter(Boolean);
        if (!qs3.length) { toast('没有可用的题目'); return; }
        App.practice = { questions: qs3, idx: 0, mode: 'back', graded: {}, drafts: {}, results: [],
                         title: kind === 'wrong' ? '错题背题' : '收藏背题', label: '背题模式', bank: null };
        route('practice');
        return;
      }
      case 'list-practice': {
        var kind2 = el.dataset.kind;
        var ids3 = kind2 === 'wrong' ? L.activeWrongIds(App.state) : Object.keys(App.state.favs);
        var map4 = qOfMap();
        var qs4 = ids3.map(function (id) { return map4[id]; }).filter(Boolean);
        if (!qs4.length) { toast('没有可练的题目'); return; }
        App.practice = { questions: qs4, idx: 0, mode: 'practice', graded: {}, drafts: {}, results: [],
                         title: kind2 === 'wrong' ? '错题重练' : '收藏练习', label: '练习', bank: null };
        route('practice');
        return;
      }
      case 'browse-type': {
        var Bt = browseState();
        var bk = el.dataset.key;
        var pos = Bt.types.indexOf(bk);
        if (pos >= 0) Bt.types.splice(pos, 1); else Bt.types.push(bk);
        Bt.pos = 0; Bt.dir = ''; saveBrowse(); render(); return;
      }
      case 'browse-scope': {
        var Bs = browseState();
        Bs.scope = el.dataset.key; Bs.pos = 0; Bs.dir = ''; saveBrowse(); render(); return;
      }
      case 'browse-answer': {
        var Ba = browseState();
        Ba.showAnswer = !Ba.showAnswer; saveBrowse(); render(); return;
      }
      case 'browse-first': {
        var Bf = browseState();
        Bf.pos = 0; Bf.dir = ''; saveBrowse(); render(); return;
      }
      case 'browse-prev': browseStep(-1); return;
      case 'browse-next': browseStep(1); return;
      case 'browse-fav': {
        var favOn = L.toggleFav(App.state, Number(el.dataset.id));
        save(); toast(favOn ? '已加入收藏' : '已取消收藏'); render(); return;
      }
      case 'browse-single': {
        var bq = qOf(Number(el.dataset.id));
        if (!bq) return;
        App.practice = { questions: [bq], idx: 0, mode: 'back', graded: {}, drafts: {}, results: [],
                         title: '背题', label: '背题模式', bank: null };
        route('practice'); return;
      }
      case 'browse-practice': {
        var list = browseQuestions();
        if (!list.length) { toast('没有可练的题目'); return; }
        App.practice = { questions: list, idx: 0, mode: 'practice', graded: {}, drafts: {}, results: [],
                         title: '看题范围练习', label: '练习', bank: null };
        route('practice'); return;
      }
      case 'list-open': {
        var q1 = qOf(Number(el.dataset.id));
        if (!q1) return;
        App.practice = { questions: [q1], idx: 0, mode: 'back', graded: {}, drafts: {}, results: [],
                         title: '背题', label: '背题模式', bank: null };
        route('practice');
        return;
      }
      case 'wrong-resolve':
        L.resolveWrong(App.state, Number(el.dataset.id));
        save(); render(); toast('已移出错题本');
        return;
      case 'fav-del':
        L.toggleFav(App.state, Number(el.dataset.id));
        save(); render();
        return;
      default: return;
    }
  });

  function renameBank(id) {
    var b = banks().filter(function (x) { return x.id === id; })[0];
    if (!b) return;
    var name = window.prompt('新的题库名称', b.name);
    if (!name) return;
    b.name = name.slice(0, 60);
    save(); render(); toast('已改名');
  }
  function deleteBank(id) {
    var b = banks().filter(function (x) { return x.id === id; })[0];
    if (!b) return;
    if (!window.confirm('确定删除「' + b.name + '」及其练习记录？此操作不可撤销。')) return;
    App.state.imported = App.state.imported.filter(function (x) { return x.id !== id; });
    var qids = {};
    (b.questions || []).forEach(function (q) { qids[q.id] = 1; });
    App.state.records = App.state.records.filter(function (r) { return !qids[r.qid]; });
    Object.keys(App.state.wrong).forEach(function (k) { if (qids[k]) delete App.state.wrong[k]; });
    Object.keys(App.state.favs).forEach(function (k) { if (qids[k]) delete App.state.favs[k]; });
    save(); render(); toast('已删除题库');
  }

  function confirmSubmit() {
    var E = App.exam;
    if (!E) return;
    var unanswered = E.total - Object.keys(E.answers).length;
    showModal('<div class="modal" style="width:min(420px,100%)"><header>确认交卷？</header><div class="body">' +
      '<div class="muted" style="line-height:1.9">共 ' + E.total + ' 题，已答 ' + (E.total - unanswered) + ' 题，未答 ' + unanswered + ' 题。<br>' +
      '交卷后立即评分，不能再修改答案。</div></div>' +
      '<footer><button class="btn ghost" data-act="close-modal">再检查一下</button>' +
      '<button class="btn primary" id="confirm-submit">确认交卷</button></footer></div>');
    document.getElementById('confirm-submit').addEventListener('click', function () {
      closeModal();
      submitExam(false);
    });
  }

  /* 键盘快捷键：A–H / 1–8 选择，Enter 确认或下一题，← → 切题 */
  document.addEventListener('keydown', function (ev) {
    if (ev.target && /input|textarea|select/i.test(ev.target.tagName)) {
      if (ev.key === 'Enter' && ev.target.classList.contains('fill-input')) {
        ev.preventDefault();
        if (App.page === 'practice') confirmPractice();
      }
      return;
    }
    if (document.querySelector('.mask')) {
      if (ev.key === 'Escape') closeModal();
      return;
    }
    if (App.page === 'practice' && App.practice) {
      var k = ev.key;
      if (/^[a-hA-H]$/.test(k)) {
        var idx = L.LETTERS.indexOf(k.toUpperCase());
        var q = App.practice.questions[App.practice.idx];
        if (idx < lettersOf(q).length) { ev.preventDefault(); pickOption(k.toUpperCase()); }
        return;
      }
      if (/^[1-8]$/.test(k)) {
        var i2 = Number(k) - 1;
        var q2 = App.practice.questions[App.practice.idx];
        if (i2 < lettersOf(q2).length) { ev.preventDefault(); pickOption(L.LETTERS[i2]); }
        return;
      }
      if (k === 'Enter') {
        ev.preventDefault();
        var cur = App.practice.questions[App.practice.idx];
        var g = App.practice.graded[cur.id];
        if (!g && (cur.qtype === 'multiple' || cur.qtype === 'fill')) confirmPractice();
        else nextQuestion();
        return;
      }
      if (k === 'ArrowLeft') { ev.preventDefault(); gotoIdx(App.practice.idx - 1); return; }
      if (k === 'ArrowRight') { ev.preventDefault(); nextQuestion(); return; }
    }
    if (App.page === 'browse') {
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); browseStep(-1); return; }
      if (ev.key === 'ArrowRight') { ev.preventDefault(); browseStep(1); return; }
    }
    if (App.page === 'exam' && App.exam) {
      var ke = ev.key;
      if (/^[a-hA-H]$/.test(ke)) {
        var ie = L.LETTERS.indexOf(ke.toUpperCase());
        var qe = App.exam.questions[App.exam.idx];
        if (ie < lettersOf(qe).length) { ev.preventDefault(); examPick(ke.toUpperCase()); }
        return;
      }
      if (ke === 'ArrowLeft' && App.exam.idx > 0) { App.exam.idx -= 1; render(); return; }
      if (ke === 'ArrowRight' && App.exam.idx < App.exam.total - 1) { App.exam.idx += 1; render(); return; }
    }
  });

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (App.page !== 'stats' && App.page !== 'banks' && App.page !== 'browse') return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resizeTimer = null;
      if (App.page === 'stats' || App.page === 'banks' || App.page === 'browse') render();
    }, 180);
  });

  /* ---------------- 启动 ---------------- */
  function boot() {
    App.state = L.loadState(store);
    if (!App.state.seq) App.state.seq = 1;
    fetch('./data/banks.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (json) {
        App.data = json && json.banks ? json : { banks: [] };
        route('home');
        var seq = 1;
        banks().forEach(function (b) { (b.questions || []).forEach(function (q) { if (q.id >= seq) seq = q.id + 1; }); });
        if (!App.state.seq || App.state.seq < seq) { App.state.seq = seq; save(); }
      })
      .catch(function (err) {
        main.innerHTML = '<div class="empty"><b>题库加载失败</b>' + esc(err.message) +
          '<br>请通过 HTTP 访问（例如 GitHub Pages），直接双击本地文件会被浏览器的同源策略拦截。</div>';
      });
  }

  boot();
})();