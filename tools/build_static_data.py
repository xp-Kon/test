"""把 xlsx 题库预生成静态 JSON，供纯静态站点使用。

用法：python tools/build_static_data.py
输出：site/data/banks.json
"""
import json
import os
import sys
import glob
import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from web.core import parser as qparser  # noqa: E402

OUT = os.path.join(ROOT, 'data', 'banks.json')
SRC_DIR = ROOT


def build(src_dir=None):
    src = src_dir or SRC_DIR
    files = sorted(glob.glob(os.path.join(src, '*.xlsx')))
    if not files:
        print('未找到 xlsx 文件：', src)
        return None
    banks = []
    qid = 1
    stats = []
    for i, f in enumerate(files, start=1):
        res = qparser.parse_file(f)
        name = os.path.basename(f).split('_')[0]
        qs = []
        for q in res.questions:
            if not (q.stem or '').strip() or not (q.answer or '').strip():
                continue
            qs.append({
                'id': qid,
                'qtype': q.qtype,
                'stem': q.stem.strip(),
                'options': [o.strip() for o in q.options],
                'answer': q.answer.strip(),
                'analysis': (q.analysis or '').strip(),
            })
            qid += 1
        banks.append({
            'id': i,
            'name': name,
            'source': os.path.basename(f),
            'created_at': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'questions': qs,
        })
        from collections import Counter
        c = Counter(x['qtype'] for x in qs)
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
    for name, n, c, warn in stats:
        print(' ', name, n, c, ('warn=' + ';'.join(warn)) if warn else '')
    return payload


if __name__ == '__main__':
    src = None
    if '--src' in sys.argv:
        src = sys.argv[sys.argv.index('--src') + 1]
    build(src)