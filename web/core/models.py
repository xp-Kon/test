"""数据模型定义（移植自 quiz_app.core.models）。"""
from dataclasses import dataclass, field
from typing import Optional

SINGLE = 'single'
MULTIPLE = 'multiple'
JUDGE = 'judge'
FILL = 'fill'

TYPE_NAMES = {
    SINGLE: '单选题',
    MULTIPLE: '多选题',
    JUDGE: '判断题',
    FILL: '填空/简答',
}

# 徽标配色：与桌面版 TYPE_BADGE_STYLE 完全一致
TYPE_BADGE_STYLE = {
    SINGLE: ('#EEF2FF', '#4F46E5'),
    MULTIPLE: ('#FDF4FF', '#A21CAF'),
    JUDGE: ('#ECFDF5', '#047857'),
    FILL: ('#FFFBEB', '#B45309'),
}


@dataclass
class Question:
    """一道题目"""
    qtype: str
    stem: str
    options: list = field(default_factory=list)
    answer: str = ''
    analysis: str = ''
    id: Optional[int] = None
    bank_id: Optional[int] = None
    order_idx: int = 0

    def option_letters(self) -> str:
        return ''.join(chr(ord('A') + i) for i in range(len(self.options)))

    def is_choice(self) -> bool:
        return self.qtype in (SINGLE, MULTIPLE)

    def answer_display(self) -> str:
        return self.answer

    def to_dict(self) -> dict:
        return {
            'id': self.id, 'bank_id': self.bank_id, 'qtype': self.qtype,
            'stem': self.stem, 'options': list(self.options), 'answer': self.answer,
            'analysis': self.analysis, 'order_idx': self.order_idx,
        }


@dataclass
class Bank:
    """题库"""
    id: Optional[int] = None
    name: str = ''
    source: str = ''
    created_at: str = ''
    count: int = 0
    single: int = 0
    multiple: int = 0
    judge: int = 0
    fill: int = 0
    practiced: int = 0
    accuracy: float = 0.0
    wrong: int = 0
    favorites: int = 0

    def to_dict(self) -> dict:
        return {
            'id': self.id, 'name': self.name, 'source': self.source, 'created_at': self.created_at,
            'count': self.count, 'single': self.single, 'multiple': self.multiple,
            'judge': self.judge, 'fill': self.fill, 'practiced': self.practiced,
            'accuracy': self.accuracy, 'wrong': self.wrong, 'favorites': self.favorites,
        }


@dataclass
class ParsedQuestion:
    """解析结果中的一题（未入库）"""
    qtype: str
    stem: str
    options: list
    answer: str
    analysis: str = ''

    def valid(self) -> bool:
        return bool(self.stem.strip()) and bool(self.answer.strip())

    def to_dict(self) -> dict:
        return {'qtype': self.qtype, 'stem': self.stem, 'options': list(self.options),
                'answer': self.answer, 'analysis': self.analysis}


@dataclass
class ParseResult:
    """一个文件的解析结果"""
    name: str = ''
    source: str = ''
    questions: list = field(default_factory=list)
    warnings: list = field(default_factory=list)

    def ok_count(self) -> int:
        return sum(1 for q in self.questions if q.valid())

    def bad_count(self) -> int:
        return sum(1 for q in self.questions if not q.valid())