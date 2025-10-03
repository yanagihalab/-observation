#!/usr/bin/env bash
set -euo pipefail

# ---- 設定（必要ならここだけ編集） ----
ADDR="neutron1urqaxdn4qtrc35zqrw84qkqvawx3ga34j3gjflzm0yp59vta4gqq62jjea"
RPC="https://neutron-testnet-rpc.polkachu.com:443"
FROM="tatatata"
URI="ipfs://QmTuDCtiZJjRFqiZ6D5X2iNX8ejwNu6Kv1F7EcThej9yHu"   # ← 本来は metadata.json を推奨
FEE=""  # 例: FEE="--amount 1000untrn"（有料ミントのときだけ設定）

# ---- ミント用ペイロード（共通） ----
ID="ticket-$(date -u +%Y%m%d-%H%M%S)-cli"
OWNER="$(neutrond keys show "$FROM" -a)"
PAY="$(jq -nc --arg id "$ID" --arg owner "$OWNER" --arg uri "$URI" \
       '{token_id:$id, owner:$owner, token_uri:$uri}')"
B64="$(printf '%s' "$PAY" | base64 -w0)"

echo "ADDR=$ADDR"
echo "OWNER=$OWNER"
echo "TOKEN_ID=$ID"
echo "URI=$URI"
echo "---- trying patterns ----"

try() {
  local msg="$1"; local label="$2"
  echo ">> $label"
  TX="$(neutrond tx wasm execute "$ADDR" "$msg" \
        --from "$FROM" --chain-id pion-1 --node "$RPC" \
        $FEE --gas auto --gas-adjustment 1.5 --gas-prices 0.025untrn \
        -y -b sync -o json | jq -r '.txhash')"
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
  echo "   (still pending or failed; raw_log)"
  echo "$RES" | jq -r '.raw_log // .tx_response.raw_log'
}

# A: {"public_mint":"<base64>"}
try "$(printf '{"public_mint":"%s"}' "$B64")" 'A: public_mint="<base64>"'

# B: {"public_mint":{"msg":"<base64>"}}
try "$(printf '{"public_mint":{"msg":"%s"}}' "$B64")" 'B: public_mint.msg="<base64>"'

# C: {"public_mint":{"payload":"<base64>"}}
try "$(printf '{"public_mint":{"payload":"%s"}}' "$B64")" 'C: public_mint.payload="<base64>"'

# D: {"public_mint":{"data":"<base64>"}}
try "$(printf '{"public_mint":{"data":"%s"}}' "$B64")" 'D: public_mint.data="<base64>"'

# E: {"public_mint":{...}}（プレーン JSON）
try "$(jq -nc --arg id "$ID" --arg owner "$OWNER" --arg uri "$URI" \
         '{public_mint:{token_id:$id, owner:$owner, token_uri:$uri}}')" \
    'E: public_mint (plain JSON)'

echo "❌ all patterns failed."
exit 1
