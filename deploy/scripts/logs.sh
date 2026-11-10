#!/usr/bin/env bash
source "$(dirname -- "$0")/lib.sh"
require_env
compose logs --tail=100 -f "${@:-api}"
