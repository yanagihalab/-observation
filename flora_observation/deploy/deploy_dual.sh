#!/usr/bin/env bash
set -euo pipefail

# =========================================
# 0) 必須コマンド確認
# =========================================
command -v jq        >/dev/null || { echo "ERROR: jq が必要です"; exit 1; }
command -v neutrond  >/dev/null || { echo "ERROR: neutrond が必要です"; exit 1; }
# ハッシュ照合は任意（無くても動きますが精度向上のため推奨）
command -v sha256sum >/dev/null || echo "WARN: sha256sum が無いと data_hash(hex) 照合が無効"
command -v openssl   >/dev/null || echo "WARN: openssl が無いと data_hash(base64) 照合が無効"

# =========================================
# 1) 変数読み込み
# =========================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$SCRIPT_DIR/out"; mkdir -p "$OUT_DIR"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/vars.env"

: "${CHAIN_ID:?CHAIN_ID is required}"
: "${KEY:?KEY is required}"
: "${ADMIN:?ADMIN is required}"
: "${WASM:?WASM path is required}"

# 既定値（vars.env で上書き可）
NODE="${NODE:-https://neutron-testnet-rpc.polkachu.com:443}"   # 送信用
QUERY_NODE="${QUERY_NODE:-$NODE}"                               # クエリ用（別RPCにしても良い）
KEYRING_BACKEND="${KEYRING_BACKEND:-os}"
GAS_PRICE="${GAS_PRICE:-0.025untrn}"
GAS_ADJ="${GAS_ADJ:-1.3}"
MAX_WAIT_SEC="${MAX_WAIT_SEC:-120}"  # list-code 差分検出の最大待ち時間
SLEEP_SEC="${SLEEP_SEC:-2}"

# WASMパス確認
WASM_PATH="$ROOT_DIR/$WASM"
[ -f "$WASM_PATH" ] || { echo "ERROR: WASM not found: $WASM_PATH"; exit 1; }

# RPC 疎通
neutrond status --node "$NODE" -o json >/dev/null 2>&1     || { echo "ERROR: TX用RPCに接続できません: $NODE"; exit 1; }
neutrond status --node "$QUERY_NODE" -o json >/dev/null 2>&1 || { echo "ERROR: QUERY用RPCに接続できません: $QUERY_NODE"; exit 1; }

echo "== deploy_dual.sh =="
echo "CHAIN_ID=$CHAIN_ID"
echo "NODE(TX)=$NODE"
echo "NODE(Q) =$QUERY_NODE"
echo "KEY=$KEY (keyring=$KEYRING_BACKEND)"
echo "WASM_PATH=$WASM_PATH"
echo

# 候補クエリRPC（txログやlist-codeが速い所を自動試行）
CANDIDATE_QUERY_NODES=(
  "$QUERY_NODE"
  "https://rpc-palvus.pion-1.neutron.org:443"
  "https://neutron-testnet-rpc.itrocket.net:443"
  "https://neutron-testnet.rpc.nodestake.top:443"
)

# =========================================
# 2) ユーティリティ
# =========================================
render_json() { sed -e "s#\$ADMIN#${ADMIN}#g" "$1"; }

get_code_id_from_tx_json() {
  jq -r '.logs[0].events[]? | select(.type=="store_code")
         | .attributes[] | select(.key=="code_id") | .value // empty' 2>/dev/null || true
}

snapshot_list_code() {
  neutrond q wasm list-code --node "$1" -o json 2>/dev/null | jq -c '.code_infos // []'
}

pick_code_id_from_diff() {
  # before_json, after_json, hex, b64, creator
  local before="$1" after="$2" hex="$3" b64="$4" creator="$5"
  jq -r --arg H "$hex" --arg B "$b64" --arg C "$creator" '
    ( $after - $before ) as $new
    | [ $new[]?
        | select( ( .creator == $C )
                  or ( ( .data_hash|ascii_upcase ) == ($H|ascii_upcase) )
                  or ( .data_hash == $B ) )
        | (.code_id|tonumber)
      ]
    | if length==0 then empty else max end
  ' --argjson before "$before" --argjson after "$after"
}

