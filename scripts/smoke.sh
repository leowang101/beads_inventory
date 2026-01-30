#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
SMOKE_USERNAME="${SMOKE_USERNAME:-test}"
SMOKE_PASSWORD="${SMOKE_PASSWORD:-testtest}"
SMOKE_REGISTER="${SMOKE_REGISTER:-0}"
SMOKE_CODE="${SMOKE_CODE:-A1}"
SMOKE_QTY="${SMOKE_QTY:-3}"
SMOKE_PATTERN="${SMOKE_PATTERN:-smoke}"
SMOKE_SOURCE="${SMOKE_SOURCE:-smoke}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "node is required (used for JSON parsing)" >&2
  exit 1
fi

REQ_BODY=""
REQ_STATUS=""

_do_request() {
  local method="$1"
  local path="$2"
  local body="$3"
  local auth="$4"

  local headers=("-H" "Content-Type: application/json")
  if [ "$auth" = "auth" ]; then
    headers+=("-H" "Authorization: Bearer ${TOKEN}")
  fi

  local resp
  if [ "$method" = "GET" ]; then
    resp=$(curl -sS -w "\n%{http_code}" "${headers[@]}" "${BASE_URL}${path}")
  else
    resp=$(curl -sS -w "\n%{http_code}" -X "$method" "${headers[@]}" -d "$body" "${BASE_URL}${path}")
  fi

  REQ_BODY=$(printf '%s' "$resp" | sed '$d')
  REQ_STATUS=$(printf '%s' "$resp" | tail -n1)
}

_expect_status() {
  local expected="$1"
  if [ "$REQ_STATUS" != "$expected" ]; then
    echo "Expected status ${expected}, got ${REQ_STATUS}" >&2
    echo "Response body: ${REQ_BODY}" >&2
    exit 1
  fi
}

_expect_ok() {
  local expected="$1"
  local ok
  ok=$(printf '%s' "$REQ_BODY" | node -e 'const fs = require("fs"); const input = fs.readFileSync(0, "utf8").trim(); if (!input) process.exit(2); let j; try { j = JSON.parse(input); } catch (e) { process.exit(3); } if (!Object.prototype.hasOwnProperty.call(j, "ok")) process.exit(4); process.stdout.write(String(j.ok));') || {
    echo "Failed to parse JSON or ok field" >&2
    echo "Response body: ${REQ_BODY}" >&2
    exit 1
  }

  if [ "$ok" != "$expected" ]; then
    echo "Expected ok=${expected}, got ok=${ok}" >&2
    echo "Response body: ${REQ_BODY}" >&2
    exit 1
  fi
}

_extract_token() {
  printf '%s' "$REQ_BODY" | node -e 'const fs = require("fs"); const input = fs.readFileSync(0, "utf8").trim(); if (!input) process.exit(2); let j; try { j = JSON.parse(input); } catch (e) { process.exit(3); } if (!j || !j.token) process.exit(4); process.stdout.write(String(j.token));'
}

if [ -z "$SMOKE_USERNAME" ] || [ -z "$SMOKE_PASSWORD" ]; then
  echo "Please set SMOKE_USERNAME and SMOKE_PASSWORD" >&2
  exit 1
fi

printf '==> health\n'
_do_request GET "/api/health" "" "noauth"
_expect_status 200
_expect_ok true

printf '==> public palette\n'
_do_request GET "/api/public/palette" "" "noauth"
_expect_status 200
_expect_ok true

printf '==> unauthorized /api/all\n'
_do_request GET "/api/all" "" "noauth"
_expect_status 401
_expect_ok false

printf '==> unauthorized /api/adjust\n'
_do_request POST "/api/adjust" '{"code":"A1","type":"restock","qty":1}' "noauth"
_expect_status 401
_expect_ok false

printf '==> login\n'
_login_body=$(cat <<JSON
{"username":"${SMOKE_USERNAME}","password":"${SMOKE_PASSWORD}"}
JSON
)
_do_request POST "/api/login" "${_login_body}" "noauth"
if [ "$REQ_STATUS" = "200" ]; then
  _expect_ok true
  TOKEN=$(_extract_token)
elif [ "$REQ_STATUS" = "400" ] || [ "$REQ_STATUS" = "500" ]; then
  if [ "$SMOKE_REGISTER" = "1" ]; then
    printf '==> login failed, try register (SMOKE_REGISTER=1)\n'
    _reg_body=$(cat <<JSON
{"username":"${SMOKE_USERNAME}","password":"${SMOKE_PASSWORD}","confirmPassword":"${SMOKE_PASSWORD}"}
JSON
)
    _do_request POST "/api/register" "${_reg_body}" "noauth"
    _expect_status 200
    _expect_ok true
    TOKEN=$(_extract_token)
  else
    echo "Login failed. Set SMOKE_REGISTER=1 to attempt register." >&2
    echo "Response body: ${REQ_BODY}" >&2
    exit 1
  fi
else
  echo "Unexpected login status: ${REQ_STATUS}" >&2
  echo "Response body: ${REQ_BODY}" >&2
  exit 1
fi

printf '==> /api/me\n'
_do_request GET "/api/me" "" "auth"
_expect_status 200
_expect_ok true

printf '==> /api/all\n'
_do_request GET "/api/all" "" "auth"
_expect_status 200
_expect_ok true

printf '==> /api/adjust restock\n'
_adjust_body=$(cat <<JSON
{"code":"${SMOKE_CODE}","type":"restock","qty":${SMOKE_QTY},"source":"${SMOKE_SOURCE}"}
JSON
)
_do_request POST "/api/adjust" "${_adjust_body}" "auth"
_expect_status 200
_expect_ok true

printf '==> /api/adjust consume\n'
_adjust_body2=$(cat <<JSON
{"code":"${SMOKE_CODE}","type":"consume","qty":1,"pattern":"${SMOKE_PATTERN}","source":"${SMOKE_SOURCE}"}
JSON
)
_do_request POST "/api/adjust" "${_adjust_body2}" "auth"
_expect_status 200
_expect_ok true

printf '==> /api/history\n'
_do_request GET "/api/history?code=${SMOKE_CODE}&limit=5" "" "auth"
_expect_status 200
_expect_ok true

printf '==> /api/resetAll\n'
_do_request POST "/api/resetAll" '{}' "auth"
_expect_status 200
_expect_ok true

printf '==> /api/logout\n'
_do_request POST "/api/logout" '{}' "auth"
_expect_status 200
_expect_ok true

printf 'Smoke test finished OK.\n'
