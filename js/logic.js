/*!
 * 智题 Web 版 · 纯逻辑层（无 DOM 依赖，可在 Node 下直接单测）
 * 判分/统计/持久化口径与移植版 core/grading.py、core/db.py 保持一致。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.QuizLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SINGLE = 'single', MULTIPLE = 'multiple', JUDGE = 'judge', FILL = 'fill';

  var TYPE_NAMES = {};
  TYPE_NAMES[SINGLE] = '单选题';
  TYPE_NAMES[MULTIPLE] = '多选题';
  TYPE_NAMES[JUDGE] = '判断题';
  TYPE_NAMES[FILL] = '填空/简答';

  var TYPE_COLORS = {};
  TYPE_COLORS[SINGLE] = ['#EEF2FF', '#4F46E5'];
  TYPE_COLORS[MULTIPLE] = ['#FDF4FF', '#A21CAF'];
  TYPE_COLORS[JUDGE] = ['#ECFDF5', '#047857'];
  TYPE_COLORS[FILL] = ['#FFFBEB', '#B45309'];

  var LETTERS = 'ABCDEFGH';
  var STORE_KEY = 'quizmaster.web.v1';
  var MAX_RECORDS = 5000;

  /* ---------------- 判分 ---------------- */

  function answerLetters(q) {
    if (!q) return [];
    if (q.qtype === JUDGE) {
      var a = String(q.answer || '').trim();
      if (a === '对') return ['A'];
      if (a === '错') return ['B'];
      return [];
    }
    if (q.qtype === SINGLE || q.qtype === MULTIPLE) {
      return normalizeSelection(q.answer).split('');
    }
    return [];
  }

  function normalizeSelection(sel) {
    if (sel === null || sel === undefined) return '';
    var raw = Array.isArray(sel) ? sel.join('') : String(sel);
    var out = {};
    raw.replace(/[\s,，、;；]/g, '').toUpperCase().split('').forEach(function (ch) {
      if (ch >= 'A' && ch <= 'H') out[ch] = 1;
    });
    return Object.keys(out).sort().join('');
  }

  /** true / false；主观题返回 null（需自评） */
  function gradeAnswer(q, selected) {
    if (!q) return false;
    if (q.qtype === FILL) return null;
    var want = answerLetters(q).join('');
    return normalizeSelection(selected) === want;
  }

  function isSubjective(q) { return !q || q.qtype === FILL; }

  /** 正确率百分比，分母 0 → 0 */
  function accuracy(correct, total) {
    if (!total || total <= 0) return 0;
    return correct * 100 / total;
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  /* ---------------- 持久化 ---------------- */

  function emptyState() {
    return { v: 1, records: [], wrong: {}, favs: {}, exams: [], imported: [], seq: 1 };
  }

  function loadState(backend) {
    try {
      var raw = backend.getItem(STORE_KEY);
      if (!raw) return emptyState();
      var s = JSON.parse(raw);
      if (!s || typeof s !== 'object') return emptyState();
      var base = emptyState();
      Object.keys(base).forEach(function (k) {
        if (s[k] === undefined) s[k] = base[k];
      });
      if (!Array.isArray(s.records)) s.records = [];
      if (!Array.isArray(s.exams)) s.exams = [];
      if (!Array.isArray(s.imported)) s.imported = [];
      if (!s.wrong || typeof s.wrong !== 'object') s.wrong = {};
      if (!s.favs || typeof s.favs !== 'object') s.favs = {};
      return s;
    } catch (e) {
      return emptyState();
    }
  }

  function saveState(backend, state) {
    try {
      if (state.records.length > MAX_RECORDS) {
        state.records = state.records.slice(state.records.length - MAX_RECORDS);
      }
      backend.setItem(STORE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 记录一次作答；ok 为 null 表示主观题待自评 */
  function recordAnswer(state, q, selected, ok, mode, now) {
    var sel = normalizeSelection(selected);
    var ts = now || Date.now();
    var entry = { qid: q.id, sel: q.qtype === FILL ? String(selected || '').slice(0, 500) : sel,
                  ok: ok === null ? null : (ok ? 1 : 0), mode: mode || 'practice', ts: ts };
    state.records.push(entry);

    if (q.qtype === FILL) return entry;   // 主观题不进错题本，等自评结果再决定

    if (ok) {
      if (state.wrong[q.id]) state.wrong[q.id].resolved = 1;
    } else {
      var w = state.wrong[q.id] || { count: 0, last: 0, resolved: 0 };
      w.count += 1;
      w.last = ts;
      w.resolved = 0;
      state.wrong[q.id] = w;
    }
    return entry;
  }

  /** 主观题自评：把最后一条待评记录改成对/错，并同步错题本 */
  function selfGrade(state, q, ok, selected, now) {
    var ts = now || Date.now();
    var sel = String(selected === undefined ? '' : selected).slice(0, 500);
    state.records.push({ qid: q.id, sel: sel, ok: ok ? 1 : 0, mode: 'practice', ts: ts });
    if (ok) {
      if (state.wrong[q.id]) state.wrong[q.id].resolved = 1;
    } else {
      var w = state.wrong[q.id] || { count: 0, last: 0, resolved: 0 };
      w.count += 1;
      w.last = ts;
      w.resolved = 0;
      state.wrong[q.id] = w;
    }
  }

  function toggleFav(state, qid, now) {
    if (state.favs[qid]) {
      delete state.favs[qid];
      return false;
    }
    state.favs[qid] = now || Date.now();
    return true;
  }

  function resolveWrong(state, qid) {
    if (state.wrong[qid]) state.wrong[qid].resolved = 1;
  }

  function activeWrongIds(state) {
    return Object.keys(state.wrong).filter(function (k) { return !state.wrong[k].resolved; });
  }

  /* ---------------- 题库视图 ---------------- */

  function allBanks(data, state) {
    var banks = (data && data.banks ? data.banks : []).concat(state.imported || []);
    return banks;
  }

  function bankQuestions(bank) { return bank && bank.questions ? bank.questions : []; }

  function findQuestion(banks, qid) {
    for (var i = 0; i < banks.length; i++) {
      var qs = bankQuestions(banks[i]);
      for (var j = 0; j < qs.length; j++) if (qs[j].id === qid) return qs[j];
    }
    return null;
  }

  function bankIndex(banks) {
    var map = {};
    banks.forEach(function (b) {
      bankQuestions(b).forEach(function (q) { map[q.id] = b.id; });
    });
    return map;
  }

  function bankStats(banks, state) {
    var recs = state.records;
    var byBank = {};
    banks.forEach(function (b) {
      byBank[b.id] = { id: b.id, name: b.name, source: b.source || '', count: 0,
                       single: 0, multiple: 0, judge: 0, fill: 0,
                       attempts: 0, correct: 0, practiced: 0, accuracy: 0, wrong: 0, favorites: 0 };
    });
    banks.forEach(function (b) {
      var st = byBank[b.id];
      bankQuestions(b).forEach(function (q) {
        st.count += 1;
        if (st[q.qtype] !== undefined) st[q.qtype] += 1;
      });
    });
    var q2bank = bankIndex(banks);
    var seen = {};
    recs.forEach(function (r) {
      var bid = q2bank[r.qid];
      if (bid === undefined || !byBank[bid]) return;
      var st = byBank[bid];
      st.attempts += 1;
      if (r.ok === 1) st.correct += 1;
      var key = bid + ':' + r.qid;
      if (!seen[key]) { seen[key] = 1; st.practiced += 1; }
    });
    var wrongBank = {};
    Object.keys(state.wrong).forEach(function (qid) {
      var w = state.wrong[qid];
      if (w.resolved) return;
      var bid = q2bank[qid];
      if (bid !== undefined && byBank[bid]) byBank[bid].wrong += 1;
    });
    Object.keys(state.favs).forEach(function (qid) {
      var bid = q2bank[qid];
      if (bid !== undefined && byBank[bid]) byBank[bid].favorites += 1;
    });
    return banks.map(function (b) {
      var st = byBank[b.id];
      st.accuracy = round1(accuracy(st.correct, st.attempts));
      return st;
    });
  }

  /* ---------------- 统计 ---------------- */

  function dayKey(ts) {
    var d = new Date(ts);
    var m = String(d.getMonth() + 1);
    var day = String(d.getDate());
    return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day);
  }

  function overview(data, state) {
    var banks = allBanks(data, state);
    var q2bank = bankIndex(banks);
    var s = { banks: banks.length, questions: 0, answers: 0, correct: 0, accuracy: 0,
              practiced: 0, accuracy_distinct: 0, wrong: activeWrongIds(state).length,
              favorites: Object.keys(state.favs).length, exams: state.exams.length };
    banks.forEach(function (b) { s.questions += bankQuestions(b).length; });

    var lastByQ = {};
    state.records.forEach(function (r) {
      if (q2bank[r.qid] === undefined) return;
      s.answers += 1;
      if (r.ok === 1) s.correct += 1;
      if (r.ok === null || r.ok === undefined) return;
      lastByQ[r.qid] = r.ok;
    });
    s.accuracy = round1(accuracy(s.correct, s.answers));
    var ids = Object.keys(lastByQ);
    s.practiced = ids.length;
    var okq = ids.filter(function (k) { return lastByQ[k] === 1; }).length;
    s.accuracy_distinct = round1(accuracy(okq, ids.length));
    return s;
  }

  function dailyActivity(state, days, nowTs) {
    var now = nowTs ? new Date(nowTs) : new Date();
    var buckets = {};
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      buckets[dayKey(d.getTime())] = { day: dayKey(d.getTime()), n: 0, ok: 0 };
    }
    state.records.forEach(function (r) {
      var k = dayKey(r.ts);
      if (buckets[k]) {
        buckets[k].n += 1;
        if (r.ok === 1) buckets[k].ok += 1;
      }
    });
    return Object.keys(buckets).sort().map(function (k) { return buckets[k]; });
  }

  function accuracyByBank(data, state) {
    return bankStats(allBanks(data, state), state)
      .filter(function (b) { return b.attempts > 0; })
      .sort(function (a, b) { return b.attempts - a.attempts; })
      .slice(0, 8)
      .map(function (b) { return { name: b.name, n: b.attempts, accuracy: b.accuracy }; });
  }

  function typeDistribution(data, state) {
    var banks = allBanks(data, state);
    var out = { single: 0, multiple: 0, judge: 0, fill: 0 };
    banks.forEach(function (b) {
      bankQuestions(b).forEach(function (q) { if (out[q.qtype] !== undefined) out[q.qtype] += 1; });
    });
    return [SINGLE, MULTIPLE, JUDGE, FILL].map(function (k) { return { qtype: k, n: out[k] }; });
  }

  function streakDays(state, nowTs) {
    var now = nowTs ? new Date(nowTs) : new Date();
    var have = {};
    state.records.forEach(function (r) { have[dayKey(r.ts)] = 1; });
    var DAY = 86400000;
    var cur = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (!have[dayKey(cur)]) {
      cur -= DAY;
      if (!have[dayKey(cur)]) return 0;
    }
    var n = 0;
    while (have[dayKey(cur)]) { n += 1; cur -= DAY; }
    return n;
  }

  /* ---------------- 组卷 ---------------- */

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /**
   * 组卷：与桌面版 PracticePage._start / ExamPage._start 等价，
   * 并修正「随机 + 只练错题」不生效的问题（错题/收藏范围也支持随机）。
   */
  function buildSession(opts) {
    var banks = opts.banks, state = opts.state;
    var bankId = opts.bankId, scope = opts.scope || 'all', order = opts.order || 'normal';
    var types = opts.types && opts.types.length ? opts.types : null;
    var limit = opts.limit || 0;

    var bank = null;
    for (var i = 0; i < banks.length; i++) if (banks[i].id === bankId) bank = banks[i];
    var pool;
    if (scope === 'wrong' || scope === 'fav') {
      var ids = scope === 'wrong' ? activeWrongIds(state)
                                  : Object.keys(state.favs);
      var all = [];
      banks.forEach(function (b) { all = all.concat(bankQuestions(b)); });
      var set = {};
      ids.forEach(function (k) { set[k] = 1; });
      pool = all.filter(function (q) { return set[q.id]; });
      if (bankId && bank) {
        var bankQ = {};
        bankQuestions(bank).forEach(function (q) { bankQ[q.id] = 1; });
        pool = pool.filter(function (q) { return bankQ[q.id]; });
      }
    } else {
      pool = bank ? bankQuestions(bank).slice() : [];
    }
    if (types) pool = pool.filter(function (q) { return types.indexOf(q.qtype) >= 0; });
    if (order === 'random') pool = shuffle(pool);
    if (limit > 0) pool = pool.slice(0, limit);
    return { questions: pool, bank: bank };
  }

  /* ---------------- 导入（CSV / TXT） ---------------- */

  var STEM_KEYS = ['题干', '题目', '题面', '试题内容', '问题', '试题', 'question'];
  var ANSWER_KEYS = ['正确答案', '参考答案', '标准答案', '答案', 'answer', 'key'];
  var ANALYSIS_KEYS = ['答案解析', '试题解析', '解析', '解释', '说明', 'analysis', 'explanation'];
  var TYPE_KEYS = ['题型', '类型', '试题类型', '题目类型', 'type'];

  function splitCsvLine(line, delim) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (q) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
        } else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(function (s) { return s.trim(); });
  }

  function detectDelim(sample) {
    var cands = [',', ';', '\t', '|'];
    var best = ',', bestN = -1;
    cands.forEach(function (d) {
      var n = sample.split(d).length - 1;
      if (n > bestN) { bestN = n; best = d; }
    });
    return best;
  }

  function normType(t) {
    t = String(t || '').trim();
    if (!t) return null;
    if (t.indexOf('多') >= 0) return MULTIPLE;
    if (t.indexOf('单') >= 0 || t.indexOf('选择') >= 0) return SINGLE;
    if (t.indexOf('判断') >= 0) return JUDGE;
    if (t.indexOf('填空') >= 0 || t.indexOf('简答') >= 0 || t.indexOf('问答') >= 0) return FILL;
    return null;
  }

  function normAnswer(raw, qtype) {
    var text = String(raw || '').trim();
    var core = text.replace(/[。，,；;.、:：)）\s]+$/g, '').trim();
    if (!core) return { answer: '', type: null };
    var low = core.toLowerCase();
    if (['对', '正确', '√', 't', 'true', 'y', 'yes', '是', 'right'].indexOf(low) >= 0)
      return { answer: '对', type: JUDGE };
    if (['错', '错误', '×', '✗', 'f', 'false', 'n', 'no', '否', 'wrong'].indexOf(low) >= 0)
      return { answer: '错', type: JUDGE };
    if (qtype === JUDGE) {
      if (low === 'a') return { answer: '对', type: JUDGE };
      if (low === 'b') return { answer: '错', type: JUDGE };
    }
    if (qtype === FILL) return { answer: text, type: FILL };
    var letters = core.match(/[A-Ha-h]/g);
    if (letters && /^[\s,A-Ha-h、.;；\/]+$/.test(core)) {
      var uniq = {};
      letters.forEach(function (c) { uniq[c.toUpperCase()] = 1; });
      var ans = Object.keys(uniq).sort().join('');
      return { answer: ans, type: ans.length > 1 ? MULTIPLE : SINGLE };
    }
    return { answer: text, type: FILL };
  }

  function cellOf(row, idx) { return idx >= 0 && idx < row.length ? String(row[idx] || '').trim() : ''; }

  function isOptionHeader(cell) {
    var m = /^(?:选项|答案)?\s*[（(]?([A-Ha-h])[)）]?\s*[-_]?\s*(?:内容|文本|标题)?$/.exec(String(cell || '').trim());
    return m ? m[1].toUpperCase() : null;
  }

  /** 从二维表构建题目（对齐 parser.parse_table 的表头探测 + 无表头启发式） */
  function questionsFromRows(rows, startId, warnings) {
    var out = [];
    warnings = warnings || [];
    var clean = rows.map(function (r) { return r.map(function (c) { return String(c === null || c === undefined ? '' : c).trim(); }); })
                    .filter(function (r) { return r.some(function (c) { return c !== ''; }); });
    if (!clean.length) return out;
    var ncol = Math.max.apply(null, clean.map(function (r) { return r.length; }));
    clean = clean.map(function (r) { while (r.length < ncol) r.push(''); return r; });

    var headerRow = -1, map = null;
    for (var i = 0; i < Math.min(3, clean.length); i++) {
      var row = clean[i], m = { stem: -1, answer: -1, analysis: -1, type: -1, opts: {} };
      for (var j = 0; j < row.length; j++) {
        var cell = row[j].trim();
        if (!cell) continue;
        var cl = cell.toLowerCase();
        if (STEM_KEYS.indexOf(cl) >= 0) m.stem = j;
        else if (ANSWER_KEYS.indexOf(cl) >= 0) m.answer = j;
        else if (ANALYSIS_KEYS.indexOf(cl) >= 0) m.analysis = j;
        else if (TYPE_KEYS.indexOf(cl) >= 0) m.type = j;
        else {
          var L = isOptionHeader(cell);
          if (L) m.opts[j] = L;
        }
      }
      if (m.stem >= 0 && (m.answer >= 0 || Object.keys(m.opts).length)) { map = m; headerRow = i; break; }
    }

    var nextId = startId;
    if (headerRow >= 0) {
      for (var k = headerRow + 1; k < clean.length; k++) {
        var r = clean[k];
        var stem = cellOf(r, map.stem);
        if (!stem) continue;
        var rawAnswer = cellOf(r, map.answer);
        var analysis = cellOf(r, map.analysis);
        var qtype = map.type >= 0 ? normType(cellOf(r, map.type)) : null;
        var texts = [];
        Object.keys(map.opts).map(Number).sort(function (a, b) { return a - b; }).forEach(function (col) {
          if (r[col]) texts.push(r[col]);
        });
        if (!texts.length && map.answer > map.stem) {
          for (var c = map.stem + 1; c < map.answer; c++) if (r[c]) texts.push(r[c]);
        }
        var na = normAnswer(rawAnswer, qtype);
        var finalType = qtype || na.type;
        if (finalType === JUDGE) {
          out.push({ id: nextId++, qtype: JUDGE, stem: stem, options: ['对', '错'],
                     answer: (na.answer === '对' || na.answer === '错') ? na.answer : '', analysis: analysis });
        } else if (finalType === SINGLE || finalType === MULTIPLE) {
          if (!texts.length) warnings.push('选项列缺失，仅保留题干与答案：' + stem.slice(0, 18));
          out.push({ id: nextId++, qtype: finalType, stem: stem, options: texts, answer: na.answer, analysis: analysis });
        } else if (finalType === FILL) {
          out.push({ id: nextId++, qtype: FILL, stem: stem, options: [], answer: na.answer, analysis: analysis });
        } else if (texts.length && na.answer) {
          out.push({ id: nextId++, qtype: na.answer.length > 1 ? MULTIPLE : SINGLE,
                     stem: stem, options: texts, answer: na.answer, analysis: analysis });
        } else {
          out.push({ id: nextId++, qtype: FILL, stem: stem, options: [], answer: na.answer, analysis: analysis });
        }
      }
      return out;
    }

    /* 无表头：找答案列 + 题干列，中间列为选项 */
    var scores = new Array(ncol).fill(0);
    clean.forEach(function (r) {
      r.forEach(function (cell, j) {
        var s = cell.trim().toLowerCase().replace(/[。，,;；.、\s]+$/g, '');
        if (!s) return;
        if (/^[\s,A-Ha-h、.]{1,16}$/.test(s) && /[A-Ha-h]/.test(s)) scores[j] += 1;
        if (['对', '错', '正确', '错误'].indexOf(s) >= 0) scores[j] += 2;
      });
    });
    var bestAns = 0;
    for (var x = 1; x < ncol; x++) if (scores[x] > scores[bestAns]) bestAns = x;
    if (!scores[bestAns]) bestAns = -1;
    var stemScore = new Array(ncol).fill(0);
    clean.forEach(function (r) {
      var idx = 0, len = -1;
      r.forEach(function (cell, j) { if (cell.length > len) { len = cell.length; idx = j; } });
      stemScore[idx] += 1;
    });
    var stemCol = 0;
    for (var y = 1; y < ncol; y++) if (stemScore[y] > stemScore[stemCol]) stemCol = y;
    if (stemCol === bestAns) bestAns = -1;

    for (var n = 0; n < clean.length; n++) {
      var rr = clean[n];
      var st = rr[stemCol];
      if (!st) continue;
      var ans = bestAns >= 0 ? rr[bestAns] : '';
      var opts = [];
      for (var z = stemCol + 1; z < ncol; z++) if (z !== bestAns && rr[z]) opts.push(rr[z]);
      var na2 = normAnswer(ans, null);
      var qt = na2.type;
      if (qt === JUDGE) {
        out.push({ id: nextId++, qtype: JUDGE, stem: st, options: ['对', '错'], answer: na2.answer, analysis: '' });
      } else if (opts.length) {
        var t2 = qt === MULTIPLE || qt === SINGLE ? qt : (na2.answer.length > 1 ? MULTIPLE : SINGLE);
        out.push({ id: nextId++, qtype: t2, stem: st, options: opts, answer: na2.answer, analysis: '' });
      } else {
        out.push({ id: nextId++, qtype: FILL, stem: st, options: [], answer: na2.answer, analysis: '' });
      }
    }
    if (bestAns < 0) warnings.push('未找到答案列，题目答案为空');
    return out;
  }

  function parseDelimited(text) {
    var lines = String(text).replace(/\r\n?/g, '\n').split('\n').filter(function (l) { return l.trim() !== ''; });
    if (!lines.length) return [];
    var delim = detectDelim(lines.slice(0, 3).join('\n'));
    return lines.map(function (l) { return splitCsvLine(l, delim); });
  }

  function dedupe(questions, warnings) {
    var seen = {}, out = [], dup = 0;
    questions.forEach(function (q) {
      var key = q.stem.slice(0, 120) + '\u0001' + (q.answer || '');
      if (seen[key]) { dup += 1; return; }
      seen[key] = 1;
      out.push(q);
    });
    if (dup && warnings) warnings.push('跳过重复题目 ' + dup + ' 道');
    return out;
  }

  return {
    SINGLE: SINGLE, MULTIPLE: MULTIPLE, JUDGE: JUDGE, FILL: FILL,
    TYPE_NAMES: TYPE_NAMES, TYPE_COLORS: TYPE_COLORS, LETTERS: LETTERS,
    STORE_KEY: STORE_KEY,
    answerLetters: answerLetters, normalizeSelection: normalizeSelection,
    gradeAnswer: gradeAnswer, isSubjective: isSubjective,
    accuracy: accuracy, round1: round1,
    emptyState: emptyState, loadState: loadState, saveState: saveState,
    recordAnswer: recordAnswer, selfGrade: selfGrade, toggleFav: toggleFav,
    resolveWrong: resolveWrong, activeWrongIds: activeWrongIds,
    allBanks: allBanks, bankQuestions: bankQuestions, findQuestion: findQuestion,
    bankIndex: bankIndex, bankStats: bankStats,
    overview: overview, dailyActivity: dailyActivity, accuracyByBank: accuracyByBank,
    typeDistribution: typeDistribution, streakDays: streakDays,
    shuffle: shuffle, buildSession: buildSession,
    questionsFromRows: questionsFromRows, parseDelimited: parseDelimited,
    normAnswer: normAnswer, normType: normType, dedupe: dedupe
  };
});