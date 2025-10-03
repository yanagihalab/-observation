# \[EN] NFT-Based Review Management DApp

## Overview

This project is an NFT-based review submission and management system running on the **Neutron testnet (pion-1)** within the Cosmos ecosystem.
Users can mint NFTs via a web interface built with CosmJS, and **we operate two independent NFT flows in parallel**:

* **Admission Ticket NFT** — `/mint-nft`
  Mint an admission ticket by **providing an already-uploaded metadata CID**.
  Runs on a **dedicated contract instance** (recommended `revealed: true` so the given `ipfs://CID` is stored).
* **Observation Record NFT** — `/ipfs-upload-mint`
  Upload image → build metadata on your backend → **public\_mint**.
  Runs on a **separate contract instance** (often start with `revealed: false` + `placeholder_uri`, then reveal later).

Only NFT holders are allowed to submit a review associated with that specific NFT.
Review data — including score, title, and content — is permanently stored on-chain in a tamper-resistant manner.

### Features

* ✅ NFT Minting (two independent flows: admission ticket / observation record)
* ✅ Review submission restricted to NFT holders
* ✅ On-chain storage of review data
* ✅ One-time review submission (no resubmission allowed)
* ✅ **Dual-contract** operation (separate addresses, independent configs, no interference)

---

## ⚠️ Contract Expiry Notice

This project operates on the **Neutron testnet (pion-1)**, which is intended for development and testing purposes. Please keep the following in mind:

* 🚨 Deployed smart contracts may become unusable after a certain period.
* 🚨 NFTs minted and reviews submitted on-chain may be lost if the testnet is reset.
* 🚨 Periodic contract redeployment and reconfiguration may be required during development and testing.

### 🔧 Recommendations for Developers and Testers

* Regularly monitor the status of the testnet.
* Promptly redeploy contracts when a testnet reset or maintenance occurs.

> ⚠️ **Disclaimer**
> The issues mentioned above are specific to the testnet environment.
> In a production (mainnet) deployment, data will **not** be lost.

---

## 🚀 How to Launch the Web Application

```sh
docker compose up
```

---

## 🔀 Dual-Contract Setup (Recommended)

We deploy **the same WASM (`cw721_public_mint.wasm`) twice** to run two independent instances:

1. **Admission Ticket Contract** (used by `/mint-nft`)

   * Typical instantiate options:

     * `revealed: true` (so the user-provided `ipfs://CID` is stored as `token_uri`)
     * `max_per_address: 1` (one ticket per address)
     * `max_supply: <venue capacity>`
     * `mint_fee_denom: ""`, `mint_fee_amount: "0"` (free mint)
     * Optional: `transfer_locked: true` before admission starts, then disable.
2. **Observation Record Contract** (used by `/ipfs-upload-mint`)

   * Typical instantiate options:

     * `revealed: false`, `placeholder_uri: "ipfs://.../placeholder.json"`
     * Later switch to `revealed: true` + set `base_uri`
     * Optional fee and `fee_recipient` for cost recovery

Because they are **separate addresses**, **limits/period/lock/fees** do not interfere with each other.

---

# \[JA] NFTベースのレビュー管理Dapps

## 全体の説明

本プロジェクトは、Cosmosエコシステムの **Neutronテストネット（pion-1）** 上で動作する、NFTベースのレビュー投稿および管理システムです。
CosmJSベースのWeb UIから **2つの独立フロー** を同時運用します。

* **入場券NFT** — `/mint-nft`
  すでにアップロード済みの **メタデータCID** を入力してミント。
  **入場券専用コントラクト（別インスタンス）** を利用（`revealed: true` 推奨）。
* **観察記録NFT** — `/ipfs-upload-mint`
  画像をアップロード → バックエンドでメタデータ生成 → **public\_mint**。
  **観察記録用コントラクト（別インスタンス）** を利用（初期は `revealed: false` + `placeholder_uri`、後からReveal）。

NFTホルダーのみが対象NFTにひもづくレビューを投稿可能です。
レビュー情報（スコア、件名、本文など）は、改ざん困難な形でオンチェーンに永続化されます。

### 機能一覧

