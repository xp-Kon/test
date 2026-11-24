# 缺陷清单与修复对照

分三档：
- **[确认]** 反汇编可直接定位到字节码依据，可复现。
- **[推断]** 重建源码显示如此，语义明确但未跑桌面版实测。
- **[设计]** 统计/交互口径本身矛盾，属于产品级缺陷。

Web 版修复位置见「修复于」列。

## 解析层

| # | 等级 | 缺陷 | 依据 | 后果 | 修复于 |
| --- | --- | --- | --- | --- | --- |
| P1 | 确认 | `_parse_table_no_header` 把 `_build_question()` 的返回值直接 `append`，后者在「选项字母不连续」时返回 `None` | 反汇编 431 行块：`LOAD_ATTR append` → `LOAD_GLOBAL _build_question` → `CALL`，无 None 过滤 | 随后 `parse_file` 执行 `q.stem` 抛 `AttributeError`，整个导入失败（不是跳过一题） | `web/core/parser.py` 过滤 `None` + 告警；`site/js/logic.js` 导入同样守卫 |
| P2 | 确认 | 答案规整只 `strip('。，,；; ')`，不处理 `.` `、` `:` `)` | 常量表只有 `。，,；; ` 与 `\s` | 判断题写 `A.` / `B、` 时 A/B→对/错 映射失效，判断题被当成单选的字母答案 | `_norm_answer` 扩展 strip 集合 |
| P3 | 确认 | 去重条件是「重复 **且** 无答案才跳过」 | 重建源码 `if key in seen and not q.answer: continue` | 带答案的完全重复题被重复导入。实测：机器视觉 510 行里有 **58 行** (题干,答案) 完全相同、AI 题库 5 行、机器学习 4 行 | 改为按 (题干, 答案) 去重并回传「跳过重复 N 道」 |
| P4 | 推断 | `parse_xlsx` 用 `str(v)` 转单元格，浮点整数变 `'1.0'` | 重建源码 `str(v) if v is not None else ''` | 题干/答案为数字时出现 `1.0`，与用户输入 `1` 不匹配 | `_cell_text()` 整数值还原 |
| P5 | 设计 | 工作表明细 warning 只在「多于 1 个工作表」时追加，单表解析出 0 题时无任何提示 | 重建源码条件 `if len(wb.worksheets) > 1 and qs` | 用户以为导入成功但题目为 0，无原因提示 | Web 版导入后直接展示识别题数与告警列表 |

## 判分层

| # | 等级 | 缺陷 | 依据 | 后果 | 修复于 |
| --- | --- | --- | --- | --- | --- |
| G1 | 确认 | 考试评分里填空题/简答题 **恒判错**：`if q.qtype == FILL: ok = False` | `exam_page._submit` 字节码该分支直接 `LOAD_CONST False` | 只要抽到填空/简答题就必丢分，题库里这类题占比很高（机器学习 180 题中 64 题、机器视觉 452 题中 109 题） | 主观题返回 `null`（待自评），不计入机评分母；考试默认不抽主观题 |
| G2 | 确认 | 考试多选题用字符串整串比较 `sel.replace(' ','').upper() == answer.replace(' ','').upper()` | 同上分支 | 与练习页的集合比较口径不一致；答案顺序不同（`BA` vs `AB`）即判错。练习页 `current_answer()` 恰好做了 `sorted()`，才掩盖了这个问题 | 统一为集合比较（`core/grading.py`、`js/logic.js`） |
| G3 | 确认 | 练习页多选题要求选择集合 **完全相等**，无部分给分 | `QuestionView._is_correct`: `sel == self._answer_letters()` | 多选题错一个选项即 0 分（保留原语义，但已在文档中明确） | 保持严格相等，口径写进说明 |
| G4 | 确认 | `_is_correct()` 对 `FILL` 直接 `return False`，靠 `judge_box` 让用户自评 | `widgets._is_correct` 首行 | 若未点自评按钮就切题，该题不产生作答记录，统计里静默丢失 | Web 版自评按钮常驻，且「待自评」单独计数 |
| G5 | 确认 | 键盘 `Enter` 在多选/填空确认后直接 `return`，不进入下一题 | `practice_page._on_key` 分支注释处 | 需再按一次 Enter，交互割裂 | Web 版：答对自动下一题；未答时 Enter 先确认 |

## 存储层

