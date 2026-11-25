# 由 Python 3.14 反汇编重建（原文件第 1 行内容不可知，疑为空行/文件头注释）；行号已尽量与 co_lines 对齐
"""智能题目解析引擎：支持 .docx / .xlsx / .xls / .csv / .txt

移植说明（Web 版修复项）：
  FIX-P1 无表头表格里选项字母不连续时 _build_question 返回 None，原实现直接 append，
         随后 parse_file 访问 q.stem 抛 AttributeError（导入直接失败）→ 统一过滤 + 告警。
  FIX-P2 答案带 '.' / '、' / ':' 结尾时 A/B 映射与字母规范化失效（原 strip 只去 。，,；;）。
  FIX-P3 去重仅跳过「重复且无答案」的题，带答案的重复题被重复导入 → 改为按 (题干,答案) 去重并报数。
  FIX-P4 xlsx 数值单元格 str(1.0)='1.0' → 整数值还原成 int，避免污染题干/答案。
"""
import csv
import io
import re
from pathlib import Path

from .models import ParsedQuestion, ParseResult, SINGLE, MULTIPLE, JUDGE, FILL





RE_QSTART = re.compile(
    r'^\s*(?:第\s*(\d{1,4})\s*题|[\[【(（]\s*(\d{1,4})\s*[\])）]\s*|(\d{1,4})\s*[\.、,．:：\)）]\s*)'
)
RE_OPT = re.compile(
    r'^\s*[\(（]?([A-Ha-h])[\)）]\s*[\.、,．:：]?\s*(.*)$|^\s*([A-Ha-h])\s*[\.、．:：]\s*(.*)$'
)

RE_OPT_INLINE = re.compile(r'[\(（]?([A-Ha-h])[\)）]\s*[\.、,．:：]?|([A-Ha-h])\s*[\.、．:：]')

RE_ANSWER = re.compile(r'^\s*(?:正确答案|参考答案|标准答案|答案)\s*[:：=]?\s*(.*)$')

RE_ANSWER_INLINE = re.compile(r'(?:正确答案|参考答案|标准答案|答案)\s*[:：]\s*(.*)$')
RE_ANALYSIS_INLINE = re.compile(r'[\[【]?\s*(?:答案解析|试题解析|解析|解释|说明)\s*[\]】]?\s*[:：]\s*(.*)$')

RE_ANALYSIS = re.compile(r'^\s*[\[【]?\s*(?:答案解析|试题解析|解析|解释|说明)\s*[\]】]?\s*[:：]?\s*(.*)$')

RE_CLEAN_NUM = re.compile(r'^\s*(?:第\s*\d{1,4}\s*题\s*|[\[【(（]\s*\d{1,4}\s*[\])）]\s*|\d{1,4}\s*[\.、,．:：\)）]\s*)')

JUDGE_TRUE = {'t', '对', 'true', 'y', 'right', '是', '正确', 'yes', '√', '✓'}
JUDGE_FALSE = {'✘', '×', '✗', '错误', 'false', '错', 'x', 'f', 'no', 'n', '否', 'wrong'}

STEM_KEYS = ('题干', '题目', '题面', '试题内容', '问题', '试题', '题干内容', '题 目', 'question')
ANSWER_KEYS = ('正确答案', '参考答案', '标准答案', '答案', 'answer', 'key')
ANALYSIS_KEYS = ('答案解析', '试题解析', '解析', '解释', '说明', 'explanation', 'analysis')
TYPE_KEYS = ('题型', '类型', '试题类型', '题目类型', 'type')
OPT_COL_RE = re.compile(r'^\s*(?:选项|答案)?\s*[\(（]?([A-Ha-h])[\)）]?\s*[_\-]?\s*(?:内容|文本|标题)?\s*$')


