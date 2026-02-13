#!/usr/bin/env bash
set -euo pipefail

# E2E HMAC demo for Meta-Lav Pagamentos (NEXUS)
# - Signs /api/iot/ack and /api/iot/evento using HMAC from .env.local
# - Optionally triggers /api/pos/authorize to obtain cmd_id/ciclo_id
# - Validates via Supabase REST without printing secrets

# Defaults (can be overridden via env or CLI flags)
GATEWAY_SERIAL=${GATEWAY_SERIAL:-GW-TESTE-001}
GATEWAY_ID=${GATEWAY_ID:-dcd8a36c-0ebf-4572-b01f-cb9531d6eba0}
POS_SERIAL=${POS_SERIAL:-POS-TESTE-001}
MACHINE_ID=${MACHINE_ID:-LAV-01}
CMD_ID=${CMD_ID:-}
BASE_URL=${BASE_URL:-http://127.0.0.1:3000}
AMOUNT_CENTS=${AMOUNT_CENTS:-1600}

ENV_FILE=".env.local"

usage() {
  cat <<USG
Usage: GATEWAY_SERIAL=... GATEWAY_ID=... POS_SERIAL=... MACHINE_ID=... CMD_ID=... BASE_URL=... \\
       $0 [--gateway-serial=SER] [--gateway-id=ID] [--pos-serial=SER] [--machine-id=ID] [--cmd-id=UUID] [--base-url=URL]
Defaults:
  GATEWAY_SERIAL=$GATEWAY_SERIAL
  GATEWAY_ID=$GATEWAY_ID
  POS_SERIAL=$POS_SERIAL
  MACHINE_ID=$MACHINE_ID
  CMD_ID=${CMD_ID:-<empty>}
  BASE_URL=$BASE_URL
USG
}

# Simple CLI flag parser
for arg in "$@"; do
  case "$arg" in
    --gateway-serial=*) GATEWAY_SERIAL="${arg#*=}" ;;
    --gateway-id=*) GATEWAY_ID="${arg#*=}" ;;
    --pos-serial=*) POS_SERIAL="${arg#*=}" ;;
    --machine-id=*) MACHINE_ID="${arg#*=}" ;;
    --cmd-id=*) CMD_ID="${arg#*=}" ;;
    --base-url=*) BASE_URL="${arg#*=}" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $arg" >&2; usage; exit 2 ;;
  esac
done

need() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: required tool '$1' not found" >&2; exit 10; }; }
need curl; need jq; need node;

