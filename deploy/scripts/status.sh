#!/usr/bin/env bash
source "$(dirname -- "$0")/lib.sh"
require_env
compose ps
compose exec -T api node -e 'fetch("http://127.0.0.1:3010/api/public/health").then(async r => { console.log(await r.text()); process.exit(r.ok ? 0 : 1); }).catch(e => { console.error(e); process.exit(1); })'
