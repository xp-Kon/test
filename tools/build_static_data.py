"""把 xlsx 题库预生成静态 JSON，供纯静态站点使用。

用法：python tools/build_static_data.py
输出：site/data/banks.json
"""
import collections
import datetime
import glob
import importlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

qparser = importlib.import_module('web.core.parser')  # 需要在 sys.path 调整之后再导入

OUT = os.path.join(ROOT, 'data', 'banks.json')
SRC_DIR = ROOT



ISSUE_TIME = re.compile(r'^\d{1,2}:\d{2}(:\d{2})?$')
ISSUE_FRAC = re.compile(r'^0\.\d{6,}$')


def option_issues(q):
    """检查选项质量问题（源表格常见的转码损伤）。"""
    out = []
    opts = [str(o).strip() for o in (q.options or [])]
    if q.qtype in ('single', 'multiple'):
        if len([o for o in opts if o]) < 2:
            out.append('选项不足')
        if any(o == '' for o in opts):
            out.append('选项为空')
        uniq = {o for o in opts if o}
        if len(uniq) == 1 and len(opts) >= 2:
            out.append('选项内容完全相同')
        if any(not re.search(r'[0-9A-Za-z一-鿿]', o) for o in opts if o):
            out.append('选项缺少数值/文字')
        if any(ISSUE_TIME.match(o) for o in opts):
            out.append('选项被表格转成时间')
        if any(ISSUE_FRAC.match(o) for o in opts):
            out.append('选项被表格转成小数')
    return sorted(set(out))


def build(src_dir=None):
    src = src_dir or SRC_DIR
    files = sorted(glob.glob(os.path.join(src, '*.xlsx')))
    if not files:
        print('未找到 xlsx 文件：', src)
        return None
    banks = []
    qid = 1
    stats = []
    issue_counter = collections.Counter()
    for i, f in enumerate(files, start=1):
        res = qparser.parse_file(f)
        name = os.path.basename(f).split('_')[0]
        qs = []
        for q in res.questions:
            if not (q.stem or '').strip() or not (q.answer or '').strip():
                continue
            item = {
                'id': qid,
                'qtype': q.qtype,
                'stem': q.stem.strip(),
                'options': [o.strip() for o in q.options],
                'answer': q.answer.strip(),
                'analysis': (q.analysis or '').strip(),
            }
            issues = option_issues(q)
            if issues:
                item['issues'] = issues
                issue_counter.update(issues)
            qs.append(item)
            qid += 1
        banks.append({
            'id': i,
            'name': name,
            'source': os.path.basename(f),
            'created_at': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'questions': qs,
        })
        c = collections.Counter(x['qtype'] for x in qs)
        stats.append((name, len(qs), dict(c), res.warnings))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    payload = {
        'version': 1,
        'generated_at': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'banks': banks,
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))

    total = sum(len(b['questions']) for b in banks)
    print('banks', len(banks), 'questions', total, 'bytes', os.path.getsize(OUT))
    flagged = sum(1 for b in banks for q in b['questions'] if q.get('issues'))
    print('选项待校对', flagged, '条；分布', dict(issue_counter))
    for name, n, c, warn in stats:
        print(' ', name, n, c, ('warn=' + ';'.join(warn)) if warn else '')
    return payload


if __name__ == '__main__':
    src = None
    if '--src' in sys.argv:
        src = sys.argv[sys.argv.index('--src') + 1]
    build(src)