pick_query_node_for_tx () { # txhashから store_code が見えるノードを探す
  local txh="$1"
  for n in "${CANDIDATE_QUERY_NODES[@]}"; do
    neutrond q tx "$txh" --node "$n" -o json 2>/dev/null \
    | jq -e '.logs[0].events[]? | select(.type=="store_code")' >/dev/null && { echo "$n"; return 0; }
  done
  return 1
}

pick_query_node_for_listcode () { # list-code が見えるノード
  for n in "${CANDIDATE_QUERY_NODES[@]}"; do
    neutrond q wasm list-code --node "$n" -o json >/dev/null 2>&1 && { echo "$n"; return 0; }
  done
  return 1
}

# v2 → v1 へ不要フィールド削除（出力ファイルに書く）
make_v1_json () { # $1: src_json_path  $2: dst_json_path
  jq 'del(.mint_start,.mint_end,.base_uri,.placeholder_uri,.revealed,.provenance_hash,.fee_recipient)' \
     "$1" > "$2"
}

# tx から _contract_address を拾う（候補RPC総当たり）
addr_from_tx () { # $1: txhash
  local txh="$1" a=""
  for q in "${CANDIDATE_QUERY_NODES[@]}"; do
    a=$(neutrond q tx "$txh" --node "$q" -o json 2>/dev/null \
      | jq -r '
          .. | objects
          | select(has("type") and .type=="instantiate")
          | .attributes[]? | select(.key=="_contract_address")
          | .value
        ' | head -n1)
    [[ "$a" =~ ^neutron1[0-9a-z]+$ ]] && { echo "$a"; return 0; }
  done
  return 1
}

# list-contract-by-code から label 照合で特定（tx.logs が空でも確実化）
addr_from_listing_by_label () { # $1: code_id  $2: expected_label
  local cid="$1" want="$2" a lbl
  local node; node="$(pick_query_node_for_listcode || echo "$QUERY_NODE")"
  for a in $(neutrond q wasm list-contract-by-code "$cid" --node "$node" -o json \
              | jq -r '.contracts[]'); do
    lbl=$(neutrond q wasm contract "$a" --node "$node" -o json \
            | jq -r '.contract_info.label // empty')
    [ "$lbl" = "$want" ] && { echo "$a"; return 0; }
  done
  return 1
}

# コードID配下のアドレスと label を列挙（デバッグ/切り分け用）
print_code_id_label_listing () { # $1: code_id
  local cid="$1" node; node="$(pick_query_node_for_listcode || echo "$QUERY_NODE")"
  for a in $(neutrond q wasm list-contract-by-code "$cid" --node "$node" -o json | jq -r '.contracts[]'); do
    neutrond q wasm contract "$a" --node "$node" -o json | jq -r '[.address, .contract_info.label] | @tsv'
  done
}

# =========================================
# 3) Store（CODE_ID 未指定時のみ）
# =========================================
if [ "${CODE_ID:-}" = "" ]; then
  echo "==> Store WASM: $WASM_PATH"

  # list-code の事前スナップショット（最初に見えるノードで）
  LC_NODE="$(pick_query_node_for_listcode || echo "$QUERY_NODE")"
  BEFORE="$(snapshot_list_code "$LC_NODE")"

  # 照合用ハッシュ（任意）
  HEX="$(command -v sha256sum >/dev/null && sha256sum "$WASM_PATH" | awk '{print $1}' | tr '[:lower:]' '[:upper:]' || echo "")"
  B64="$(command -v openssl   >/dev/null && openssl dgst -sha256 -binary "$WASM_PATH" | base64 || echo "")"

  # 送信：sync（txhash取得）
  STORE_JSON="$(neutrond tx wasm store "$WASM_PATH" \
    --from "$KEY" --chain-id "$CHAIN_ID" \
    --node "$NODE" --keyring-backend "$KEYRING_BACKEND" \
    --broadcast-mode sync \
    --gas auto --gas-adjustment "$GAS_ADJ" --gas-prices "$GAS_PRICE" \
    -y -o json)" || { echo "ERROR: store 失敗"; exit 1; }
  echo "$STORE_JSON" > "$OUT_DIR/store_tx.json"
  TXH="$(echo "$STORE_JSON" | jq -r '.txhash // empty')"
  echo "  txhash: ${TXH:-<none>}";

  # txログが見えるRPCを自動選択して code_id を取得（最大 30 秒）
  CODE_ID=""
  ALT_Q="$(pick_query_node_for_tx "$TXH" || true)"
  if [ -n "$ALT_Q" ]; then
    for _ in {1..15}; do
      TX_JSON="$(neutrond q tx "$TXH" --node "$ALT_Q" -o json 2>/dev/null || true)"
      CID="$(echo "${TX_JSON:-}" | get_code_id_from_tx_json || true)"
      if [ -n "${CID:-}" ]; then CODE_ID="$CID"; break; fi
      sleep 2
    done
  fi

  # txログで取れなければ list-code の差分から検出（最大 MAX_WAIT_SEC）
  if [ -z "${CODE_ID:-}" ]; then
    echo "  waiting list-code diff (up to ${MAX_WAIT_SEC}s)..."
    LC_NODE="$(pick_query_node_for_listcode || echo "$LC_NODE")"
    START="$(date +%s)"
    while :; do
      AFTER="$(snapshot_list_code "$LC_NODE")"
      CID="$(pick_code_id_from_diff "$BEFORE" "$AFTER" "$HEX" "$B64" "$ADMIN" || true)"
      if [ -n "${CID:-}" ]; then CODE_ID="$CID"; break; fi
      NOW="$(date +%s)"; ELAP=$((NOW-START))
      [ "$ELAP" -ge "$MAX_WAIT_SEC" ] && break
      sleep "$SLEEP_SEC"
    done
  fi

  # まだダメなら creator=ADMIN の最新を採用（最後の砦）
  if [ -z "${CODE_ID:-}" ]; then
    CODE_ID="$(neutrond q wasm list-code --node "$LC_NODE" -o json \
      | jq -r --arg C "$ADMIN" '
          [ .code_infos[]? | select(.creator==$C) | (.code_id|tonumber) ]
          | if length==0 then empty else max end
        ' 2>/dev/null || true)"
  fi

  [ -n "${CODE_ID:-}" ] || { echo "ERROR: CODE_ID の特定に失敗しました"; exit 1; }
  echo "$CODE_ID" > "$OUT_DIR/last_code_id.txt"
fi
echo "==> CODE_ID: $CODE_ID"

# =========================================
# 4) Instantiate（観察記録 用）— v2→v1 自動フォールバック（tee/PIPESTATUS/JSON.codeチェック）
# =========================================
OBS_LABEL="obs-nft-$(date +%s)"
OBS_JSON_V2="$OUT_DIR/obs.rendered.json"
OBS_JSON_V1="$OUT_DIR/obs.v1.json"
render_json "$SCRIPT_DIR/instances/obs.json" > "$OBS_JSON_V2"
make_v1_json "$OBS_JSON_V2" "$OBS_JSON_V1"

echo "==> Instantiate (Observation)"
set +e
neutrond tx wasm instantiate "$CODE_ID" "$(cat "$OBS_JSON_V2")" \
  --label "$OBS_LABEL" \
  --from "$KEY" --chain-id "$CHAIN_ID" \
  --admin "$ADMIN" \
  --node "$NODE" --keyring-backend "$KEYRING_BACKEND" \
  --broadcast-mode sync \
  --gas auto --gas-adjustment "$GAS_ADJ" --gas-prices "$GAS_PRICE" \
  -y -o json |& tee "$OUT_DIR/obs_tx.json"
RC=${PIPESTATUS[0]}
set -e
OBS_JSON_CODE="$(jq -r '.code // empty' "$OUT_DIR/obs_tx.json" 2>/dev/null || true)"
if [ "$RC" -ne 0 ] || { [ -n "$OBS_JSON_CODE" ] && [ "$OBS_JSON_CODE" != "0" ]; } || grep -qi 'unknown field' "$OUT_DIR/obs_tx.json"; then
  echo "  retry with v1 JSON (fields trimmed)"
  set +e
  neutrond tx wasm instantiate "$CODE_ID" "$(cat "$OBS_JSON_V1")" \
    --label "$OBS_LABEL" \
    --from "$KEY" --chain-id "$CHAIN_ID" \
    --admin "$ADMIN" \
    --node "$NODE" --keyring-backend "$KEYRING_BACKEND" \
    --broadcast-mode sync \
    --gas auto --gas-adjustment "$GAS_ADJ" --gas-prices "$GAS_PRICE" \
    -y -o json |& tee "$OUT_DIR/obs_tx.json"
  RC=${PIPESTATUS[0]}
  set -e
  OBS_JSON_CODE="$(jq -r '.code // empty' "$OUT_DIR/obs_tx.json" 2>/dev/null || true)"
  if [ "$RC" -ne 0 ] || { [ -n "$OBS_JSON_CODE" ] && [ "$OBS_JSON_CODE" != "0" ]; }; then
    echo "ERROR: instantiate (Observation) 失敗"; exit 1
  fi
fi

OBS_TXH="$(jq -r '.txhash // empty' "$OUT_DIR/obs_tx.json" 2>/dev/null || true)"
OBS_ADDR="$(addr_from_tx "$OBS_TXH" || true)"
[ -z "$OBS_ADDR" ] && OBS_ADDR="$(addr_from_listing_by_label "$CODE_ID" "$OBS_LABEL" || true)"
[ -n "$OBS_ADDR" ] || { echo "ERROR: 観察記録用のアドレス取得に失敗しました。"; exit 1; }
echo "OBS_CONTRACT=$OBS_ADDR"

# =========================================
# 5) Instantiate（入場券 用）— v2→v1 自動フォールバック（tee/PIPESTATUS/JSON.codeチェック）
# =========================================
TICKET_LABEL="ticket-nft-$(date +%s)"
TICKET_JSON_V2="$OUT_DIR/ticket.rendered.json"
TICKET_JSON_V1="$OUT_DIR/ticket.v1.json"
render_json "$SCRIPT_DIR/instances/ticket.json" > "$TICKET_JSON_V2"
make_v1_json "$TICKET_JSON_V2" "$TICKET_JSON_V1"

echo "==> Instantiate (Ticket)"
set +e
neutrond tx wasm instantiate "$CODE_ID" "$(cat "$TICKET_JSON_V2")" \
  --label "$TICKET_LABEL" \
  --from "$KEY" --chain-id "$CHAIN_ID" \
  --admin "$ADMIN" \
  --node "$NODE" --keyring-backend "$KEYRING_BACKEND" \
  --broadcast-mode sync \
  --gas auto --gas-adjustment "$GAS_ADJ" --gas-prices "$GAS_PRICE" \
  -y -o json |& tee "$OUT_DIR/ticket_tx.json"
RC=${PIPESTATUS[0]}
set -e
TICKET_JSON_CODE="$(jq -r '.code // empty' "$OUT_DIR/ticket_tx.json" 2>/dev/null || true)"
if [ "$RC" -ne 0 ] || { [ -n "$TICKET_JSON_CODE" ] && [ "$TICKET_JSON_CODE" != "0" ]; } || grep -qi 'unknown field' "$OUT_DIR/ticket_tx.json"; then
  echo "  retry with v1 JSON (fields trimmed)"
  set +e
  neutrond tx wasm instantiate "$CODE_ID" "$(cat "$TICKET_JSON_V1")" \
    --label "$TICKET_LABEL" \
    --from "$KEY" --chain-id "$CHAIN_ID" \
    --admin "$ADMIN" \
    --node "$NODE" --keyring-backend "$KEYRING_BACKEND" \
    --broadcast-mode sync \
    --gas auto --gas-adjustment "$GAS_ADJ" --gas-prices "$GAS_PRICE" \
    -y -o json |& tee "$OUT_DIR/ticket_tx.json"
  RC=${PIPESTATUS[0]}
  set -e
  TICKET_JSON_CODE="$(jq -r '.code // empty' "$OUT_DIR/ticket_tx.json" 2>/dev/null || true)"
  if [ "$RC" -ne 0 ] || { [ -n "$TICKET_JSON_CODE" ] && [ "$TICKET_JSON_CODE" != "0" ]; }; then
    echo "ERROR: instantiate (Ticket) 失敗"; exit 1
  fi
fi

TICKET_TXH="$(jq -r '.txhash // empty' "$OUT_DIR/ticket_tx.json" 2>/dev/null || true)"
TICKET_ADDR="$(addr_from_tx "$TICKET_TXH" || true)"
[ -z "$TICKET_ADDR" ] && TICKET_ADDR="$(addr_from_listing_by_label "$CODE_ID" "$TICKET_LABEL" || true)"
[ -n "$TICKET_ADDR" ] || { echo "ERROR: 入場券用のアドレス取得に失敗しました。"; exit 1; }
echo "TICKET_CONTRACT=$TICKET_ADDR"

# =========================================
# 5.5) 衝突検出と自動修復（両方が同じアドレスになった場合の対策）
if [ "${OBS_ADDR:-}" = "${TICKET_ADDR:-}" ]; then
  echo "WARN: OBS_CONTRACT と TICKET_CONTRACT が同じです。label で切り分けます..."
  print_code_id_label_listing "$CODE_ID" || true
  O2="$(addr_from_listing_by_label "$CODE_ID" "$OBS_LABEL" || true)"
  T2="$(addr_from_listing_by_label "$CODE_ID" "$TICKET_LABEL" || true)"
  if [ -n "$O2" ] && [ -n "$T2" ] && [ "$O2" != "$T2" ]; then
    OBS_ADDR="$O2"; TICKET_ADDR="$T2"
    echo "FIXED by label: OBS=$OBS_ADDR / TICKET=$TICKET_ADDR"
  else
    echo "WARN: label でも分離できません。観察記録をユニークlabelで再インスタンス化します..."
    FIX_LABEL="${OBS_LABEL}-fix"
    set +e
    neutrond tx wasm instantiate "$CODE_ID" "$(cat "$OBS_JSON_V1")" \
      --label "$FIX_LABEL" \
      --from "$KEY" --chain-id "$CHAIN_ID" \
      --admin "$ADMIN" \
      --node "$NODE" --keyring-backend "$KEYRING_BACKEND" \
      --broadcast-mode sync \
      --gas auto --gas-adjustment "$GAS_ADJ" --gas-prices "$GAS_PRICE" \
      -y -o json |& tee "$OUT_DIR/obs_tx_fix.json"
    RC=${PIPESTATUS[0]}
    set -e
    [ $RC -ne 0 ] && { echo "ERROR: 再インスタンス化失敗"; exit 1; }
    OBS_TXH="$(jq -r '.txhash // empty' "$OUT_DIR/obs_tx_fix.json")"
    OBS_ADDR="$(addr_from_tx "$OBS_TXH" || true)"
    [ -z "$OBS_ADDR" ] && OBS_ADDR="$(addr_from_listing_by_label "$CODE_ID" "$FIX_LABEL" || true)"
    [ -n "$OBS_ADDR" ] || { echo "ERROR: 再インスタンス化後も観察記録のアドレス取得に失敗"; exit 1; }
    echo "OBS_CONTRACT (reinstantiated) = $OBS_ADDR"
  fi
fi

# =========================================
# 6) 出力
# =========================================
cat > "$OUT_DIR/addresses.env" <<EOF
# generated by deploy_dual.sh
CODE_ID=$CODE_ID
OBS_CONTRACT=$OBS_ADDR
TICKET_CONTRACT=$TICKET_ADDR
EOF

jq -n --arg code_id "$CODE_ID" --arg obs "$OBS_ADDR" --arg ticket "$TICKET_ADDR" \
  '{code_id:$code_id, obs_contract:$obs, ticket_contract:$ticket}' \
  > "$OUT_DIR/addresses.json"

echo "==> Done."
echo "  - CODE_ID        : $CODE_ID"
echo "  - OBS_CONTRACT   : $OBS_ADDR  (/ipfs-upload-mint)"
echo "  - TICKET_CONTRACT: $TICKET_ADDR (/mint-nft)"
echo "  -> export で使う:  source $OUT_DIR/addresses.env"
