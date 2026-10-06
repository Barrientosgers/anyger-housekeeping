#!/usr/bin/env bash
# Black-box security checks you can run against any deployment (needs only curl).
#
#   scripts/security-probe.sh https://your-app.onrender.com
#   scripts/security-probe.sh http://localhost:3000 --rate-limit
#
# It sends only harmless requests: invalid or empty bodies, so nothing is ever stored. The optional
# --rate-limit check sends 8 requests to the booking form, which uses up that visitor's 5-per-hour
# allowance (so your own next test submission from the same network may be refused for an hour).
set -u
BASE="${1:?usage: security-probe.sh <base-url> [--rate-limit]}"; BASE="${BASE%/}"
RATE=false; [ "${2:-}" = "--rate-limit" ] && RATE=true
pass=0; fail=0
ok()   { printf '  \033[32mPASS\033[0m %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail=$((fail+1)); }
check(){ if [ "$1" = true ]; then ok "$2"; else bad "$2"; fi; }
code() { curl -s -o /dev/null -w '%{http_code}' -m 30 "$@"; }
hdr()  { curl -s -D - -o /dev/null -m 30 "$@" | tr -d '\r'; }
has()  { printf '%s' "$1" | grep -qi "$2" && echo true || echo false; }

echo "Probing $BASE"
echo "== Transport"
case "$BASE" in https://*)
  r=$(code "http://${BASE#https://}/healthz"); check "$([ "$r" = 301 ] || [ "$r" = 308 ] || [ "$r" = 302 ] && echo true || echo false)" "plain http redirects to https (got $r)";;
esac
H=$(hdr "$BASE/healthz")
echo "== Security headers"
check "$(has "$H" '^content-security-policy:.*default-src .self.')" "Content-Security-Policy limits sources to the app itself"
check "$(has "$H" "^content-security-policy:.*object-src 'none'")" "CSP blocks plugins (object-src 'none')"
check "$(has "$H" '^x-content-type-options: nosniff')" "X-Content-Type-Options: nosniff"
check "$(has "$H" '^referrer-policy:')" "Referrer-Policy is set"
case "$BASE" in https://*) check "$(has "$H" '^strict-transport-security:')" "Strict-Transport-Security is set";; esac
check "$(has "$H" '^x-frame-options:\|frame-ancestors')" "framing is restricted (clickjacking)"
check "$([ "$(has "$H" '^x-powered-by:')" = false ] && echo true || echo false)" "server does not advertise Express (no X-Powered-By)"
echo "== Private data is locked and not cacheable"
for path in "/api/appointments?from=2026-10-01&to=2026-10-31" "/api/requests" "/api/requests/count" "/api/auth/me"; do
  r=$(code "$BASE$path"); check "$([ "$r" = 401 ] && echo true || echo false)" "GET $path needs a login (got $r)"
done
r=$(code -X POST -H 'X-Requested-With: anyger' -H 'Content-Type: application/json' -d '{}' "$BASE/api/translations")
check "$([ "$r" = 401 ] && echo true || echo false)" "POST /api/translations needs a login (got $r)"
H=$(hdr "$BASE/api/appointments?from=2026-10-01&to=2026-10-31")
check "$(has "$H" '^cache-control:.*no-store')" "API responses are Cache-Control: no-store"
echo "== Request handling"
r=$(code -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/api/public/requests"); check "$([ "$r" = 403 ] && echo true || echo false)" "state-changing request without the CSRF header is refused (got $r)"
r=$(code -X POST -H 'X-Requested-With: anyger' -H 'Content-Type: application/json' -d '{"a":' "$BASE/api/public/requests"); check "$([ "$r" = 400 ] && echo true || echo false)" "malformed JSON is a clean 400 (got $r)"
big=$(head -c 30000 /dev/zero | tr '\0' x)
r=$(code -X POST -H 'X-Requested-With: anyger' -H 'Content-Type: application/json' -d "{\"notes\":\"$big\"}" "$BASE/api/public/requests"); check "$([ "$r" = 413 ] && echo true || echo false)" "oversized body is 413, not a server error (got $r)"
body=$(curl -s -m 30 -X POST -H 'X-Requested-With: anyger' -H 'Content-Type: application/json' -d '{}' "$BASE/api/public/requests")
check "$([ "$(has "$body" 'stack\|node_modules\|at .*(.*:[0-9]*:[0-9]*)')" = false ] && echo true || echo false)" "error responses contain no stack traces or paths"
H=$(hdr -X OPTIONS -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: POST' "$BASE/api/appointments")
check "$([ "$(has "$H" '^access-control-allow-origin:')" = false ] && echo true || echo false)" "no CORS: another website cannot call the API from a browser"
echo "== Static files cannot be escaped"
for p in "/..%2f..%2f..%2fetc%2fpasswd" "/%2e%2e/%2e%2e/%2e%2e/etc/passwd" "/assets/..%2f..%2f..%2fpackage.json" "/.env" "/.git/config" "/server/dist/index.js"; do
  out=$(curl -s -m 30 --path-as-is "$BASE$p")
  check "$([ "$(has "$out" 'root:x:\|DATABASE_URL\|SESSION_SECRET\|\[core\]\|createApp')" = false ] && echo true || echo false)" "GET $p leaks nothing"
done
if $RATE; then
  echo "== Booking-form rate limit (5 per hour per visitor), 8 empty requests"
  seq=""; for i in 1 2 3 4 5 6 7 8; do seq="$seq $(code -X POST -H 'X-Requested-With: anyger' -H 'Content-Type: application/json' -d '{}' "$BASE/api/public/requests")"; done
  echo "  statuses:$seq"
  first5=$(echo $seq | cut -d' ' -f1-5 | tr ' ' '\n' | grep -c 429)
  last3=$(echo $seq | cut -d' ' -f6-8 | tr ' ' '\n' | grep -c 429)
  check "$([ "$last3" = 3 ] && echo true || echo false)" "requests 6-8 are all refused (429)"
  check "$([ "$first5" -le 4 ] && echo true || echo false)" "the limit counts one visitor consistently, not a rotating proxy address"
fi
echo; echo "Result: $pass passed, $fail failed"; [ "$fail" = 0 ]