def _extract_meta(text: str) -> tuple:
    """从一段文本中提取 (剩余文本, 答案, 解析)（非锚定，用于行内提取）"""
    analysis = answer = ''
    am = RE_ANSWER_INLINE.search(text)
    if am:
        answer = am.group(1).strip()
        text = text[:am.start()].strip()
        an = RE_ANALYSIS_INLINE.search(answer)
        if an:
            analysis = an.group(1).strip()
            answer = answer[:an.start()].strip()
    else:
        an = RE_ANALYSIS_INLINE.search(text)
        if an:
            analysis = an.group(1).strip()
            text = text[:an.start()].strip()
    return text, answer, analysis


def _norm_text(s) -> str:
    if s is None:
        return ''
    s = str(s)

    s = s.replace('\xa0', ' ').replace('\u3000', ' ')
    s = re.sub(r'[ \t]+', ' ', s)
    return s.strip()


def _norm_answer(raw: str, qtype: str | None = None) -> tuple:
    """规整答案 -> (answer, inferred_type)"""
    text = _norm_text(raw)
    core = text.strip('。，,；;.、:：）) ')
    if not core:
        return '', None
    low = core.lower()
    if low in JUDGE_TRUE:
        return '对', JUDGE
    if low in JUDGE_FALSE:
        return '错', JUDGE
    if qtype == JUDGE:
        # ??? uncertain: 原文 83 行空行/注释；A、B -> 对、错 仅对已判定为判断题的题目生效
        if low == 'a':
            return '对', JUDGE
        if low == 'b':
            return '错', JUDGE
    if qtype == FILL:
        # ??? uncertain: 原文 89-90 行空行/注释

        return text, FILL

    letters = re.findall(r'[A-Ha-h]', core)
    if letters and re.fullmatch(r'[\s,A-Ha-h、.;；/]+', core):
        letters = sorted({c.upper() for c in letters})
        ans = ''.join(letters)
        return ans, (MULTIPLE if len(ans) > 1 else SINGLE)

    return text, FILL


def _norm_type(t: str) -> str | None:
    t = _norm_text(t)
    if not t:
        return None
    if '多' in t:
        return MULTIPLE
    if '单' in t or '选择' in t:
        return SINGLE
    if '判断' in t:
        return JUDGE
    if '填空' in t or '简答' in t or '问答' in t:
        return FILL
    return None


def _split_inline_options(text: str):
    """把一行里内嵌的选项拆出来：'...题干 A.xx B.yy' -> (stem, [(A,xx),(B,yy)])"""
    matches = list(RE_OPT_INLINE.finditer(text))

    if len(matches) < 2:
        return text.strip(), []
    letters = [m.group(1) or m.group(2) for m in matches]
    seq_ok = all(ord(letters[i]) == ord('A') + i for i in range(len(letters))) and len(letters) <= 8
    if not seq_ok:
        return text.strip(), []
    stem = text[:matches[0].start()].strip()
    opts = []
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        content = text[m.end():end].strip()
        opts.append(((m.group(1) or m.group(2)).upper(), content))
    return stem, opts




