/* 纯逻辑层断言测试：node site/tests/logic.test.js */
const fs = require('fs');
const path = require('path');
const L = require('../js/logic.js');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { pass++; return; }
  fail++; failures.push(name + (detail ? ' -> ' + detail : ''));
}
function eq(a, b, name) {
  ok(JSON.stringify(a) === JSON.stringify(b), name, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

/* ---------- 1. 判分 ---------- */
const qSingle = { id: 1, qtype: 'single', stem: 's', options: ['a', 'b', 'c'], answer: 'B' };
const qMulti = { id: 2, qtype: 'multiple', stem: 'm', options: ['a', 'b', 'c', 'd'], answer: 'ABC' };
const qJudgeT = { id: 3, qtype: 'judge', stem: 'j', options: ['对', '错'], answer: '对' };
const qJudgeF = { id: 4, qtype: 'judge', stem: 'j', options: ['对', '错'], answer: '错' };
const qFill = { id: 5, qtype: 'fill', stem: 'f', options: [], answer: '局部特征点' };

ok(L.gradeAnswer(qSingle, 'B') === true, '单选正确');
ok(L.gradeAnswer(qSingle, 'A') === false, '单选错误');
ok(L.gradeAnswer(qMulti, 'CAB') === true, '多选顺序无关');
ok(L.gradeAnswer(qMulti, 'AB') === false, '多选少选判错');
ok(L.gradeAnswer(qMulti, ['A', 'B', 'C']) === true, '多选数组入参');
ok(L.gradeAnswer(qJudgeT, 'A') === true, '判断题 对->A');
ok(L.gradeAnswer(qJudgeF, 'B') === true, '判断题 错->B');
ok(L.gradeAnswer(qJudgeT, 'B') === false, '判断题 选反');
ok(L.gradeAnswer(qFill, '随便') === null, '主观题返回 null');
eq(L.normalizeSelection(' b,a ,c '), 'ABC', '规范化去空格逗号并排序');
eq(L.normalizeSelection(''), '', '空作答');
ok(L.accuracy(0, 0) === 0, '除零保护');

/* ---------- 2. 持久化与错题本 ---------- */
const store = (() => {
  let m = {};
  return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, removeItem: k => { delete m[k]; } };
})();
let st = L.loadState(store);
eq(st.records, [], '初始状态为空');
L.recordAnswer(st, qMulti, 'AB', false, 'practice', 1000);
ok(st.wrong['2'] && st.wrong['2'].count === 1 && st.wrong['2'].resolved === 0, '答错写入错题本');
L.recordAnswer(st, qMulti, 'ABC', true, 'practice', 2000);
ok(st.wrong['2'].resolved === 1, '答对置为已消灭');
eq(L.activeWrongIds(st).length, 0, '错题本归零');
L.recordAnswer(st, qSingle, 'A', false, 'practice', 3000);
eq(L.activeWrongIds(st), ['1'], '错题本单题');
ok(L.toggleFav(st, 1) === true && st.favs['1'], '收藏加入');
ok(L.toggleFav(st, 1) === false && !st.favs['1'], '收藏取消');
L.selfGrade(st, qFill, false, '乱答', 4000);
ok(st.wrong['5'] && st.wrong['5'].count === 1, '主观题自评错进错题本');
L.saveState(store, st);
const st2 = L.loadState(store);
eq(st2.records.length, st.records.length, '状态可往返序列化');

/* ---------- 3. 统计 ---------- */
const data = {
  banks: [
    { id: 1, name: 'A库', questions: [qSingle, qMulti, qJudgeT] },
    { id: 2, name: 'B库', questions: [qJudgeF, qFill] }
  ]
};
const s3 = L.emptyState();
L.recordAnswer(s3, qSingle, 'A', false, 'practice', Date.UTC(2026, 0, 1, 10));
L.recordAnswer(s3, qSingle, 'B', true, 'practice', Date.UTC(2026, 0, 1, 11));
L.recordAnswer(s3, qMulti, 'ABC', true, 'practice', Date.UTC(2026, 0, 2, 11));
const ov = L.overview(data, s3);
eq(ov.banks, 2, '统计-题库数');
eq(ov.questions, 5, '统计-题目总数');
eq(ov.answers, 3, '统计-作答次数');
eq(ov.practiced, 2, '统计-去重题目数');
ok(Math.abs(ov.accuracy - 66.7) < 0.05, '统计-次数口径正确率', ov.accuracy);
ok(Math.abs(ov.accuracy_distinct - 100) < 0.05, '统计-去重口径正确率', ov.accuracy_distinct);
eq(ov.wrong, 0, '统计-错题数');
const daily = L.dailyActivity(s3, 3, Date.UTC(2026, 0, 2, 12));
eq(daily.map(d => d.n), [0, 2, 1], '统计-近三日作答分布');
eq(L.streakDays(s3, Date.UTC(2026, 0, 2, 12)), 2, '统计-连续天数');
eq(L.streakDays(s3, Date.UTC(2026, 0, 5, 12)), 0, '统计-中断后为0');
const bs = L.bankStats(data.banks, s3);
eq(bs[0].count, 3, '题库统计-题数');
eq(bs[0].practiced, 2, '题库统计-已练');
eq(bs[1].practiced, 0, '题库统计-未练');

/* ---------- 4. 组卷 ---------- */
const allQ = data.banks.reduce((a, b) => a.concat(b.questions), []);
const sessAll = L.buildSession({ banks: data.banks, state: s3, bankId: 1, scope: 'all', order: 'normal' });
eq(sessAll.questions.length, 3, '组卷-整库');
const sessType = L.buildSession({ banks: data.banks, state: s3, bankId: 1, scope: 'all', types: ['single'], order: 'normal' });
eq(sessType.questions.map(q => q.id), [1], '组卷-题型筛选');
const sessLimit = L.buildSession({ banks: data.banks, state: s3, bankId: 1, scope: 'all', order: 'random', limit: 2 });
eq(sessLimit.questions.length, 2, '组卷-抽题上限');
const sessWrong = L.buildSession({ banks: data.banks, state: s3, bankId: 1, scope: 'wrong', order: 'normal' });
eq(sessWrong.questions.length, 0, '组卷-错题范围（已消灭）');
const sessFav = L.buildSession({ banks: data.banks, state: s3, bankId: 2, scope: 'fav', order: 'normal' });
eq(sessFav.questions.length, 0, '组卷-收藏范围为空');
const shuffled = L.shuffle(allQ);
eq(shuffled.length, allQ.length, '洗牌不丢题');
ok(shuffled.map(q => q.id).sort().join() === allQ.map(q => q.id).sort().join(), '洗牌集合一致');

/* ---------- 5. 导入 ---------- */
const rows = [
  ['题型', '题干', '选项A', '选项B', '选项C', '选项D', '答案', '解析'],
  ['单选题', '第一题', '甲', '乙', '丙', '丁', 'B', '解析1'],
  ['多选题', '第二题', '甲', '乙', '丙', '丁', 'ABD', '解析2'],
  ['判断题', '第三题', '对', '错', '', '', 'A', '解析3'],
  ['填空题', '第四题', '', '', '', '', '（1）答案', '解析4']
];
const warn = [];
const parsed = L.questionsFromRows(rows, 100, warn);
eq(parsed.length, 4, '导入-行数');
eq(parsed[0].qtype, 'single', '导入-单选');
eq(parsed[0].options.length, 4, '导入-选项数');
eq(parsed[1].qtype, 'multiple', '导入-多选');
eq(parsed[2].qtype, 'judge', '导入-判断');
eq(parsed[2].answer, '对', '导入-判断题 A->对');
eq(parsed[2].options, ['对', '错'], '导入-判断题选项固定');
eq(parsed[3].qtype, 'fill', '导入-填空');
eq(parsed[3].options, [], '导入-填空无选项');
ok(parsed.every(q => q.id >= 100), '导入-id 连续');

const csv = '题型,题干,选项A,选项B,答案,解析\n单选题,CSV题,甲,乙,B,ok\n';
const rows2 = L.parseDelimited(csv);
eq(rows2.length, 2, 'CSV-行数');
const p2 = L.questionsFromRows(rows2, 500, []);
eq(p2.length, 1, 'CSV-题目数');
eq(p2[0].stem, 'CSV题', 'CSV-题干');
const dd = L.dedupe([qSingle, qSingle, qMulti], []);
eq(dd.length, 2, '去重-同题干同答案');

/* ---------- 6. 题库数据文件 ---------- */
const dataPath = path.join(__dirname, '..', 'data', 'banks.json');
ok(fs.existsSync(dataPath), '数据文件存在');
if (fs.existsSync(dataPath)) {
  const payload = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  eq(payload.banks.length, 4, '数据-题库数 4');
  const total = payload.banks.reduce((a, b) => a + b.questions.length, 0);
  eq(total, 1239, '数据-总题数 1239');
  const ids = new Set();
  let badOpt = 0, badJudge = 0, empty = 0, dupId = 0;
  payload.banks.forEach(b => b.questions.forEach(q => {
    if (ids.has(q.id)) dupId++; else ids.add(q.id);
    if (!q.stem || !String(q.answer || '').trim()) empty++;
    if (q.qtype === 'judge' && (q.options.join('') !== '对错')) badJudge++;
    if (q.qtype === 'single' || q.qtype === 'multiple') {
      const letters = L.answerLetters(q);
      if (!letters.length || letters.some(L0 => q.options.length < (L0.charCodeAt(0) - 64))) badOpt++;
    }
  }));
  eq(dupId, 0, '数据-id 唯一');
  eq(empty, 0, '数据-无空题干/空答案');
  eq(badJudge, 0, '数据-判断题选项规范');
  eq(badOpt, 0, '数据-选择答案不越界');
  const byType = {};
  payload.banks.forEach(b => b.questions.forEach(q => { byType[q.qtype] = (byType[q.qtype] || 0) + 1; }));
  eq(byType.single, 647, '数据-单选 647');
  eq(byType.multiple, 43, '数据-多选 43');
  eq(byType.judge, 319, '数据-判断 319');
  eq(byType.fill, 230, '数据-填空/简答 230');
}


/* ---------- 7. 填空题分空 ---------- */
eq(L.blankCount('基于特征的匹配首先提取图像中的_________（如SIFT）并_____匹配'), 2, '分空-下划线计数');
eq(L.blankCount('空域滤波是在___1___对图像像素操作，频域滤波在___2___'), 2, '分空-编号下划线');
eq(L.blankCount('突变'), 1, '分空-无空位按 1');
eq(L.blankCount('（1）甲（2）乙（3）丙'), 3, '分空-括号编号');
eq(L.splitFillAnswer('（1）局部特征点；（2）最近邻搜索'), ['局部特征点', '最近邻搜索'], '分空-去序号并切分');
eq(L.splitFillAnswer('突变'), ['突变'], '分空-单答案');
eq(L.splitFillAnswer('（1）甲（2）乙'), ['甲', '乙'], '分空-仅括号编号也可切');
ok(L.fillPartsEqual('局部特征点 ', '局部特征点'), '分空-忽略空格判等');
ok(L.fillPartsEqual('“局部特征点”', '局部特征点'), '分空-忽略引号判等');
ok(!L.fillPartsEqual('最近邻', '最近邻搜索'), '分空-不完全一致为假');
ok(!L.fillPartsEqual('', ''), '分空-双空不算通过');


/* ---------- 7b. 圆圈数字分点（真实题库形态） ---------- */
eq(L.splitFillAnswer('①监督学习 ②无监督学习 ③半监督学习 ④强化学习'),
   ['监督学习','无监督学习','半监督学习','强化学习'], '分空-圆圈数字');
eq(L.splitFillAnswer('①CCD ②CMOS'), ['CCD','CMOS'], '分空-圆圈数字2');
eq(L.splitFillAnswer('（1）空间域；（2）频率域'), ['空间域','频率域'], '分空-括号+分号');
eq(L.splitFillAnswer(['甲','乙','丙'].join(String.fromCharCode(10))), ['甲','乙','丙'], '分空-换行');
eq(L.blankCount('可分为____1____和____2____，其中____1____具有高灵敏度'), 2, '分空-重复编号只算一次');
eq(L.blankCount('分为____、____、____、____'), 4, '分空-四个裸空');
eq(L.blankCount('空域滤波是在___1___对像素操作，频域在___2___'), 2, '分空-编号空');


/* ---------- 7c. 小数不能被当成序号吃掉 ---------- */
eq(L.splitFillAnswer('（1）2w；（2）1.5h'), ['2w', '1.5h'], '分空-保留小数 1.5h');
eq(L.splitFillAnswer('1.局部特征点；2.最近邻搜索'), ['局部特征点', '最近邻搜索'], '分空-去「1.」序号');
eq(L.splitFillAnswer('2w；1.5h'), ['2w', '1.5h'], '分空-纯小数答案');

/* ---------- 输出 ---------- */
console.log('PASS ' + pass + ' FAIL ' + fail);
if (fail) {
  failures.slice(0, 12).forEach(f => console.log('  FAIL: ' + f));
  process.exit(1);
}