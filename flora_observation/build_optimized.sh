#!/usr/bin/env bash
set -euo pipefail

# ============================================
# CosmWasm workspace-optimizer ビルドスクリプト
#  - 必要: Docker
#  - 出力: ./artifacts/<crate_name>.wasm（最適化済み）
# ============================================

# ---- 設定（必要に応じて変更）----
IMAGE="cosmwasm/workspace-optimizer:0.17.0"   # 0.16.0は広く使われる安定版
ARTIFACTS_DIR="artifacts"                     # 出力先
PLATFORM=""                                   # 例: "linux/amd64" を強制したい時は設定（通常は空でOK）
# PLATFORM="linux/amd64"

# ---- 前提チェック ----
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker が見つかりません。インストールしてから再実行してください。" >&2
  exit 1
fi

# ---- 出力ディレクトリ ----
mkdir -p "$ARTIFACTS_DIR"

echo "🔧 Pulling optimizer image: $IMAGE"
docker pull "$IMAGE" >/dev/null

# ---- キャッシュ用ボリューム名（プロジェクト名ベースで一意化）----
PROJNAME="$(basename "$(pwd)")"
TARGET_VOL="${PROJNAME}_cache"
REGISTRY_VOL="registry_cache"

# ---- 実行ログ ----
echo "🏗  Building with cosmwasm/workspace-optimizer"
echo "    Project:       $PROJNAME"
echo "    Artifacts dir: $ARTIFACTS_DIR"
echo "    Cache volumes: $TARGET_VOL (target), $REGISTRY_VOL (cargo registry)"
[ -n "$PLATFORM" ] && echo "    Platform:      $PLATFORM"

# ---- 実行（最適化ビルド）----
# -v $(pwd):/code でプロジェクトを /code にマウント
# キャッシュはボリュームに保持してビルドを高速化
DOCKER_RUN=(docker run --rm
  -v "$(pwd)":/code
  --mount type=volume,source="$TARGET_VOL",target=/code/target
  --mount type=volume,source="$REGISTRY_VOL",target=/usr/local/cargo/registry
)

# プラットフォーム強制が指定されている場合
if [ -n "$PLATFORM" ]; then
  DOCKER_RUN+=(--platform "$PLATFORM")
fi

# 実行
"${DOCKER_RUN[@]}" "$IMAGE"

# ---- 成果物チェック＆コピー（optimizer は ./artifacts を作ります）----
if [ ! -d "./artifacts" ]; then
  echo "ERROR: optimizer 実行後に ./artifacts が見つかりませんでした。" >&2
  exit 1
fi

# すべての .wasm を対象に、サイズとハッシュを表示
echo "✅ Build artifacts:"
shopt -s nullglob
for f in ./artifacts/*.wasm; do
  SIZE=$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f")
  echo "  - $(basename "$f")  (${SIZE} bytes)"
  # sha256sum (macOS互換)
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$f"
  else
    shasum -a 256 "$f"
  fi
done
shopt -u nullglob

echo "🎉 完了: 最適化済みWASMは ./artifacts/ にあります。"
echo ""
echo "次の例でデプロイできます（Neutron testnet想定）:"
echo 'neutrond tx wasm store artifacts/<your_contract>.wasm --from <WALLET> --gas auto --gas-adjustment 1.4 --gas-prices 0.025untrn -y -b block'