def parse_lines(lines: list) -> list:
    """从纯文本行解析题目（docx 段落 / txt）"""
    questions = []
    cur = None
    bad = 0

    def flush():
        nonlocal cur, bad
        if cur is None:
            return
        stem = ' '.join(cur['stem']).strip()

        opt_map = {}
        for L, T in cur['opts']:
            if L and T and L not in opt_map:
                opt_map[L] = T
        letters = sorted(opt_map.keys())
        seq_ok = bool(letters) and all(ord(letters[i]) == ord('A') + i
                                       for i in range(len(letters)))
        opts = [(L, opt_map[L]) for L in letters]
        answer = cur['answer']
        analysis = ' '.join(cur['analysis']).strip()
        if stem:
            q = _build_question(stem, opts, answer, analysis)
            if q:
                questions.append(q)
            else:
                bad += 1  # ?? BUG? bad 只累加，从不使用（无 warning、不影响返回值）
        cur = None

    for raw_line in lines:
        line = _norm_text(raw_line)
        if not line:
            continue

        m = RE_QSTART.match(line)
        if m:

            rest = RE_CLEAN_NUM.sub('', line)
            stem_part, inline_opts = _split_inline_options(rest)
            stem_part, inline_answer, inline_analysis = _extract_meta(stem_part)
            if inline_opts:
                last = inline_opts[-1]
                txt, ans2, ana2 = _extract_meta(last[1])
                if ans2:
                    inline_answer = ans2
                if ana2:
                    inline_analysis = ana2
                inline_opts[-1] = (last[0], txt)
            if cur is not None:
                flush()
            cur = {
                'stem': [stem_part] if stem_part else [], 'opts': list(inline_opts), 'answer': inline_answer,
                'analysis': [inline_analysis] if inline_analysis else [],
                'seen_analysis': bool(inline_analysis)}
            continue

        om = RE_OPT.match(line)
        if om and cur is not None and not cur['seen_analysis']:
            letter = om.group(1) or om.group(3)
            content = om.group(2) or om.group(4)

            full = f'{letter}. {content}'
            stem_part, inline_opts = _split_inline_options(full)
            if inline_opts:
                if stem_part:
                    stem_part = re.sub(r'^\s*[A-Ha-h]\s*[\.、．:：]\s*', '', stem_part)
                    cur['opts'].append((letter.upper(), stem_part))  # ?? BUG? 与 inline_opts 可能重复/错位
                cur['opts'].extend(inline_opts)
            else:
                cur['opts'].append((letter.upper(), content.strip()))
            continue

        am = RE_ANSWER.match(line)
        if am and cur is not None:
            cur['answer'] = am.group(1)  # ?? BUG? 答案原样保存，无长度/越界/题型校验
            continue

        anm = RE_ANALYSIS.match(line)
        if anm and cur is not None:
            cur['seen_analysis'] = True
            if anm.group(1).strip():
                cur['analysis'].append(anm.group(1).strip())
            continue
        if cur is None:

            stem_part, inline_opts = _split_inline_options(line)
            stem_part, inline_answer, analysis3 = _extract_meta(stem_part)
            if inline_opts:
                last = inline_opts[-1]
                txt, ans2, ana2 = _extract_meta(last[1])
                if ans2:
                    inline_answer = ans2
                if ana2:
                    analysis3 = ana2
                inline_opts[-1] = (last[0], txt)
            if inline_opts and stem_part:
                q = _build_question(stem_part, inline_opts, inline_answer, analysis3)
                if q:
                    questions.append(q)
            continue

        if cur['seen_analysis']:
            cur['analysis'].append(line)
        elif cur['answer']:
            cur['analysis'].append(line)  # ?? BUG? 见过答案后所有行都归解析，题干不再追加
        else:
            cur['stem'].append(line)
    flush()
    return questions


def _build_question(stem, opts, answer, analysis):
    """opts: [(letter, text)]，构建题目；选项字母无法对齐时返回 None"""
    a2, t2 = _norm_answer(answer)
    letters = [L for L, _ in opts]
    seq_ok = bool(letters) and all(ord(letters[i]) == ord('A') + i
                                   for i in range(len(letters)))
    if t2 == JUDGE:
        return ParsedQuestion(JUDGE, stem, ['对', '错'], a2, analysis)
    texts = [T for _, T in opts]
    if seq_ok and t2 in (SINGLE, MULTIPLE, FILL):
        return ParsedQuestion(t2, stem, texts, a2, analysis)
    if seq_ok and t2 is None:
        t = MULTIPLE if len(a2) > 1 else SINGLE
        return ParsedQuestion(t, stem, texts, a2, analysis)
    if letters and not seq_ok:
        return None  # ?? BUG? 选项字母不连续 -> 整题丢弃（调用方仅 bad+=1）
    return ParsedQuestion(t2 or FILL, stem, [], a2, analysis)




def _is_option_cell(s) -> bool:
    return bool(_norm_text(s)) and bool(OPT_COL_RE.match(_norm_text(s)))