* ✅ NFTのMint（入場券 / 観察記録の2フローを同時運用）
* ✅ NFT所有者限定のレビュー投稿
* ✅ レビュー情報のオンチェーン保存
* ✅ レビュー投稿後の再投稿禁止（1回限りの投稿）
* ✅ **2インスタンス運用**（アドレス分離・設定が互いに干渉しない）

---

## コントラクトが無効になる話（重要）

**Neutronテストネット（pion-1）** は検証用途のため、以下に注意してください。

* 🚨 デプロイ済コントラクトが一定期間後に使えなくなる可能性
* 🚨 テストネットのリセットで、発行NFTやレビューなどのオンチェーンデータが失われる可能性
* 🚨 開発・検証中は、再デプロイ・再設定が定期的に必要

**開発者・検証者向け推奨事項**

* ネットワーク状態を定期的に確認
* リセットやメンテがあれば速やかに再デプロイ

> ⚠️ **注意**
> 上記はテストネット特有の問題です。メインネットではデータ消失は想定しません。

---

```sh:(webアプリ起動方法)
docker compose up
```

---

# cw721\_public\_mint — README

Neutron (pion-1) で **公開ミント（public\_mint / mint）** を簡単に実装できる、`cw721-base` 内蔵の CW721 ラッパーコントラクトです。
**同じWASMを複数インスタンス化**して、フローごとに独立運用できます（推奨構成：入場券用 + 観察記録用）。

### サポート機能

* 公開ミント（`public_mint` / `mint` 両対応）
* **1アドレス上限**（`max_per_address`）
* **総供給上限**（`max_supply`）
* **転送ロック**（`transfer_locked`：`TransferNft`/`SendNft` を拒否）
* **ミント期間**（`mint_start`/`mint_end`、UNIX秒）
* **Reveal / Provenance**（`placeholder_uri` → `base_uri + token_id`、`provenance_hash` 保存）
* **ミント手数料**（`mint_fee_denom` / `mint_fee_amount`）+ **受取先**（`fee_recipient` 自動送金）
* **2段階 Admin 移譲**（`propose_admin` → `accept_admin`）

> `token_uri` は **Reveal前は placeholder**、**Reveal後は `base_uri + token_id`** が保存されます。
> 入場券用インスタンスで **CIDを直接保存したい場合は `revealed: true` 推奨**。

---

## 1. ファイル構成

```
.
├── Cargo.toml
└── src/
    ├── lib.rs        # 実装本体
    ├── msg.rs        # Instantiate/Execute/Query 定義
    ├── state.rs      # Configやカウンタ
    └── error.rs      # エラー型
```

---

## 2. ビルド（最適化WASM）

Docker（推奨：`cosmwasm/optimizer:0.17.0`）

```bash
docker run --rm -it \
  -v "$(pwd)":/code \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  cosmwasm/optimizer:0.17.0

# 出力先
ls -lh artifacts/
# => artifacts/cw721_public_mint.wasm
```
```bash Cargo.lockがおかしいとき
docker run --rm \
  --entrypoint /bin/sh \
  -v "$PWD":/code -w /code \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/code/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  cosmwasm/optimizer:0.17.0 \
  -c 'set -e; if [ -f Cargo.lock ]; then cargo update -w; else cargo generate-lockfile; fi; /usr/local/bin/optimize.sh /code'
```

---

## 3. デプロイ（Neutron pion-1）

### store

