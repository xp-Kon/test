#!/usr/bin/env bash
# 部署：把当前提交同时推到 main 与 gh-pages（Pages 从 gh-pages 发布）
# 用法： bash scripts/deploy.sh "提交说明"
set -euo pipefail
MSG="${1:-update site}"
export GIT_SSH_COMMAND='ssh -o StrictHostKeyChecking=accept-new -p 443'
git add -A
git commit -m "$MSG" || echo "无改动可提交"
git push origin HEAD:main
git push origin HEAD:gh-pages
echo "已推送。站点： https://xp-kon.github.io/test/"