| # | 等级 | 缺陷 | 依据 | 后果 | 修复于 |
| --- | --- | --- | --- | --- | --- |
| S1 | 确认 | `_conn()` 返回裸连接，调用方一律 `with _conn() as c` | 重建源码 `_conn` 返回 `conn`；`with sqlite3.Connection` 只提交不关闭 | 每次查询泄漏一个连接/文件句柄，长时间使用会堆积 | contextmanager：`yield` 后 `commit` 并 `close` |
| S2 | 确认 | `os.makedirs(d, True, exist_ok=True)`：第二个位置参数是 `mode` | 反汇编 `LOAD_CONST True` 作为第 2 个位置实参 + `CALL_KW exist_ok` | `True` == `0o1`，POSIX 上建出的数据目录权限为「仅执行」，程序自己都读不了 | `os.makedirs(d, exist_ok=True)` |
| S3 | 确认 | `recent_exams` 里 `json.loads(d['detail'] or '{}')` 无 `try` | 重建源码 | `exams.detail` 被写坏（例如手工改库）时首页/考试页整体崩溃 | 解析失败降级为 `{}` |
| S4 | 确认 | schema 里没有一条 `FOREIGN KEY`，却执行 `PRAGMA foreign_keys = ON` | `_SCHEMA` 全文 + PRAGMA 调用 | 级联完全靠手写 DELETE；任何遗漏路径都会留下孤儿记录 | 显式级联 + 删除用子查询（S8） |
| S5 | 确认 | `add_bank` 用 `q.valid()` 静默丢弃无答案题，且 `order_idx` 用 `enumerate` 原始下标 | 重建源码 `if not q.valid(): continue` + `rows.append((..., i))` | 用户不知道少了几道；题序号出现空洞（例如 1,2,4,5） | 不丢数据、序号连续、跳过数量回传前端 |
| S6 | 确认 | `get_question_bank()` 用 `0` 当「题目不存在」的哨兵 | 重建源码 `return r['bank_id'] if r else 0` | 题目被删而错题记录残留时，会把 `bank_id=0` 写进 `wrong_book`，污染统计 | 返回 `None` 并跳过写入 |
| S7 | 推断 | `delete_bank` 用 `f-string` 拼 `IN (?,?,…)` 占位符 | 重建源码 `marks = ','.join('?' * len(qids))` | 非注入（全为占位符），但题目数上万时会触发 SQLite 变量上限（默认 999），删除直接失败 | 改子查询 `IN (SELECT id FROM questions WHERE bank_id=?)` |
| S8 | 设计 | `list_banks` 每个题库再查 5 次（题数、正确率、错题、收藏） | 重建源码循环内 5 条 SQL | N+1，题库多时列表明显卡顿 | 固定 3 条聚合查询 |
| S9 | 设计 | 正确率口径混用：`practiced` 用 `COUNT(DISTINCT question_id)`，`accuracy` 用 `SUM(correct)/COUNT(*)`（作答次数） | 同一句 SQL 内两个聚合 | 界面上「已练 12 题，正确率 60%」两数不可互相验算，用户会以为算错 | 同时给出「次数口径」与「题目口径」两项 |

## 统计层

| # | 等级 | 缺陷 | 依据 | 后果 | 修复于 |
| --- | --- | --- | --- | --- | --- |
| T1 | 确认 | `daily_activity` 在循环里反复 `datetime.now()` | 重建源码 `for i in range(days): d = (datetime.now() - ...)` | 跨午夜时日期错位，最近一天可能重复或缺失 | 循环外取一次 `today` |
| T2 | 推断 | 连续打卡在原版不存在（本次新增），但错题/收藏范围在随机模式下列表不随机 | `practice_page._start`：`storage.wrong_questions(bank_id)` 未传 `order` | 「随机练习 + 只练错题」实际按固定顺序，功能名不副实 | `buildSession` 对三种范围统一支持随机 |

## 交互层

| # | 等级 | 缺陷 | 依据 | 后果 | 修复于 |
| --- | --- | --- | --- | --- | --- |
| U1 | 确认 | 启动器里 `for i, (k, t) in enumerate(...): self.scope_group.idClicked.connect(lambda: None)` 在循环内重复连接 3 次，且回调是空 lambda | `practice_page._build_launcher` | 死代码 + 重复连接（原意疑为切换范围时刷新提示） | Web 版用原生 radio，无重复绑定 |
| U2 | 确认 | `_on_key` 里 `if seq_u in letters:` 分支内部又判断 `if seq in ("1"..."8")` | 反汇编该分支内常量判断 | 永假分支，纯死代码 | 重写键盘处理 |
| U3 | 设计 | 背题模式仍显示答题卡，但 `_refresh_nav` 只对 practice 模式刷新 | `_show_question` 只在 `mode == 'practice'` 时调 `_refresh_nav` | 背题模式答题卡三态不更新，视觉误导 | Web 版背题模式隐藏答题卡态 |

## 数据质量（源题库，非程序缺陷）

用修复后的解析器跑现有 4 个题库，发现源文件本身有重复行，程序原先把它们全部入库：

| 题库 | 行数 | 去重后 | 完全重复行 |
| --- | --- | --- | --- |
| NLP题库 | 144 | 144 | 0 |
| 人工智能题库 | 468 | 463 | 5 |
| 期末复习题库/机器学习 | 184 | 180 | 4 |
| 机器视觉题库 | 510 | 452 | 58 |

合计 **1239 题**（单选 647 / 多选 43 / 判断 319 / 填空简答 230），已随站点发布在 `data/banks.json`。