```bash
neutrond tx wasm store artifacts/cw721_public_mint.wasm \
  --from <KEY> --chain-id pion-1 \
  --gas auto --gas-adjustment 1.3 --gas-prices 0.025untrn -y

neutrond tx wasm store artifacts/Participation_Certificate_NFT.wasm \
--from <KEY_NAME> \
--chain-id pion-1 \
--node https://rpc-palvus.pion-1.ntrn.tech:443 \
--gas-prices 0.025untrn --gas auto --gas-adjustment 1.5 \
-y -b block


admin-y@LAPTOP-GQE54E1E:~/tmp/observation/flora_observation$ RPC=https://rpc-palvus.pion-1.ntrn.tech:443
CHAIN_ID=pion-1
KEY=tatatata
KR=os      # ← 環境に合わせて os / file / test のいずれか
admin-y@LAPTOP-GQE54E1E:~/tmp/observation/flora_observation$ TXH=$(neutrond tx wasm store artifacts/flora_observation.wasm \
  --from "$KEY" --keyring-backend "$KR" \
  --chain-id "$CHAIN_ID" --node "$RPC" \
  --gas-prices 0.025untrn --gas auto --gas-adjustment 1.5 \
  -y -b sync -o json | jq -r '.txhash')
echo "store tx: $TXH"
Enter keyring passphrase (attempt 1/3):
gas estimate: 2794182
store tx: 4C8CC3B44732CA85E86E5A5891FB4A88B76D86D46AC477262518775D6B4D6217
# → CODE_ID を控える
```

```bash
admin-y@LAPTOP-GQE54E1E:~/tmp/observation/public_mint$ ADDR="neutron1urqaxdn4qtrc35zqrw84qkqvawx3ga34j3gjflzm0yp59vta4gqq62jjea"
RPC="https://neutron-testnet-rpc.polkachu.com:443"

# code_id を確認
neutrond q wasm contract "$ADDR" --node "$RPC" -o json | jq -r '.contract_info.code_id // .code_id'
13162

TX=950C378FD9697FAF34452AD526DABED6877A32F2F18E2E2763531768B346CB24
CHAIN_ID=pion-1
NODE=https://rpc-palvus.pion-1.ntrn.tech:443

# 収録までポーリング（成功したらJSONを出力）
while :; do
  out=$(neutrond query tx "$TX" --chain-id "$CHAIN_ID" --node "$NODE" -o json 2>/dev/null || true)
  if [ -n "$out" ] && jq -e '.txhash != null' >/dev/null 2>&1 <<<"$out"; then
    code=$(jq -r '.code // 0' <<<"$out")
    if [ "$code" = "0" ]; then
      echo "$out" | jq .
      break
    elif [ "$code" != "0" ]; then
      echo "❌ TX failed (code=$code)"
      echo "$out" | jq -r '.raw_log'
      exit 1
    fi
  fi
  sleep 2
done
```
### instantiate（観察記録用：例）
13,164
```bash
admin-y@LAPTOP-GQE54E1E:~/tmp/observation/public_mint$ ADMIN=$(neutrond keys show tatatata -a)
INIT='{"name":"ParticipationCert","symbol":"PCN","max_supply":null}'

neutrond tx wasm instantiate 13164 "$INIT" \
  --label "cw721-free-mint" \
  --admin "$ADMIN" \
  --from tatatata \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.025untrn \
  --broadcast-mode sync -y -o json \
  --chain-id pion-1 --node https://rpc-palvus.pion-1.ntrn.tech:443
Enter keyring passphrase (attempt 1/3):
Enter keyring passphrase (attempt 1/3):
gas estimate: 304632
{"height":"0","txhash":"08DE5F65EE2BA7950CA8DAF0ED92646DBA0F8FE80635E88C8811577D2E2660E8","codespace":"","code":0,"data":"","raw_log":"","logs":[],"info":"","gas_wanted":"0","gas_used":"0","tx":null,"timestamp":"","events":[]}
```
2) contract_address を抽出（両方のイベント名に対応）
```bash
 CODE_ID=13164  # 先ほどの正しい Code ID
neutrond query wasm list-contracts-by-code "$CODE_ID" --node "$NODE" -o json \
  | jq -r '.contracts[-1]'
neutron1fd28n7fmpeaf0vcpm3xqjlc7htwajef75enj5zg0004peqy5xfrqtgachn
```