def parse_table(rows: list, warnings: list) -> list:
    """rows: List[List[str]]，自动探测表头并解析"""
    rows = [[_norm_text(c) for c in r] for r in rows]
    rows = [r for r in rows if any(r)]
    if not rows:
        return []
    ncol = max(len(r) for r in rows)
    rows = [r + [''] * (ncol - len(r)) for r in rows]


    header_row = -1
    mapping = {}
    for i in range(min(3, len(rows))):
        row = rows[i]
        mp = {}  # ?? BUG? 未使用的局部变量
        stem_col = -1
        answer_col = -1
        analysis_col = -1
        type_col = -1
        opt_cols = {}
        for j, cell in enumerate(row):
            cl = cell.lower().strip()
            if not cl:
                continue
            if cl in [k.lower() for k in STEM_KEYS]:
                stem_col = j
            elif cl in [k.lower() for k in ANSWER_KEYS]:
                answer_col = j
            elif cl in [k.lower() for k in ANALYSIS_KEYS]:
                analysis_col = j
            elif cl in [k.lower() for k in TYPE_KEYS]:
                type_col = j
            else:
                mo = OPT_COL_RE.match(cl)
                if not mo: continue  # ??? uncertain: 原文 309 行为单行 if/continue（跳转与 if 同行）
                opt_cols[mo.group(1).upper()] = j
        if stem_col >= 0 and (answer_col >= 0 or opt_cols):
            mapping = dict(stem=stem_col, answer=answer_col,
                           analysis=analysis_col, type=type_col,
                           opts=opt_cols)
            header_row = i
            break
    if header_row >= 0:
        return _parse_table_with_header(rows[header_row + 1:], mapping, warnings)


    return _parse_table_no_header(rows, warnings)


def _looks_like_answer(s: str) -> bool:
    s = s.strip().lower().strip('。，,;；')
    if not s:
        return False
    if s in JUDGE_TRUE or s in JUDGE_FALSE:
        return True
    return bool(re.fullmatch(r'[\s,A-Ha-h、.]{1,16}', s)) and bool(re.search(r'[A-Ha-h]', s))


def _parse_table_with_header(rows, mapping, warnings) -> list:
    out = []
    sc, ac, anc, tc = mapping['stem'], mapping['answer'], mapping['analysis'], mapping['type']
    opts_map = mapping['opts']
    n_opts = max(opts_map.values()) + 1 if opts_map else 0  # ?? BUG? n_opts 赋值后从未使用
    for r in rows:
        stem = r[sc] if sc < len(r) else ''
        if not stem:
            continue
        answer = r[ac] if 0 <= ac < len(r) else ''
        analysis = r[anc] if 0 <= anc < len(r) else ''
        qtype = _norm_type(r[tc]) if 0 <= tc < len(r) else None


        texts = []
        if opts_map:
            for letter in sorted(opts_map.keys()):
                col = opts_map[letter]
                if col < len(r) and r[col]:
                    texts.append(r[col])
        else:
            # ??? uncertain: 原文 354 行空行/注释
            stem, inline = _split_inline_options(stem)
            texts = [t for _, t in inline]
            if not texts and (
                # ??? uncertain: 原文 358 行空行/注释
                ac > sc):
                for col in range(sc + 1, ac):
                    if col < len(r) and r[col]:
                        texts.append(r[col])
        stem, inline2 = _split_inline_options(stem)
        if not texts and inline2:
            texts = [t for _, t in inline2]

        a2, t2 = _norm_answer(answer, qtype)
        final_type = qtype or t2
        if final_type == JUDGE:  # ?? BUG? 答案不是 对/错 时被静默清空
            out.append(ParsedQuestion(JUDGE, stem, ['对', '错'],
                                      a2 if a2 in ('对', '错') else '', analysis))
        elif final_type in (SINGLE, MULTIPLE):
            if not texts and 0 < len(a2) <= 8:  # ?? BUG? 魔法数 8：答案超过 8 个字母就不告警
                warnings.append('选项列缺失，仅保留题干与答案')
            out.append(ParsedQuestion(final_type, stem, texts, a2, analysis))
        elif final_type == FILL:
            out.append(ParsedQuestion(FILL, stem, [], a2, analysis))
        # ??? uncertain: 原文 378-379 行空行/注释

        elif texts and a2:
            t = MULTIPLE if len(a2) > 1 else SINGLE
            out.append(ParsedQuestion(t, stem, texts, a2, analysis))
        elif a2:
            t = JUDGE if a2 in ('对', '错') else FILL
            opts = ['对', '错'] if t == JUDGE else []
            out.append(ParsedQuestion(t, stem, opts, a2, analysis))
        else:
            out.append(ParsedQuestion(FILL, stem, [], '', analysis))
    return out


