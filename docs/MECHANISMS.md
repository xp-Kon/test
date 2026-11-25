# 智题刷题系统 · 机制提取清单

来源：`智题刷题系统2.0.exe`（PyInstaller onefile，Python 3.14，PySide6/Qt）。
提取方式：解析 CArchive → 解出 273 个条目 + 592 个 PYZ 模块 → 用同版本 Python 3.14 反序列化 code object → `dis` 反汇编 → 重建源码。
本文是重建源码（`recovered/`，未入库）的机制总结，Web 版逐项复写。

## 1. 程序结构

```
main.py                          入口：storage.init_db() → QApplication → apply_theme → MainWindow
quiz_app/core/models.py          Question / Bank / ParsedQuestion / ParseResult + 题型常量
quiz_app/core/parser.py          解析引擎：.docx .xlsx .xls .csv .txt
quiz_app/core/storage.py         SQLite 存储层（6 张表）
quiz_app/ui/theme.py             设计令牌 C{} + 全局 QSS
quiz_app/ui/icons.py            QPainter 手绘图标
quiz_app/ui/widgets.py          通用控件：StatCard / PageHeader / ModeCard / EmptyState / QuestionView / Toast / PaletteDialog
quiz_app/ui/main_window.py      侧边栏导航 + 页面栈
quiz_app/ui/home_page.py        首页总览 + 题库卡片 + 最近考试
quiz_app/ui/bank_page.py        题库导入（选文件→解析→预览→入库）+ 删除/改名
quiz_app/ui/practice_page.py    练习启动器 + 练习会话 + 答题卡
quiz_app/ui/exam_page.py        考试启动器 + 倒计时会话 + 自动评分 + 结果弹窗
quiz_app/ui/list_pages.py       错题本 / 收藏夹
quiz_app/ui/stats_page.py       统计与图表
```

## 2. 数据模型

- 四种题型：`single` 单选、`multiple` 多选、`judge` 判断、`fill` 填空/简答（简答并入 fill）。
- `Question`：`qtype, stem, options[], answer, analysis, id, bank_id, order_idx`。
- `Bank`：`id, name, source, created_at` + 运行期统计 `count/single/multiple/judge/fill/practiced/accuracy/wrong/favorites`。
- `ParsedQuestion.valid()`：题干与答案都非空才算有效（选项不参与校验）。
- 判断题的选项在库内固定为 `['对','错']`，答案存 `对`/`错`，判分时映射为 `A`/`B`。

## 3. 解析引擎（parser）

| 环节 | 规则 |
| --- | --- |
| 支持格式 | `.docx` `.xlsx` `.xls` `.csv` `.txt`（扩展名判定，无魔数嗅探） |
| 表头别名 | 题干：题干/题目/题面/试题内容/问题/试题/question；答案：正确答案/参考答案/标准答案/答案/answer/key；解析：答案解析/试题解析/解析/解释/说明/analysis/explanation；题型：题型/类型/试题类型/题目类型/type；选项列：`选项A` `A` `(A)` `答案A` … A–H |
| 表头探测 | 扫描前 3 行，命中「题干列 + 答案列或选项列」即认定为表头 |
| 无表头回退 | 按列投票找答案列（字母/对错形态）与题干列（最长文本列），中间列视为选项 |
| 题型识别 | 包含「多」→ 多选；「单」/「选择」→ 单选；「判断」→ 判断；「填空/简答/问答」→ fill |
| 答案规范化 | `对/正确/√/T/Y/YES/是` → `对`；`错/错误/×/F/N/NO/否` → `错`；判断题 `A/B` → `对/错`；字母串去重排序 → `ABD`；其余按原文（fill） |
| 文本题路径 | 按行状态机：题号行开新题、选项行入选项、`答案:`/`解析:` 行填字段，行内 `题干 A.xx B.yy 答案:B 解析:…` 亦支持 |
| docx | 段落文本走行解析；表格 > 8 行或正文 < 300 字时改走表格解析 |
| csv/txt 编码 | utf-8-sig → utf-8 → gbk → gb18030（csv 额外尝试 big5），分隔符嗅探 `,;\t|` |
| 去重 | 按题干前 120 字（原实现只在「重复且无答案」时跳过） |
| 告警 | 选项列缺失、未找到答案列、CSV 解析失败、无法识别编码、不支持的格式、解析出错、未能识别出题目、多工作表分段题数 |

## 4. 存储层（SQLite）

表：`banks` `questions` `answers` `wrong_book` `favorites` `exams`；索引 `idx_q_bank` `idx_a_q` `idx_a_time`。
数据文件：`%APPDATA%/QuizMaster/quiz.db`（Web 版改为项目内 `data/`）。