3) 最小クエリで動作確認
```
# id=1 を試しに取得（未保存なら null が返る想定）
neutrond query wasm contract-state smart "$ADDR" '{"get":{"id":1}}' \
  --node "$RPC" -o json | jq
```
3) 動作確認（フリーミント → 所有トークン照会）
```bash
WALLET=tatatata

# ミント
neutrond tx wasm execute "neutron1fd28n7fmpeaf0vcpm3xqjlc7htwajef75enj5zg0004peqy5xfrqtgachn" '{"public_mint":{}}' \
  --from "tatatata" \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.025untrn \
  --broadcast-mode sync -y -o json \
  --chain-id "13164" --node "$NODE" \
| jq -r '.txhash' \
| xargs -I{} neutrond query tx {} --chain-id "$CHAIN_ID" --node "$NODE" -o json | jq .code,.raw_log

# 所有トークンを確認
OWNER=$(neutrond keys show "$WALLET" -a)
neutrond query wasm contract-state smart "$CONTRACT_ADDR" \
  "$(jq -nc --arg owner "$OWNER" '{tokens:{owner:$owner,start_after:null,limit:50}}')" \
  --chain-id "$CHAIN_ID" --node "$NODE" -o json | jq
```
### instantiate（入場券用：例）

```bash
neutrond tx wasm instantiate 13164 '{
  "name": "Admission Ticket",
  "symbol": "TICKET",
  "admin": "tatatata",
  "public_mint_enabled": true,
  "mint_fee_denom": "",
  "mint_fee_amount": "0",
  "max_per_address": 1,
  "max_supply": 1000,
  "transfer_locked": false,

  "mint_start": 0,
  "mint_end": 0,
  "base_uri": null,
  "placeholder_uri": null,
  "revealed": true,            // CIDをそのままtoken_uriへ保存したいのでtrue推奨
  "provenance_hash": null,
  "fee_recipient": null
}' --label ticket-nft \
  --from tatatata --chain-id pion-1 \
  --gas auto --gas-adjustment 1.3 --gas-prices 0.025untrn -y
# 返ってきた contract_address → <TICKET_CONTRACT>
```

> フロントでは
> `/ipfs-upload-mint` → `<OBS_CONTRACT>`
> `/mint-nft` → `<TICKET_CONTRACT>`
> をそれぞれ設定（または固定）してください。
"neutron1g2fs6jn6kfvl3exlz9dfewr2ap39cys505y23q7pkczdh06tyu6qr7qqx3"
---

## 4. メッセージ仕様

（変更なし・参考）主な `ExecuteMsg` / `QueryMsg` は下表の通りです。

* `public_mint` / `mint`
* `update_config`（mint期間、上限、ロック、料金、reveal等の更新）
* `propose_admin` / `accept_admin`
* `withdraw`（`fee_recipient` 未設定時は `to` を指定）
* `fix_token_uri`（reveal後に既発行のURIを `base_uri + token_id` に更新）

`config` / `mint_price` / `supply` のカスタムQueryに加え、CW721 標準Queryも利用可能です。

---

## 5. 運用レシピ（抜粋）

### 5.1 観察記録用（placeholder → reveal）

```bash
# 期間やプレースホルダ設定
neutrond tx wasm execute <OBS_CONTRACT> '{
  "update_config": {
    "mint_start": 1732406400,
    "mint_end":   1733011200,
    "placeholder_uri": "ipfs://QmPlaceholder/metadata.json",
    "revealed": false
  }
}' --from <KEY> --chain-id pion-1 -y

# 公開（以後のミントは base_uri + token_id を保存）
neutrond tx wasm execute <OBS_CONTRACT> '{
  "update_config": { "revealed": true, "base_uri": "ipfs://QmBase/metadata" }
}' --from <KEY> --chain-id pion-1 -y

# 既発行分のURI修正
neutrond tx wasm execute <OBS_CONTRACT> '{"fix_token_uri":{"token_id":"nft-001"}}' --from <KEY> -y
```

### 5.2 入場券用（CID直書き・1人1枚）

```bash
# 入場券：上限やロックを調整
neutrond tx wasm execute <TICKET_CONTRACT> '{
  "update_config": { "max_per_address": 1, "max_supply": 1000, "transfer_locked": false }
}' --from <ADMIN> -y
```

---

## 6. フロントエンド連携

* `/ipfs-upload-mint`（観察記録）
  画像 → メタデータ生成（custom backend）→ **public\_mint**。
  コントラクトは `<OBS_CONTRACT>` を使用。
