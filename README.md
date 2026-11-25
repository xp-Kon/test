# 智题 · 刷题练习系统（Web 版）

把一个 PyInstaller 打包的桌面刷题程序（`智题刷题系统2.0.exe`，Python 3.14 + PySide6）反编译、提取机制，并按修好的逻辑复写成**纯静态网站**。题库随站点发布，开箱即用。

- 在线访问：https://xp-kon.github.io/test/
- 仓库：https://github.com/xp-Kon/test

## 功能

| 页面 | 说明 |
| --- | --- |
| 首页 | 题库数量/题目总数/累计作答/总正确率/待消灭错题 + 题库卡片 + 最近考试 |
| 题库管理 | 题目构成表（单选/多选/判断/填空）、已练、正确率、错题、收藏；导入 CSV/TXT、改名、删除 |
| 刷题练习 | 顺序 / 随机 / 背题三种方式；全部 / 只练错题 / 只练收藏三种范围；四种题型筛选；答题卡 + 进度条；**进度自动记忆，重进可续做** |
| 看题·带答案 | 单题视图，左右滑动/方向键换题；答案与解析直接展开；按题型/错题/收藏筛选，支持关键词搜索与一键隐藏答案；**位置与筛选条件都会记住** |
| 模拟考试 | 随机抽题、倒计时、标记本题、自动交卷与评分、错题复盘 |
| 错题本 / 收藏夹 | 自动收录与自动「消灭」，可背题或重练 |
| 学习统计 | 近 14 天作答柱状图、按题库正确率、题型分布、连续打卡 |

判分口径：
- 单选 / 判断：点选即判，答对自动进入下一题，答错停留看解析。
- 多选：可多选，确认后按「选择集合与答案集合相等」判定（与原程序一致，无部分给分）。
- 填空 / 简答：主观题，提交后自评「我答对了 / 我答错了」；**多空填空题按空位分点填写，提交后逐空与参考答案对照**（题干中的 `____`、`（1）`、`第1空` 都能识别）。考试中默认不抽这类题，勾选则计入「待自评」且不进机评分母。
- 进度记忆：练习位置、每题作答与未提交的半截输入都存进 `localStorage`，关掉页面再回来点「继续练习」即可从原处接着做。

## 目录

```
index.html            入口
styles.css            主题（色值取自桌面版 QSS 设计令牌）
js/logic.js           纯逻辑：判分、错题本、统计、组卷、CSV/TXT 导入（无 DOM 依赖，可 Node 单测）
js/app.js             界面渲染与交互
data/banks.json       预生成的题库（4 个题库，1239 题）
tests/logic.test.js   逻辑层断言（66 条）
tests/api.test.js     契约断言（21 条）
tools/build_static_data.py   把 xlsx 题库重新生成 data/banks.json
web/core/             从反汇编重建的 Python 解析/存储层（供 tools 使用）
docs/MECHANISMS.md    机制提取清单
docs/BUGS.md          缺陷清单与修复对照
```

## 部署

仓库有两个分支：`main` 是源码主分支，`gh-pages` 是 GitHub Pages 的发布分支（内容与 main 一致）。

```bash
bash scripts/deploy.sh "提交说明"    # 同时推 main 与 gh-pages
```

Pages 走 SSH 443 端口推送（`ssh://git@ssh.github.com:443/xp-Kon/test.git`），因为本机到 github.com:443 直连不通。

## 本地运行

静态站点需要用 HTTP 打开（`file://` 会被同源策略拦住 `fetch`）：

```bash
cd site
python -m http.server 8799
# 打开 http://127.0.0.1:8799
```

## 测试

```bash
node site/tests/logic.test.js   # PASS 66 FAIL 0
node site/tests/api.test.js     # PASS 21 FAIL 0
```

## 重新生成题库

```bash
python -m pip install openpyxl python-docx xlrd
python tools/build_static_data.py
```

脚本会解析仓库根的 xlsx 题库，去重后写入 `data/banks.json`，并打印每个题库的题数与告警。

## 数据存储

进度只存在浏览器 `localStorage`（键 `quizmaster.web.v1`）：作答记录、错题本、收藏、考试记录、导入的题库。清除浏览器数据即重置；不上传任何服务器。

## 已知限制

- 静态站无法解析 xlsx/docx（需要解压 + XML 解析），Office 题库请用 `tools/build_static_data.py` 预转，或先另存为 CSV。
- 无多端同步，换浏览器/设备进度不互通。