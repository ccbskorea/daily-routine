#!/usr/bin/env bash
# 데일리 루틴 배포: main 푸시 → GitHub Pages 활성화 → HTTP 200 확인
# 사용법: ./deploy.sh [owner/repo]   (기본: ccbskorea/daily-routine)
set -euo pipefail
REPO="${1:-ccbskorea/daily-routine}"
OWNER="${REPO%%/*}"
NAME="${REPO##*/}"
cd "$(dirname "$0")"

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "https://github.com/${REPO}.git"
else
  git remote add origin "https://github.com/${REPO}.git"
fi

echo "== 푸시 =="
git push -u origin main

echo "== GitHub Pages 활성화 =="
gh api -X POST "repos/${REPO}/pages" -f 'source[branch]=main' -f 'source[path]=/' >/dev/null 2>&1 \
  || gh api -X PUT "repos/${REPO}/pages" -f 'source[branch]=main' -f 'source[path]=/' >/dev/null 2>&1 \
  || echo "  (Pages 설정 응답 없음 — 이미 켜져 있을 수 있어요)"

URL="https://${OWNER}.github.io/${NAME}/"
echo "== 배포 확인: ${URL} =="
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$URL" || echo "000")
  echo "  [${i}] HTTP ${code}"
  if [ "$code" = "200" ]; then
    echo "배포 완료: ${URL}"
    exit 0
  fi
  sleep 10
done

echo "아직 200이 아닙니다. Pages 빌드 상태를 확인하세요:"
echo "  gh api repos/${REPO}/pages/builds/latest"
exit 1
