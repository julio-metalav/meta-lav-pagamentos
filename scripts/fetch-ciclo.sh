#!/bin/bash
# Uso: scripts/fetch-ciclo.sh [ciclo_id]
# Busca um ciclo na tabela ciclos (Supabase) usando .env.ci.local
set -e
cd "$(dirname "$0")/.."
CICLO_ID="${1:-723acad5-19ba-4b15-b9aa-527447de8e6c}"
if [ -f .env.ci.local ]; then
  set -a
  source .env.ci.local
  set +a
fi
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo '{"error":"SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes (rode com .env.ci.local)"}'
  exit 1
fi
curl -s "${SUPABASE_URL}/rest/v1/ciclos?id=eq.${CICLO_ID}&select=*" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Accept: application/json"
