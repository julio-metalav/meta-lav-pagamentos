#!/usr/bin/env bash
set -euo pipefail

# LEGACY: este script não usa ENV nem scripts/_env.mjs.
# Forma canônica: ENV=local node scripts/smoke.mjs (ou ENV=ci para CI).

# Load .env.local if present (safe KEY=VALUE parser)
LOADED_ENV_KEYS=()
if [[ -f .env.local ]]; then
  while IFS= read -r line; do
    # ignore empty lines and comments
    [[ -z "$line" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    # accept only KEY=VALUE
    if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      key="${line%%=*}"
      val="${line#*=}"
      # trim spaces
      key="$(echo "$key" | xargs)"
      val="$(echo "$val" | xargs)"
      # strip surrounding quotes
      val="${val%\"}"; val="${val#\"}"
      val="${val%\'}"; val="${val#\'}"
      export "$key=$val"
      LOADED_ENV_KEYS+=("$key")
    fi
  done < .env.local
fi
# Debug (safe): list names of vars parsed from .env.local (no values)
if [[ ${#LOADED_ENV_KEYS[@]} -gt 0 ]]; then
  echo "[env] loaded keys from .env.local: ${LOADED_ENV_KEYS[*]}" >&2
else
  echo "[env] no keys loaded from .env.local" >&2
fi

BASE_URL="${BASE_URL:-http://localhost:3000}"
POS_SERIAL="${POS_SERIAL:-POS-TESTE-001}"
IDENTIFICADOR_LOCAL="${IDENTIFICADOR_LOCAL:-LAV-01}"
VALOR_CENTAVOS="${VALOR_CENTAVOS:-1600}"
METODO="${METODO:-PIX}"
PROVIDER="${PROVIDER:-stone}"
PROVIDER_REF="${PROVIDER_REF:-TEST-$(date +%s)}"
CONDOMINIO_MAQUINAS_ID="${CONDOMINIO_MAQUINAS_ID:-}"
GATEWAY_ID_QUERY="${GATEWAY_ID:-}"

if [[ -z "${CONDOMINIO_MAQUINAS_ID}" ]]; then
  echo "ERROR: CONDOMINIO_MAQUINAS_ID is required (env)." >&2
  exit 2
fi

workdir="$(mktemp -d)"
trap 'rm -rf "${workdir}"' EXIT

HDRS="${workdir}/headers.tmp"
BODY="${workdir}/body.tmp"

http_status() {
  awk 'BEGIN{RS="\r\n\r\n"} {print $0}' "${HDRS}" | awk 'END{for(i=1;i<=NF;i++) if($i ~ /^[0-9]{3}$/){print $i}}'
}

curl_json() {
  local method="$1" url="$2" data="${3:-}" expect="${4:-200}"
  : >"${BODY}"
  local status
  if [[ -n "${data}" ]]; then
    status=$(curl -sS -o "${BODY}" -w "%{http_code}" -H 'content-type: application/json' -X "$method" --data "$data" "$url" || true)
  else
    status=$(curl -sS -o "${BODY}" -w "%{http_code}" -X "$method" "$url" || true)
  fi
  if [[ -z "${status}" ]]; then status=000; fi
  if [[ "${status}" != "${expect}" && "${status}" != "201" ]]; then
    echo "HTTP ${status} when calling $method $url" >&2
    echo "--- response body ---" >&2
    cat "${BODY}" >&2 || true
    echo "---------------------" >&2
    return 1
  fi
  cat "${BODY}"
}

uuid() {
  if command -v uuidgen >/dev/null 2>&1; then uuidgen; else cat /proc/sys/kernel/random/uuid; fi
}

CORR="$(uuid)"

# 1) /api/pos/authorize
AUTH_BODY=$(jq -cn --arg pos "$POS_SERIAL" --arg idl "$IDENTIFICADOR_LOCAL" --argjson v "$VALOR_CENTAVOS" --arg m "$METODO" '{pos_serial:$pos,identificador_local:$idl,valor_centavos:$v,metodo:$m}')
RESP1=$(curl_json POST "$BASE_URL/api/pos/authorize" "$AUTH_BODY" 200)
PAGAMENTO_ID=$(echo "$RESP1" | jq -r '.pagamento_id // .payment_id // empty')
CORR_ID=$(echo "$RESP1" | jq -r '.correlation_id // empty')
if [[ -z "$PAGAMENTO_ID" ]]; then echo "ERROR: pagamento_id missing in authorize" >&2; echo "$RESP1" >&2; exit 3; fi

# 2) /api/payments/confirm
CONF_BODY=$(jq -cn --arg pid "$PAGAMENTO_ID" --arg p "$PROVIDER" --arg ref "$PROVIDER_REF" '{payment_id:$pid,provider:$p,provider_ref:$ref,result:"approved"}')
RESP2=$(curl_json POST "$BASE_URL/api/payments/confirm" "$CONF_BODY" 200)
STATUS2=$(echo "$RESP2" | jq -r '.status // empty')
if [[ "$STATUS2" != "confirmed" && -n "$STATUS2" ]]; then echo "ERROR: confirm status not confirmed: $STATUS2" >&2; exit 4; fi

# 3) /api/payments/execute-cycle
EXEC_KEY="e2e:${PAGAMENTO_ID}"
EXEC_BODY=$(jq -cn --arg pid "$PAGAMENTO_ID" --arg mid "$CONDOMINIO_MAQUINAS_ID" --arg key "$EXEC_KEY" '{payment_id:$pid,condominio_maquinas_id:$mid,idempotency_key:$key,channel:"pos",origin:{pos_device_id:null,user_id:null}}')
RESP3=$(curl_json POST "$BASE_URL/api/payments/execute-cycle" "$EXEC_BODY" 200)
CYCLE_ID=$(echo "$RESP3" | jq -r '.cycle_id // empty')
CMD_ID=$(echo "$RESP3" | jq -r '.command_id // empty')
if [[ -z "$CYCLE_ID" || -z "$CMD_ID" ]]; then echo "ERROR: missing cycle_id/command_id in execute-cycle" >&2; echo "$RESP3" >&2; exit 5; fi

# 4) /api/iot/poll (dev mode allows gateway_id query). Try without, then with env GATEWAY_ID if provided.
POLL_URL="$BASE_URL/api/iot/poll"
RESP4_OK=0
if RESP4=$(curl_json GET "$POLL_URL" "" 200); then RESP4_OK=1; fi
if [[ $RESP4_OK -ne 1 && -n "$GATEWAY_ID_QUERY" ]]; then
  if RESP4=$(curl_json GET "$POLL_URL?gateway_id=$GATEWAY_ID_QUERY" "" 200); then RESP4_OK=1; fi
fi
if [[ $RESP4_OK -ne 1 ]]; then
  echo "ERROR: /api/iot/poll denied (likely HMAC required). Use scripts/e2e-hmac-demo.sh for HMAC mode." >&2
  exit 6
fi
# Best-effort check for command id presence
if ! echo "$RESP4" | jq -e --arg cid "$CMD_ID" 'tostring | test($cid)' >/dev/null 2>&1; then
  echo "WARN: command_id not visible in poll response (may be filtered). Continuing..." >&2
fi

# 5) /api/iot/ack
NOW_TS=$(date +%s)
ACK_BODY=$(jq -cn --arg cmd "$CMD_ID" --argjson ok true --argjson ts "$NOW_TS" --arg mid "$IDENTIFICADOR_LOCAL" '{cmd_id:$cmd,ok:$ok,ts:$ts,machine_id:$mid}')
RESP5=$(curl_json POST "$BASE_URL/api/iot/ack" "$ACK_BODY" 200)

# 6) /api/iot/evento (minimal)
EV_BODY=$(jq -cn --arg type "cycle_started" --arg cmd "$CMD_ID" --argjson ts "$NOW_TS" --arg mid "$IDENTIFICADOR_LOCAL" '{type:$type,cmd_id:$cmd,ts:$ts,machine_id:$mid,meta:{}}')
RESP6=$(curl_json POST "$BASE_URL/api/iot/evento" "$EV_BODY" 200)

# --- DB VALIDATION ---
if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required for DB validation" >&2
  exit 10
fi

echo "Validating DB state..."
REST_URL="$SUPABASE_URL/rest/v1"
auth_hdr="apikey: $SUPABASE_SERVICE_ROLE_KEY"
bearer_hdr="Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"

# 1) Check payment status
PAY_DB=$(curl -sS \
  -H "$auth_hdr" \
  -H "$bearer_hdr" \
  "$REST_URL/pagamentos?id=eq.$PAGAMENTO_ID&select=id,status")
PAY_STATUS=$(echo "$PAY_DB" | jq -r '.[0].status // empty')
if [[ "$PAY_STATUS" != "PAGO" ]]; then
  echo "ERROR: pagamento status not PAGO (found: $PAY_STATUS)" >&2
  exit 11
fi

# 2) Check cycle exists and linked
CYCLE_DB=$(curl -sS \
  -H "$auth_hdr" \
  -H "$bearer_hdr" \
  "$REST_URL/ciclos?id=eq.$CYCLE_ID&select=id,status")
CYCLE_STATUS=$(echo "$CYCLE_DB" | jq -r '.[0].status // empty')
if [[ -z "$CYCLE_STATUS" ]]; then
  echo "ERROR: cycle not found in DB" >&2
  exit 12
fi

# 3) Check IoT command status
CMD_DB=$(curl -sS \
  -H "$auth_hdr" \
  -H "$bearer_hdr" \
  "$REST_URL/iot_commands?id=eq.$CMD_ID&select=id,status")
CMD_STATUS=$(echo "$CMD_DB" | jq -r '.[0].status // empty')
if [[ -z "$CMD_STATUS" ]]; then
  echo "ERROR: iot command not found in DB" >&2
  exit 13
fi

echo "DB VALIDATION OK"
echo "payment_status=$PAY_STATUS"
echo "cycle_status=$CYCLE_STATUS"
echo "command_status=$CMD_STATUS"

# Summary
echo "pagamento_id=$PAGAMENTO_ID"
echo "cycle_id=$CYCLE_ID"
echo "command_id=$CMD_ID"
echo "E2E SMOKE v1 OK"