def _parse_table_no_header(rows, warnings) -> list:
    """无表头启发式：找答案列 / 题干列，选项列为中间列"""
    ncol = len(rows[0])
    answer_scores = [0] * ncol
    for r in rows:
        for j in range(ncol):
            if _looks_like_answer(r[j]):
                answer_scores[j] += 1
    answer_col = max(range(ncol), key=lambda j: answer_scores[j]) if max(answer_scores, default=0) >= max(1, len(rows) * 0.5) else -1
    stem_scores = [0] * ncol
    for r in rows:
        lens = [len(c) for c in r]
        if lens:
            stem_scores[lens.index(max(lens))] += 1
    stem_col = max(range(ncol), key=lambda j: stem_scores[j])
    if stem_col == answer_col:
        answer_col = -1


    hi, lo = min(stem_col, answer_col if answer_col >= 0 else ncol), (answer_col if answer_col >= 0 else ncol)  # ?? BUG? hi/lo 取反：hi 实际是 min，导致 opt_cols 为空、选项丢失
    opt_cols = [j for j in range(stem_col + 1, hi) if j != answer_col]

    if answer_col >= 0 and answer_col < stem_col:
        opt_cols = [j for j in range(answer_col + 1, ncol) if j != stem_col]
    analysis_col = -1
    if answer_col >= 0 and answer_col + 1 < ncol and opt_cols and max(opt_cols) < answer_col:
        analysis_col = answer_col + 1

    out = []
    for r in rows:
        stem = r[stem_col]
        if not stem:
            continue
        answer = r[answer_col] if answer_col >= 0 else ''
        analysis = r[analysis_col] if 0 <= analysis_col < len(r) else ''
        texts = [r[j] for j in opt_cols if j < len(r) and r[j]]
        if not texts:
            stem, inline = _split_inline_options(stem)
            texts = [t for _, t in inline]
        q = _build_question(stem, [(chr(ord('A') + i), t) for i, t in enumerate(texts)], answer, analysis)
        if q is None:  # FIX-P1: 选项字母不连续，丢弃并告警，避免 None 流入 q.stem
            warnings.append('选项字母不连续，已跳过：' + stem[:24])
            continue
        out.append(q)  # ?? BUG? 未过滤 None
    if answer_col < 0:
        warnings.append('未找到答案列，题目答案为空')
    return out




def _read_csv_bytes(data: bytes) -> list:
    for enc in ('utf-8-sig', 'utf-8', 'gbk', 'gb18030', 'big5'):  # ?? BUG? 无魔数/chardet 探测；utf-8-sig 与 utf-8 重复
        try:
            text = data.decode(enc)
            sample = text[:4096]
            dialect = csv.Sniffer().sniff(sample, delimiters=',;\t|') if len(sample) > 10 else csv.excel
            rows = list(csv.reader(io.StringIO(text), dialect))
            return rows
        except (UnicodeDecodeError, csv.Error):
            continue
    return []


def parse_docx(path: str, warnings: list) -> list:
    from docx import Document
    doc = Document(path)
    para_lines = [p.text for p in doc.paragraphs if p.text.strip()]
    table_rows = []
    for tbl in doc.tables:
        for row in tbl.rows:
            table_rows.append([c.text for c in row.cells])  # ?? BUG? 合并单元格会把同一文本重复成多列

    n_chars = sum(len(l) for l in para_lines)
    if table_rows and (n_chars < 300 or len(table_rows) > 8):  # ?? BUG? 表格/段落二选一，含表格的文档段落题会丢
        return parse_table(table_rows, warnings)
    return parse_lines(para_lines)