关键行为：
- 作答记录写入 `answers(question_id, selected, correct, mode, created_at)`；`mode` 取 `practice`/`exam`。
- 答错 → `wrong_book` upsert（`wrong_count+1`，`resolved=0`）；答对 → `resolved=1`（自动「消灭」错题）。
- 收藏 `favorites` 以 `question_id` 为主键，切换式增删。
- 删除题库：手工级联删 `answers/wrong_book/favorites/questions/exams/banks`（schema 未声明外键）。
- 考试：`exams(bank_id,title,total,correct_count,score,duration_sec,detail JSON,created_at)`。

## 5. 练习

- 启动器：选题库 → 练习方式（顺序 / 随机 / 背题）→ 范围（全部 / 只练错题 / 只练收藏）→ 题型勾选（4 类默认全选）→ 开始。
- 判分：单选/判断点选即判；多选选中后「确认作答」；填空/简答提交后由用户自评「我答对了 / 我答错了」。
- 会话：答题卡（未答/答对/答错三态 + 当前题高亮）、进度条、上一题/下一题、末题按钮变「完成练习」。
- 背题模式：直接高亮正确答案 + 展开解析，不写任何作答记录。
- 记录：每题只记一次（`graded_map` 去重），完成后弹总结（答对/答错/未作答/正确率）。
- 快捷键：`A–H` 或 `1–8` 选项、`Enter` 确认/下一题、`←→` 切题。

## 6. 考试

- 启动器：选题库 → 抽题数量（默认 20，上限 999）→ 时长（默认 30 分钟，上限 300）→ 题型（默认不含填空/简答）。
- 组卷：整库随机打乱后按数量截断。
- 会话：倒计时（≤300 秒变红）、答题卡、标记本题、交卷确认；时间到自动交卷。
- 评分：`score = 答对数 / 总题数 × 100`（一位小数）；逐题写 `answers(mode='exam')`；`exams.detail` 存每题作答。
- 结果弹窗：环形得分 + 题数/答对/答错/用时/正确率，可「错题复盘」跳到背题模式。

## 7. 错题本 / 收藏夹

- 错题本：列出 `resolved=0` 的题，按最近答错时间倒序，支持「移出错题本」、进入背题或重练。
- 收藏夹：按收藏时间倒序，支持取消收藏、背题。
- 两个页面都提供「背题过一遍」与「开始重练」入口（调用练习页的 `open_back_mode`）。

## 8. 统计

- 总览：题库数、题目总数、累计作答次数、总正确率（答对次数/作答次数）、待消灭错题、收藏数、考试数。
- 近 14 天每日作答数/答对数（补齐空白日期）。
- 按题库：作答次数 + 正确率，取前 8。
- 题型分布：四种题型题目数。
- 首页卡片：题库数量 / 题目总数 / 累计作答 / 总正确率 / 待消灭错题；最近考试表（考试、题数、得分、用时、时间）。

## 9. 主题与图标

设计令牌（与 QSS 共用）：背景 `#F3F4FA`、卡片 `#FFFFFF`、主文字 `#1F2430`、次文字 `#697086`、第三级 `#9AA0B5`、分割线 `#E6E8F2`、主色 `#6366F1`／深 `#4F46E5`／浅底 `#EEF2FF`、紫 `#8B5CF6`、绿 `#10B981`（底 `#E7F8F1`）、红 `#EF4444`（底 `#FDEDED`）、琥珀 `#F59E0B`（底 `#FFF6E5`）、蓝 `#3B82F6`（底 `#EAF2FE`）、侧边栏渐变 `#17153A → #2B2367`；圆角卡片 14px、按钮 10px；字体 `"Microsoft YaHei UI", "PingFang SC", sans-serif`。
图标为 QPainter 手绘线条图标（play/pencil/refresh/eye/bank/list/wrong/target/import 等），Web 版用 emoji + inline SVG 等价替代。

## 10. Web 版新增（原版没有）

- 答对后自动进入下一题（答错停留看解析）。
- **看题·带答案模式**：整库连续浏览 + 答案/解析常显 + 关键词搜索 + 参考答案逐空展示。
- **多空填空题分点作答**：按空位渲染独立输入框，提交后逐空对照参考答案并给出「一致/不一致」提示。
- **练习进度记忆**：题序、当前题号、每题作答、未提交的半截输入全部持久化，可「继续练习」或「重新开始」。
- 连续打卡天数（`streak`）与「正确率（次数）/正确率（题目）」双口径展示。
- 浏览器内导入 CSV/TXT 题库（原版只支持桌面文件选择）。
- 全站响应式布局，移动端可用。