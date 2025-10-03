#!/usr/bin/env bash
set -euo pipefail

# ====== 環境設定 ======
BINARY="neutrond"                       # 例: junod / osmosisd / wasmd に置換可
CHAIN_ID="pion-1"              # 例: pion-1, neutron-1 等
NODE="https://rpc-palvus.pion-1.ntrn.tech:443"              # 例: https://rpc.pion-1.ntrn.tech:443
WALLET="tatatata"                # 例: mykey
GAS_PRICE="0.025untrn"                  # ネットワークに応じて変更
GAS_ADJ="1.5"
BROADCAST_MODE="sync"

WASM="artifacts/participation_certificate_nft.wasm"
LABEL="cw721-free-mint"
NAME="ParticipationCert"
SYMBOL="PCN"
MAX_SUPPLY=null                           # 無制限なら null / 例: 1000

require(){ command -v "$1" >/dev/null 2>&1 || { echo "ERROR: $1 がありません" >&2; exit 1; }; }
require jq

wait_tx() {
  local hash="$1" timeout="${2:-180}" interval=2 elapsed=0 out
  while (( elapsed < timeout )); do
    out=$("$BINARY" query tx "$hash" --chain-id "$CHAIN_ID" --node "$NODE" -o json 2>/dev/null || true)
    if [[ -n "$out" ]] && jq -e '.txhash != null' >/dev/null 2>&1 <<<"$out"; then
      local code; code=$(jq -r '.code // 0' <<<"$out")
      if [[ "$code" == "0" ]]; then echo "$out"; return 0
      else echo "❌ TX failed (code=$code)"; jq -r '.raw_log' <<<"$out" >&2; return 1; fi
    fi
    sleep "$interval"; elapsed=$((elapsed+interval))
  done
  echo "⏰ Timeout waiting tx $hash" >&2; return 1
}

# --- Store WASM ---
echo "Uploading WASM..."
STORE_JSON=$("$BINARY" tx wasm store "$WASM" \
  --from "$WALLET" \
  --gas auto --gas-adjustment "$GAS_ADJ" --gas-prices "$GAS_PRICE" \
  --broadcast-mode "$BROADCAST_MODE" -y -o json \
  --chain-id "$CHAIN_ID" --node "$NODE")
STORE_HASH=$(jq -r '.txhash' <<<"$STORE_JSON")
echo "  txhash: $STORE_HASH"

STORE_RES="$(wait_tx "$STORE_HASH")"

# --- CODE_ID の抽出（堅牢版）---
# 1) txの全code_id候補から数値最大を採用
TX_CODE_ID=$(jq -r '
  [ .logs[]?.events[]?.attributes[]? 
    | select(.key=="code_id") 
    | .value
  ] 
  | map(tonumber?) 
  | max // empty
' <<<"$STORE_RES")

# 2) creator検証（違うならフォールバックに切替）
MY_ADDR=$("$BINARY" keys show "$WALLET" -a)
GOOD=""
if [[ -n "${TX_CODE_ID:-}" && "$TX_CODE_ID" != "null" ]]; then
  CREATOR=$("$BINARY" query wasm code "$TX_CODE_ID" --node "$NODE" -o json | jq -r '.code_info.creator // empty')
  if [[ "$CREATOR" == "$MY_ADDR" ]]; then
    GOOD="$TX_CODE_ID"
  fi
fi

# 3) フォールバック: list-code から "自分が作成した code_id の最大値" を採用
if [[ -z "$GOOD" ]]; then
  GOOD=$("$BINARY" query wasm list-code --node "$NODE" -o json \
    | jq -r --arg c "$MY_ADDR" '
        [ .code_infos[]? 
          | select(.creator == $c) 
          | .code_id 
          | tonumber
        ] 
        | max // empty
      ')
fi

# 4) 最終フォールバック: 単に一番新しい code_id
if [[ -z "$GOOD" || "$GOOD" == "null" ]]; then
  GOOD=$("$BINARY" query wasm list-code --node "$NODE" -o json | jq -r '.code_infos[-1].code_id')
fi

CODE_ID="$GOOD"
echo "CODE_ID = $CODE_ID   (from tx: $TX_CODE_ID / creator: $MY_ADDR)"

# --- Instantiate ---
INIT_MSG=$(jq -nc --arg name "$NAME" --arg symbol "$SYMBOL" --argjson max "$MAX_SUPPLY" \
  '{name:$name, symbol:$symbol, max_supply:$max}')

echo "Instantiating..."
INIT_JSON=$("$BINARY" tx wasm instantiate "$CODE_ID" "$INIT_MSG" \
  --label "$LABEL" --from "$WALLET" --no-admin \
  --gas auto --gas-adjustment "$GAS_ADJ" --gas-prices "$GAS_PRICE" \
  --broadcast-mode "$BROADCAST_MODE" -y -o json \
  --chain-id "$CHAIN_ID" --node "$NODE")
INIT_HASH=$(jq -r '.txhash' <<<"$INIT_JSON")
echo "  txhash: $INIT_HASH"

INIT_RES="$(wait_tx "$INIT_HASH")"
CONTRACT_ADDR=$(jq -r '
  .logs[]?.events[]? 
  | select(.type=="instantiate" or .type=="instantiate_contract")
  | .attributes[]? 
  | select(.key=="_contract_address" or .key=="contract_address")
  | .value
' <<<"$INIT_RES" | tail -n1)

# Fallback: list-contracts-by-code
if [[ -z "${CONTRACT_ADDR:-}" || "$CONTRACT_ADDR" == "null" ]]; then
  CONTRACT_ADDR=$(
    "$BINARY" query wasm list-contract-by-code "$CODE_ID" --node "$NODE" -o json 2>/dev/null \
    | jq -r '.contracts[-1]' 2>/dev/null \
    || "$BINARY" query wasm list-contracts-by-code "$CODE_ID" --node "$NODE" -o json 2>/dev/null \
    | jq -r '.contracts[-1]'
  )
fi
echo "CONTRACT_ADDR = $CONTRACT_ADDR"

# --- Free mint ---
echo "Minting..."
EXEC_JSON=$("$BINARY" tx wasm execute "$CONTRACT_ADDR" '{"public_mint":{}}' \
  --from "$WALLET" \
  --gas auto --gas-adjustment "$GAS_ADJ" --gas-prices "$GAS_PRICE" \
  --broadcast-mode "$BROADCAST_MODE" -y -o json \
  --chain-id "$CHAIN_ID" --node "$NODE")
EXEC_HASH=$(jq -r '.txhash' <<<"$EXEC_JSON")
wait_tx "$EXEC_HASH" >/dev/null

# --- Query tokens ---
OWNER=$("$BINARY" keys show "$WALLET" -a)
echo "Querying tokens of $OWNER ..."
"$BINARY" query wasm contract-state smart "$CONTRACT_ADDR" \
  "$(jq -nc --arg owner "$OWNER" '{tokens:{owner:$owner, start_after:null, limit:50}}')" \
  --chain-id "$CHAIN_ID" --node "$NODE" -o json | jq

echo "✅ Done."