def _cell_text(v) -> str:
    """单元格转文本。

    FIX-P4 整数值的 float 还原成 int；FIX-P5 Excel 把 1:10 这类文本存成 time、
           把比例存成小数，这里按表格显示值还原，避免选项变成 01:10:00 / 0.1111。
    """
    import datetime as _dt
    if v is None:
        return ''
    if isinstance(v, _dt.datetime):
        return v.strftime('%Y-%m-%d %H:%M')
    if isinstance(v, _dt.time):
        return v.strftime('%H:%M') if v.second == 0 else v.strftime('%H:%M:%S')
    if isinstance(v, _dt.date):
        return v.strftime('%Y-%m-%d')
    if isinstance(v, float):
        if v.is_integer():
            return str(int(v))
        return ('%.10g' % v)
    return str(v)


def parse_xlsx(path: str, warnings: list) -> list:
    from openpyxl import load_workbook
    wb = load_workbook(path, read_only=True, data_only=True)
    out = []
    for ws in wb.worksheets:
        rows = []
        for row in ws.iter_rows(values_only=True):
            rows.append([_cell_text(v) for v in row])
        qs = parse_table(rows, warnings)
        if not qs:
            continue
        out.extend(qs)
        if len(wb.worksheets) > 1 and qs:
            warnings.append(f'工作表「{ws.title}」解析出 {len(qs)} 题')
    wb.close()
    return out


def parse_xls(path: str, warnings: list) -> list:
    import xlrd
    book = xlrd.open_workbook(path)
    out = []
    for ws in book.sheets():
        rows = []
        for i in range(ws.nrows):
            rows.append([str(v) if v is not None else '' for v in ws.row_values(i)])
        qs = parse_table(rows, warnings)
        if not qs: continue
        out.extend(qs)
    return out


def parse_text_file(path: str, warnings: list) -> list:
    data = Path(path).read_bytes()
    if path.lower().endswith('.csv'):
        rows = _read_csv_bytes(data)
        if rows:
            return parse_table(rows, warnings)
        warnings.append('CSV 解析失败')
        return []
    for enc in ('utf-8-sig', 'utf-8', 'gbk', 'gb18030'):  # ?? BUG? 无 BOM 时 GBK 文本可能被误判/整段丢行
        try:
            text = data.decode(enc)
            return parse_lines(text.splitlines())
        except UnicodeDecodeError:
            continue
    warnings.append('无法识别文件编码')
    return []


SUPPORTED_EXT = {'.docx', '.xlsx', '.xls', '.csv', '.txt'}


def parse_file(path: str) -> ParseResult:
    """解析一个文件 -> ParseResult"""
    path = str(path)
    ext = Path(path).suffix.lower()  # ?? BUG? 只按扩展名判定格式，无魔数/表头嗅探
    res = ParseResult(name=Path(path).stem, source=path)
    if ext not in SUPPORTED_EXT:
        res.warnings.append(f'不支持的格式：{ext}')
        return res
    try:
        if ext == '.docx':
            qs = parse_docx(path, res.warnings)
        elif ext == '.xlsx':
            qs = parse_xlsx(path, res.warnings)
        elif ext == '.xls':
            qs = parse_xls(path, res.warnings)
        else:
            qs = parse_text_file(path, res.warnings)
    except Exception as e:
        res.warnings.append(f'解析出错：{e}')
        return res

    seen = set()
    dup = 0
    for q in qs:
        if q is None:  # FIX-P1
            continue
        if not q.stem:
            continue
        key = (q.stem[:120], (q.answer or '').strip())  # FIX-P3: 重复题按题干+答案去重
        if key in seen:
            dup += 1
            continue
        seen.add(key)
        res.questions.append(q)
    if dup:
        res.warnings.append(f'跳过重复题目 {dup} 道')
    if not res.questions:
        res.warnings.append('未能识别出题目，请检查文件格式')
    return res