* `/mint-nft`（入場券）
  すでにアップロード済みの **メタデータCID** を入力し、**public\_mint** or **mint** を実行。
  コントラクトは `<TICKET_CONTRACT>` を使用（`revealed: true` 推奨）。

> 両ページで**別アドレス**を使うため、**設定・上限・期間・ロックが互いに干渉しません**。

---

## 7. セキュリティと運用注意

* Admin鍵の保護（`update_config`/`propose_admin`/`withdraw` は強権限）
* 期間判定は `env.block.time.seconds()` 基準（UTC）
* 上限やカウンタの二重実行に注意（UIでもミントボタンの再押下防止を推奨）
* `provenance_hash` を事前に公開して改ざん疑義を回避
* 転送ロックの運用（入場前ON → 当日OFF 等）

---

## 8. 互換性

* CosmWasm 1.5 系 / `cw721-base = 0.18.x`
* Optimizer: `cosmwasm/optimizer:0.17.0`（Cargo 1.86）

---

## 9. テスト（任意）

`cw-multi-test` による単体テストを推奨（期間・上限・ロック・reveal・手数料 etc.）。

---

## 10. ライセンス

Apache-2.0（例）

---

## 11. 変更履歴（サマリ）

* v0.1.0

  * 公開ミント / 1アドレス上限 / 総供給上限 / 転送ロック
  * 期間設定（`mint_start` / `mint_end`）
  * Reveal / Provenance（`placeholder_uri` / `base_uri` / `provenance_hash` / `fix_token_uri`）
  * 手数料の自動送金先（`fee_recipient`）
  * 2段階 Admin 移譲（`propose_admin` / `accept_admin`）
  * **Dual-Contract運用（入場券用 & 観察記録用の2インスタンス）** ← 追加

---

了解！Readme.md にそのまま貼れる形で、**WASM を store → instantiate して “contract address を確実に取り出す” 手順**を追記します。
（すでに載っている内容はそのままにし、**追加章**として差し込んでください）

---

## 📦 Deploy & Get Contract Address（Store → Instantiate → Address取得）

同じ WASM (`cw721_public_mint.wasm`) を **複数インスタンス**起動して同時運用します。
以下は **観察記録用 / 入場券用** を連続でデプロイする最短手順です。

> 事前: `artifacts/cw721_public_mint.wasm` があること（optimizerでビルド済み）

### 0) 共通環境変数

```bash
# 必要に応じて自分の値に置き換えてください
CHAIN_ID=pion-1
KEY=<あなたのキー名>           # neutrond keys に存在するキー
ADMIN=<あなたのアドレス>        # 例: neutron1...
WASM=artifacts/cw721_public_mint.wasm

GAS_P=0.025untrn
ADJ=1.3
```

---

### 1) Store（WASM をアップロード）→ CODE\_ID を取得

```bash
# Store 実行（JSON出力にして txhash と raw log を取りやすく）
STORE_JSON=$(neutrond tx wasm store "$WASM" \
  --from "$KEY" --chain-id "$CHAIN_ID" \
  --gas auto --gas-adjustment $ADJ --gas-prices $GAS_P \
  -y -o json)

# txhash の確認（任意）
echo "$STORE_JSON" | jq -r '.txhash'

# CODE_ID を取り出す（logs から抽出）
CODE_ID=$(echo "$STORE_JSON" | jq -r '
  .logs[0].events[] 
  | select(.type=="store_code") 
  | .attributes[] 
  | select(.key=="code_id") 
  | .value
')
echo "CODE_ID=$CODE_ID"
```

> もし `jq` が無い場合は、`neutrond query tx <txhash> -o json | jq ...` でも抽出できます。
> 別法: `neutrond query wasm list-code` で最新 code の一覧から確認。

---

### 2) Instantiate（観察記録用 / 入場券用 を**別々に**起動）→ Contract Address を取得

#### a) 観察記録用（/ipfs-upload-mint）