[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE not found" >&2; exit 11; }

# Load minimal env safely (no echo)
load_env() {
  # Reads key=value from .env.local without exporting secrets to stdout
  local key="$1"
  # Use grep -m1 to take the last matching line if duplicates exist
  local val
  val=$(grep -E "^${key}=" "$ENV_FILE" | tail -n1 | sed -E "s/^${key}=//") || true
  [ -n "${val:-}" ] && printf '%s' "$val" || true
}

SUPABASE_URL=$(load_env SUPABASE_URL)
SUPABASE_KEY=$(load_env SUPABASE_SERVICE_ROLE_KEY)
[ -n "$SUPABASE_URL" ] || { echo "ERROR: SUPABASE_URL missing in $ENV_FILE" >&2; exit 12; }
[ -n "$SUPABASE_KEY" ] || { echo "ERROR: SUPABASE_SERVICE_ROLE_KEY missing in $ENV_FILE" >&2; exit 13; }

# HMAC signer using Node, reading secret from .env.local based on serial
hmac_sign() {
  # args: serial ts body
  local serial="$1" ts="$2" body="$3"
  node -e '
    const fs=require("fs"), c=require("crypto");
    const [serial,ts,body,envFile]=process.argv.slice(2);
    const keyVar="IOT_HMAC_SECRET__"+serial.toUpperCase().replace(/[^A-Z0-9]+/g,"_");
    const lines=fs.readFileSync(envFile,"utf8").split(/\r?\n/);
    let secret=null;
    const bySerial=lines.filter(l=>l.startsWith(keyVar+"=")).map(l=>l.slice(keyVar.length+1));
    if(bySerial.length) secret=bySerial[bySerial.length-1];
    if(!secret){
      const any=lines.filter(l=>l.startsWith("IOT_HMAC_SECRET=")).map(l=>l.slice("IOT_HMAC_SECRET=".length));
      if(any.length) secret=any[any.length-1];
    }
    if(!secret){
      console.error("ERROR: Missing IOT_HMAC_SECRET__"+keyVar+" or IOT_HMAC_SECRET in "+envFile);
      process.exit(20);
    }
    const s=`${serial}.${ts}.${body}`;
    process.stdout.write(c.createHmac("sha256",secret).update(s,"utf8").digest("hex"));
  ' "$serial" "$ts" "$body" "$ENV_FILE"
}

# Helper: redacted echo of signed request
print_signed() {
  local method="$1" path="$2" ts="$3" sign_body="$4"
  printf 'curl -X %s %s%s %s %s %s -d %s\n' \
    "$method" "$BASE_URL" "$path" \
    "-H 'Content-Type: application/json'" \
    "-H 'x-gw-serial: $GATEWAY_SERIAL'" \
    "-H 'x-gw-ts: $ts' -H 'x-gw-sign: ***'" \
    "'$sign_body'"
}

# Ensure API is reachable
http_code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/") || true
[ "$http_code" = "200" ] || { echo "ERROR: BASE_URL $BASE_URL not responding (got HTTP $http_code)" >&2; exit 30; }

# If no CMD_ID provided, trigger authorize
CICLO_ID=""
if [ -z "${CMD_ID}" ]; then
  echo "[1/6] POST /api/pos/authorize (create pagamento/ciclo/cmd)"
  AUTH_BODY=$(jq -nc --arg pos "$POS_SERIAL" --arg il "$MACHINE_ID" --argjson v $AMOUNT_CENTS '{pos_serial:$pos, identificador_local:$il, valor_centavos:$v, metodo:"PIX", channel:"pos", origin:{pos_device_id:null,user_id:null}}')
  echo "curl -X POST $BASE_URL/api/pos/authorize -H 'Content-Type: application/json' -H 'x-pos-serial: $POS_SERIAL' -d '$AUTH_BODY'"
  AUTH_RESP=$(curl -sS -X POST "$BASE_URL/api/pos/authorize" -H 'Content-Type: application/json' -H "x-pos-serial: $POS_SERIAL" -d "$AUTH_BODY")
  echo "$AUTH_RESP" | jq . >/dev/null || { echo "ERROR: invalid JSON response from authorize" >&2; exit 31; }
  CMD_ID=$(echo "$AUTH_RESP" | jq -r '.cmd_id // empty')
  CICLO_ID=$(echo "$AUTH_RESP" | jq -r '.ciclo_id // empty')
  [ -n "$CMD_ID" ] || { echo "ERROR: authorize did not return cmd_id" >&2; exit 32; }
  [ -n "$CICLO_ID" ] || { echo "WARN: authorize did not return ciclo_id" >&2; }
  echo "→ cmd_id=$CMD_ID ciclo_id=${CICLO_ID:-n/a}"
else
  echo "[1/6] Using provided CMD_ID=$CMD_ID (skip authorize)"
fi

# ACK signed
echo "[2/6] POST /api/iot/ack (signed)"
TS=$(date +%s)
ACK_BODY=$(jq -nc --arg cmd "$CMD_ID" --arg mi "$MACHINE_ID" --argjson ts $TS '{cmd_id:$cmd, ok:true, ts:$ts, machine_id:$mi}')
SIGN=$(hmac_sign "$GATEWAY_SERIAL" "$TS" "$ACK_BODY")
print_signed POST "/api/iot/ack" "$TS" "$ACK_BODY"
ACK_RESP=$(curl -sS -X POST "$BASE_URL/api/iot/ack" -H 'Content-Type: application/json' -H "x-gw-serial: $GATEWAY_SERIAL" -H "x-gw-ts: $TS" -H "x-gw-sign: $SIGN" -d "$ACK_BODY")
echo "$ACK_RESP"

# EVENTO PULSE signed
echo "[3/6] POST /api/iot/evento PULSE (signed)"
TS2=$(date +%s)
PULSE_BODY=$(jq -nc --arg cmd "$CMD_ID" --arg mi "$MACHINE_ID" --argjson ts $TS2 '{type:"PULSE", cmd_id:$cmd, machine_id:$mi, pulses:1, ts:$ts}')
SIGN2=$(hmac_sign "$GATEWAY_SERIAL" "$TS2" "$PULSE_BODY")
print_signed POST "/api/iot/evento" "$TS2" "$PULSE_BODY"
PULSE_RESP=$(curl -sS -X POST "$BASE_URL/api/iot/evento" -H 'Content-Type: application/json' -H "x-gw-serial: $GATEWAY_SERIAL" -H "x-gw-ts: $TS2" -H "x-gw-sign: $SIGN2" -d "$PULSE_BODY")
echo "$PULSE_RESP"

# EVENTO BUSY_ON signed
echo "[4/6] POST /api/iot/evento BUSY_ON (signed)"
TS3=$(date +%s)
ON_BODY=$(jq -nc --arg mi "$MACHINE_ID" --argjson ts $TS3 '{type:"BUSY_ON", machine_id:$mi, ts:$ts}')
SIGN3=$(hmac_sign "$GATEWAY_SERIAL" "$TS3" "$ON_BODY")
print_signed POST "/api/iot/evento" "$TS3" "$ON_BODY"
ON_RESP=$(curl -sS -X POST "$BASE_URL/api/iot/evento" -H 'Content-Type: application/json' -H "x-gw-serial: $GATEWAY_SERIAL" -H "x-gw-ts: $TS3" -H "x-gw-sign: $SIGN3" -d "$ON_BODY")
echo "$ON_RESP"

# EVENTO BUSY_OFF signed
echo "[5/6] POST /api/iot/evento BUSY_OFF (signed)"
TS4=$(date +%s)
OFF_BODY=$(jq -nc --arg mi "$MACHINE_ID" --argjson ts $TS4 '{type:"BUSY_OFF", machine_id:$mi, ts:$ts}')
SIGN4=$(hmac_sign "$GATEWAY_SERIAL" "$TS4" "$OFF_BODY")
print_signed POST "/api/iot/evento" "$TS4" "$OFF_BODY"
OFF_RESP=$(curl -sS -X POST "$BASE_URL/api/iot/evento" -H 'Content-Type: application/json' -H "x-gw-serial: $GATEWAY_SERIAL" -H "x-gw-ts: $TS4" -H "x-gw-sign: $SIGN4" -d "$OFF_BODY")
echo "$OFF_RESP"

# Validation via Supabase REST
[ -n "${CICLO_ID:-}" ] || {
  # Try to infer ciclo_id from PULSE response if possible
  CICLO_ID=$(echo "$PULSE_RESP" | jq -r '.ciclo_fallback_id // .ciclo_id // empty') || true
}

echo "[6/6] Validation (Supabase REST)"
echo "- iot_commands (by cmd_id)"
curl -sS "$SUPABASE_URL/rest/v1/iot_commands?select=id,cmd_id,status,ack_at,created_at&cmd_id=eq.$CMD_ID" \
  -H "apikey: $SUPABASE_KEY" -H "Authorization: Bearer $SUPABASE_KEY" | jq '.'

if [ -n "${CICLO_ID:-}" ]; then
  echo "- ciclos (by ciclo_id=$CICLO_ID)"
  curl -sS "$SUPABASE_URL/rest/v1/ciclos?id=eq.$CICLO_ID&select=id,status,pulso_enviado_at,busy_on_at,busy_off_at" \
    -H "apikey: $SUPABASE_KEY" -H "Authorization: Bearer $SUPABASE_KEY" | jq '.'
else
  echo "- ciclos: ciclo_id not available (skipped)"
fi

echo "Done." 
