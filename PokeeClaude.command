#!/bin/bash
# Double-click to open PokeeClaude (macOS: Finder, Linux: file manager).
# First run installs dependencies, then the setup window opens.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "PokeeClaude needs Node.js 20 or newer: https://nodejs.org"
  (command -v open >/dev/null && open "https://nodejs.org") || (command -v xdg-open >/dev/null && xdg-open "https://nodejs.org")
  read -r -p "Press Enter to close…"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First run: installing PokeeClaude (this takes a minute)…"
  npm install --no-audit --no-fund || { read -r -p "Install failed. Press Enter to close…"; exit 1; }
fi
if [ ! -f dist/cli.js ] || [ -n "$(find src -newer dist/cli.js -name '*.ts' -print -quit)" ]; then
  npm run build --silent || { read -r -p "Build failed. Press Enter to close…"; exit 1; }
fi

node dist/cli.js setup
