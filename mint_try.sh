#!/usr/bin/env bash
set -u -o pipefail

# ---- 設定（必要なら編集）----
ADDR="neutron1urqaxdn4qtrc35zqrw84qkqvawx3ga34j3gjflzm0yp59vta4gqq62jjea"
RPC="https://neutron-testnet-rpc.polkachu.com:443"
FROM="tatatata"
URI="ipfs://QmTuDCtiZJjRFqiZ6D5X2iNX8ejwNu6Kv1F7EcThej9yHu"   # 本来は metadata.json 推奨
FEE=""  # 例: FEE="--amount 1000untrn"（有料ミント時だけ設定）

# ---- 共通ペイロード ----
ID="ticket-$(date -u +%Y%m%d-%H%M%S)-cli"
OWNER="$(neutrond keys show "$FROM" -a)"
PAY="$(jq -nc --arg id "$ID" --arg owner "$OWNER" --arg uri "$URI" \
       '{token_id:$id, owner:$owner, token_uri:$uri}')"
B64="$(printf '%s' "$PAY" | base64 | tr -d '\n')"  # OS差分吸収（-w0 不要化）

echo "ADDR=$ADDR"
echo "OWNER=$OWNER"
echo "TOKEN_ID=$ID"
echo "URI=$URI"
echo "---- trying patterns ----"

try() {
  local msg="$1"; local label="$2"
  echo ">> $label"
  # ここでは失敗しても続行したいのでエラーを握りつぶす
  TX="$(neutrond tx wasm execute "$ADDR" "$msg" \
        --from "$FROM" --chain-id pion-1 --node "$RPC" \
        $FEE --gas auto --gas-adjustment 1.5 --gas-prices 0.025untrn \
        -y -b sync -o json 2>/dev/null | jq -r '.txhash' 2>/dev/null || true)"
  if [ -z "${TX:-}" ] || [ "$TX" = "null" ]; then
    echo "   (send failed immediately)"
    return 1
  fi
  echo "   txhash: $TX"
  # 取り込み確認（最大 30 回 / 60 秒）
  for i in $(seq 1 30); do
    RES="$(neutrond q tx "$TX" --node "$RPC" -o json 2>/dev/null || true)"
    CODE="$(echo "$RES" | jq -r '.code // .tx_response.code // empty')"
    if [ "$CODE" = "0" ]; then
      echo "✅ success via $label"
      exit 0
    fi
    sleep 2
  done
  # 失敗詳細を出す
  RAW="$(echo "$RES" | jq -r '.raw_log // .tx_response.raw_log // empty')"
  [ -n "$RAW" ] && echo "   raw_log: $RAW" || echo "   (no tx response yet)"
  return 1
}

# A: {"public_mint":"<base64>"}
try "$(printf '{"public_mint":"%s"}' "$B64")" 'A: public_mint="<base64>"' || true

# B: {"public_mint":{"msg":"<base64>"}}
try "$(printf '{"public_mint":{"msg":"%s"}}' "$B64")" 'B: public_mint.msg="<base64>"' || true

# C: {"public_mint":{"payload":"<base64>"}}
try "$(printf '{"public_mint":{"payload":"%s"}}' "$B64")" 'C: public_mint.payload="<base64>"' || true

# D: {"public_mint":{"data":"<base64>"}}
try "$(printf '{"public_mint":{"data":"%s"}}' "$B64")" 'D: public_mint.data="<base64>"' || true

# E: {"public_mint":{...}}（プレーン JSON）
try "$(jq -nc --arg id "$ID" --arg owner "$OWNER" --arg uri "$URI" \
         '{public_mint:{token_id:$id, owner:$owner, token_uri:$uri}}')" \
    'E: public_mint (plain JSON)' || true

echo "❌ all patterns failed."
exit 1