```bash
OBS_JSON=$(neutrond tx wasm instantiate "$CODE_ID" '{
  "name": "Observation NFT",
  "symbol": "OBS",
  "admin": "'"$ADMIN"'",
  "public_mint_enabled": true,
  "mint_fee_denom": "",
  "mint_fee_amount": "0",
  "max_per_address": 1,
  "max_supply": 0,
  "transfer_locked": false,

  "mint_start": 0,
  "mint_end": 0,
  "base_uri": null,
  "placeholder_uri": "ipfs://QmPlaceholder/metadata.json",
  "revealed": false,
  "provenance_hash": null,
  "fee_recipient": null
}' --label obs-nft \
  --from "$KEY" --chain-id "$CHAIN_ID" \
  --gas auto --gas-adjustment $ADJ --gas-prices $GAS_P \
  -y -o json)

# 観察記録用のコントラクトアドレス抽出
OBS_CONTRACT=$(echo "$OBS_JSON" | jq -r '
  .logs[0].events[] 
  | select(.type=="instantiate") 
  | .attributes[] 
  | select(.key=="_contract_address") 
  | .value
')
echo "OBS_CONTRACT=$OBS_CONTRACT"
```

#### b) 入場券用（/mint-nft）※ CID をそのまま `token_uri` に保存したいので `revealed: true` 推奨

```bash
TICKET_JSON=$(neutrond tx wasm instantiate "$CODE_ID" '{
  "name": "Admission Ticket",
  "symbol": "TICKET",
  "admin": "'"$ADMIN"'",
  "public_mint_enabled": true,
  "mint_fee_denom": "",
  "mint_fee_amount": "0",
  "max_per_address": 1,
  "max_supply": 1000,
  "transfer_locked": false,

  "mint_start": 0,
  "mint_end": 0,
  "base_uri": null,
  "placeholder_uri": null,
  "revealed": true,
  "provenance_hash": null,
  "fee_recipient": null
}' --label ticket-nft \
  --from "$KEY" --chain-id "$CHAIN_ID" \
  --gas auto --gas-adjustment $ADJ --gas-prices $GAS_P \
  -y -o json)

# 入場券用のコントラクトアドレス抽出
TICKET_CONTRACT=$(echo "$TICKET_JSON" | jq -r '
  .logs[0].events[] 
  | select(.type=="instantiate") 
  | .attributes[] 
  | select(.key=="_contract_address") 
  | .value
')
echo "TICKET_CONTRACT=$TICKET_CONTRACT"
```

> 代替手段：`neutrond query wasm list-contract-by-code $CODE_ID -o json | jq -r '.contracts[]'`
> 直近で instantiate したアドレスを一覧から拾えます。

---

### 3) 状態確認（任意）

```bash
# 観察記録用
neutrond q wasm contract-state smart "$OBS_CONTRACT" '{"config":{}}' -o json | jq
neutrond q wasm contract-state smart "$OBS_CONTRACT" '{"supply":{}}' -o json | jq

# 入場券用
neutrond q wasm contract-state smart "$TICKET_CONTRACT" '{"config":{}}' -o json | jq
neutrond q wasm contract-state smart "$TICKET_CONTRACT" '{"mint_price":{}}' -o json | jq
```

---

### 4) フロントへの設定

* `/ipfs-upload-mint` ページ → `OBS_CONTRACT` を設定
* `/mint-nft` ページ → `TICKET_CONTRACT` を設定（CID入力でミント）

> **同時運用OK**：アドレスが別なので、**設定・上限・期間・ロック・料金**が互いに干渉しません。

---

### 5) トラブルシュート（よくある落とし穴）

* `code_id` が取れない → `-o json` の出力から `jq` 抽出式を確認。`store_code` イベントがあるログ（`logs[0]`想定）を正しく参照してください。
* `contract_address` が取れない → `instantiate` イベントの `_contract_address` 属性を抽出しているか確認。
* 手数料不足 → `--gas-prices` と `--gas-adjustment` を見直す（例: `0.025untrn`, `1.3`）。
* 署名キー誤り → `KEY` と `ADMIN` の紐づけ（keyring内のKEYが `ADMIN` のアドレスを持っているか）を確認。

---

これで、**store → instantiate → address取得**までをワンストップで再現できます。必要なら上記コマンドを **一つの `deploy_dual.sh`** にまとめた版も用意します！
