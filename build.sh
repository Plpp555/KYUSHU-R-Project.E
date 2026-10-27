#!/usr/bin/env bash
# One-shot build: web bundle (Vite) -> Android APK.
set -euo pipefail
cd "$(dirname "$0")"
(cd game && npm install --no-audit --no-fund && npm run build)
tools/build-apk.sh game/dist dist/KYUSHU-R_Fukuoka.apk
