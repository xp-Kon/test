/* 契约测试：app.js 用到的每个 L.* 必须在 logic.js 里存在；data 字段与页面引用一致。
   node site/tests/api.test.js */
const fs = require('fs');
const path = require('path');
const L = require('../js/logic.js');

let pass = 0, fail = 0;
const fails = [];
function ok(c, n, d) {
  if (c) { pass++; return; }
  fail++; fails.push(n + (d ? ' -> ' + d : ''));
}

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const used = new Set();
const re = /\bL\.([A-Za-z_$][\w$]*)/g;
let m;
while ((m = re.exec(appSrc))) used.add(m[1]);
const missing = [...used].filter(k => L[k] === undefined);
ok(missing.length === 0, 'app.js 引用的逻辑函数都存在', 'missing=' + missing.join(','));

// data-act 覆盖：每个 switch case 里处理的 act 都在 HTML 中至少出现过一次
const acts = new Set();
const ar = /data-act="([a-z-]+)"/g;
while ((m = ar.exec(appSrc))) acts.add(m[1]);
const handled = new Set();
const cr = /case '([a-z-]+)'/g;
while ((m = cr.exec(appSrc))) handled.add(m[1]);
const unhandled = [...acts].filter(a => !handled.has(a));
ok(unhandled.length === 0, '所有 data-act 都有事件处理', 'unhandled=' + unhandled.join(','));

// 关键交互标记存在
['答对自动进入下一题', 'scheduleAdvance', 'confirmPractice', 'submitExam', 'renderStats', 'renderList'].forEach(k => {
  ok(appSrc.includes(k), 'app.js 含 ' + k);
});

// 首页导航与 logic 类型表一致
['single', 'multiple', 'judge', 'fill'].forEach(t => {
  ok(!!L.TYPE_NAMES[t], 'type name 完整 ' + t);
  ok(Array.isArray(L.TYPE_COLORS[t]), 'type color 完整 ' + t);
});

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'banks.json'), 'utf8'));
const stats = L.bankStats(data.banks, L.emptyState());
ok(stats.length === 4, 'bankStats 覆盖 4 个题库', 'got ' + stats.length);
const total = stats.reduce((a, b) => a + b.count, 0);
ok(total === 1239, 'bankStats 题目合计 1239', 'got ' + total);
ok(stats.every(s => s.attempts === 0 && s.accuracy === 0), '未练习时统计为零');

const sess = L.buildSession({ banks: data.banks, state: L.emptyState(), bankId: data.banks[0].id, scope: 'all', order: 'normal' });
ok(sess.questions.length === data.banks[0].questions.length, '组卷-整库题数一致');
ok(sess.bank && sess.bank.id === data.banks[0].id, '组卷-返回题库对象');

console.log('PASS ' + pass + ' FAIL ' + fail);
if (fail) { fails.slice(0, 10).forEach(f => console.log('  FAIL: ' + f)); process.exit(1); }