// src/MintNFTPage.jsx
import { useMemo, useRef, useState, useEffect } from "react";
import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { GasPrice } from "@cosmjs/stargate";

/** 必要最小の環境設定 */
const ENV = {
  VITE_CHAIN_ID: "pion-1",
  VITE_CHAIN_NAME: "Neutron Testnet (pion-1)",
  VITE_RPC: "https://rpc-palvus.pion-1.ntrn.tech",
  VITE_DENOM: "untrn",
  VITE_DENOM_DECIMALS: 6,
  VITE_BECH32_PREFIX: "neutron",
  VITE_GAS_PRICE: 0.025,
  VITE_CW721_CONTRACT_ADDR:
    "neutron1fd28n7fmpeaf0vcpm3xqjlc7htwajef75enj5zg0004peqy5xfrqtgachn",
};

const CHAIN_ID = ENV.VITE_CHAIN_ID;
const DENOM = ENV.VITE_DENOM;
const GAS_PRICE_NUM = Number(ENV.VITE_GAS_PRICE);
const BECH32_PREFIX = ENV.VITE_BECH32_PREFIX;
const DEFAULT_CONTRACT = ENV.VITE_CW721_CONTRACT_ADDR;

/** 固定メタデータ（参照用・cw721フォールバック時の token_uri に使用） */
const FIXED_METADATA_URI_HTTP =
  "https://ipfs.yamada.jo.sus.ac.jp/ipfs/QmTGDRGPFtX5QZhiwk2gUBzs9CaBmrFEMEuKn29G7saBfx";

/** RPC 候補（最初に応答したURLを使用） */
const RPC_CANDIDATES = [
  ENV.VITE_RPC,
  "https://neutron-testnet-rpc.polkachu.com:443",
  "https://rpc-palvus.pion-1.ntrn.tech:443",
];

async function firstReachable(urls) {
  for (const u of urls) {
    try {
      const r = await fetch(`${u}/health`, { method: "GET" });
      if (r.ok) return u;
    } catch {}
  }
  throw new Error("到達可能なRPCが見つかりませんでした");
}

/** token_id（cw721フォールバック用） */
function nowTokenId() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 6);
  return `ticket-${y}${m}${da}-${h}${mi}${s}-${rand}`;
}

/** ipfs:// → 表示用 http(s) へ変換（ipfs.io） */
function tokenUriToFetchUrl(uri) {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) {
    const path = uri.replace(/^ipfs:\/\//i, "");
    return `https://ipfs.io/ipfs/${path}`;
  }
  return uri;
}

export default function MintNFTPage() {
  // 共通状態
  const [message, setMessage] = useState("");
  const [contractAddr, setContractAddr] = useState(DEFAULT_CONTRACT);

  // 固定メタデータ（末尾セクション）
  const [fixedMd, setFixedMd] = useState(null);
  const [fixedMdLoading, setFixedMdLoading] = useState(false);
  const [fixedMdError, setFixedMdError] = useState("");

  // ウォレットモード: 'keplr' | 'testwallet'
  const [walletMode, setWalletMode] = useState("keplr"); // 既定はKeplr

  // Keplr用
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [owner, setOwner] = useState(""); // Keplr接続時に自動取得
  const [minting, setMinting] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [price, setPrice] = useState(null); // { denom, amount }
  const [cfg, setCfg] = useState(null);
  const clientRef = useRef(null);
  const [rpcInUse, setRpcInUse] = useState("");

  // TestWallet用（CLI生成）
  const [twOwner, setTwOwner] = useState(""); // 例: neutron1...
  const [twKeyName, setTwKeyName] = useState("testwallet");
  const [twNode, setTwNode] = useState(ENV.VITE_RPC);
  const [twTokenId, setTwTokenId] = useState(nowTokenId()); // cw721用

  // 固定メタデータ取得
  useEffect(() => {
    let abort = false;
    (async () => {
      try {
        setFixedMdLoading(true);
        setFixedMdError("");
        const r = await fetch(FIXED_METADATA_URI_HTTP, { method: "GET" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!abort) setFixedMd(j);
      } catch (e) {
        if (!abort) {
          setFixedMd(null);
          setFixedMdError(String(e?.message || e));
        }
      } finally {
        if (!abort) setFixedMdLoading(false);
      }
    })();
    return () => {
      abort = true;
    };
  }, []);

  // Keplr接続
  const connectKeplr = async () => {
    try {
      setConnecting(true);
      setMessage("");

      if (!window.keplr) throw new Error("Keplrが見つかりません。拡張機能をインストールしてください。");

      const rpcUrl = await firstReachable(RPC_CANDIDATES);
      await window.keplr.enable(CHAIN_ID);
      const offlineSigner = await window.keplr.getOfflineSignerAuto(CHAIN_ID);
      const [{ address }] = await offlineSigner.getAccounts();

      const client = await SigningCosmWasmClient.connectWithSigner(rpcUrl, offlineSigner, {
        gasPrice: GasPrice.fromString(`${GAS_PRICE_NUM}${DENOM}`),
        prefix: BECH32_PREFIX,
      });

      clientRef.current = client;
      setOwner(address);
      setConnected(true);
      setRpcInUse(rpcUrl);
      setMessage(`Keplrに接続しました（RPC: ${rpcUrl}）`);

      if (contractAddr && contractAddr !== "/XXX/") {
        await refreshState(client, contractAddr);
      }
    } catch (e) {
      console.error(e);
      setMessage(e?.message || String(e));
    } finally {
      setConnecting(false);
    }
  };

  const refreshState = async (client, addr) => {
    try {
      const p = await client.queryContractSmart(addr, { mint_price: {} }).catch(() => null);
      setPrice(p);
      const c = await client.queryContractSmart(addr, { config: {} }).catch(() => null);
      setCfg(c);
    } catch (e) {
      console.warn("query failed", e?.message || e);
    }
  };

  // Keplr実行：public_mint({}) → （スキーマ不一致時のみ）cw721.mint に自動フォールバック
  const handleMintKeplr = async () => {
    try {
      setMinting(true);
      setMessage("");
      setTxHash("");

      if (!clientRef.current) throw new Error("Keplrに接続してください。");
      if (!owner) throw new Error("Owner が未設定です。");
      if (!contractAddr || contractAddr === "/XXX/") throw new Error("コントラクトアドレスが未設定です。");

      let funds = undefined;
      if (price?.denom && String(price?.amount) !== "0") {
        funds = [{ amount: String(price.amount), denom: String(price.denom) }];
      }

      const client = clientRef.current;

      // 1) まず public_mint（引数なし）を試行
      try {
        const msg = { public_mint: {} };
        const res = await client.execute(owner, contractAddr, msg, "auto", "ticket public_mint", funds);
        setTxHash(res?.transactionHash || res?.hash || "");
        setMessage("入場券NFTのミントが完了しました。（public_mint）");
        return;
      } catch (e1) {
        const t1 = String(e1?.message || e1);
        // public_mint が存在しない/不一致なら cw721.mint にフォールバック
        const schemaErr = /unknown variant|no such variant|did not match any variant|found no variant/i.test(t1);
        if (!schemaErr) throw e1;
      }

      // 2) cw721.mint にフォールバック（token_id / token_uri 必須）
      const fallbackTokenId = nowTokenId();
      const cw721Msg = {
        cw721: {
          mint: {
            token_id: fallbackTokenId,
            owner, // Keplrの送信者と同一でOK
            token_uri: FIXED_METADATA_URI_HTTP,
            extension: {},
          },
        },
      };
      const res2 = await client.execute(owner, contractAddr, cw721Msg, "auto", `ticket cw721.mint ${fallbackTokenId}`, funds);
      setTxHash(res2?.transactionHash || res2?.hash || "");
      setMessage("入場券NFTのミントが完了しました。（cw721.mint フォールバック）");
    } catch (e) {
      console.error(e);
      const t = String(e?.message || e);
      if (t.includes("MintNotOpen")) setMessage("ミント期間外です（MintNotOpen）");
      else if (t.includes("PublicMintDisabled")) setMessage("現在ミントは停止中です（PublicMintDisabled）");
      else if (t.includes("PerAddressLimitReached")) setMessage("このアドレスのミント上限に達しています（PerAddressLimitReached）");
      else if (t.includes("MaxSupplyReached")) setMessage("供給上限に達しています（MaxSupplyReached）");
      else if (t.includes("Insufficient mint fee") || t.includes("InsufficientMintFee"))
        setMessage("手数料が不足しています（InsufficientMintFee）");
      else setMessage(t);
    } finally {
      setMinting(false);
    }
  };

  const priceLabel = useMemo(
    () => (price?.denom ? `${price.amount} ${price.denom}` : "無料（0）"),
    [price]
  );

  // Raw JSON のプレビュー（先頭 N 行だけ表示）
  const jsonPreview = (obj, headLines = 14) => {
    try {
      const s = JSON.stringify(obj ?? {}, null, 2);
      const lines = s.split("\n");
      const head = lines.slice(0, headLines).join("\n");
      const tail = lines.slice(headLines).join("\n");
      return { head, tail };
    } catch {
      return { head: "", tail: "" };
    }
  };

  // TestWallet用: neutrond コマンド生成（public_mint {} / cw721.mint）
  const buildTwCmd = (kind) => {
    const base = {
      contract: contractAddr || "<CONTRACT_ADDR>",
      owner: twOwner || "<OWNER_ADDR>",
      node: twNode || ENV.VITE_RPC,
      key: twKeyName || "testwallet",
      token_id: twTokenId,
      token_uri: FIXED_METADATA_URI_HTTP,
    };

    // public_mint は引数なし
    const msg =
      kind === "cw721"
        ? `{"cw721":{"mint":{"token_id":"${base.token_id}","owner":"${base.owner}","token_uri":"${base.token_uri}","extension":{}}}}`
        : `{"public_mint":{}}`;

    // cw721.mint は --from のアドレスと owner を一致させるのが無難です
    return [
      "neutrond tx wasm execute",
      base.contract,
      `'${msg}'`,
      `--from ${base.key}`,
      "--gas auto --gas-prices 0.025untrn --gas-adjustment 1.5",
      `--chain-id ${CHAIN_ID}`,
      `--node ${base.node}`,
      "-y",
    ].join(" ");
  };

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage("コマンドをクリップボードにコピーしました。");
    } catch {
      setMessage("コピーに失敗しました。手動で選択してコピーしてください。");
    }
  };

  // レイアウト
  const PAGE_WRAP = {
    minHeight: "100dvh",
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
    overscrollBehaviorY: "contain",
  };

  const TabBtn = ({ active, onClick, children }) => (
    <button
      onClick={onClick}
      style={{
        padding: "8px 12px",
        borderRadius: 8,
        border: active ? "1px solid #111" : "1px solid #ddd",
        background: active ? "#111" : "#fff",
        color: active ? "#fff" : "#111",
        fontWeight: 600,
      }}
    >
      {children}
    </button>
  );

  return (
    <div style={PAGE_WRAP}>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: 16 }}>
        <h2>入場券NFT — フリーミント</h2>

        {/* ==== モード切替（Keplr / TestWallet） ==== */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <TabBtn active={walletMode === "keplr"} onClick={() => setWalletMode("keplr")}>Keplr で実行</TabBtn>
          <TabBtn active={walletMode === "testwallet"} onClick={() => setWalletMode("testwallet")}>TestWallet（CLI）</TabBtn>
        </div>

        {/* ==== 共通: コントラクト ==== */}
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>コントラクト設定</div>
          <div style={{ marginTop: 8, fontSize: 13 }}>
            コントラクトアドレス:
            <input
              style={{ width: "100%" }}
              value={contractAddr}
              onChange={(e) => setContractAddr(e.target.value)}
              placeholder="/XXX/"
            />
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
            既定は <code>public_mint({})</code> を利用します。非対応の場合は自動で <code>cw721.mint</code> を使用します。
          </div>
        </div>

        {/* ==== Keplr モード ==== */}
        {walletMode === "keplr" && (
          <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>ウォレット & コントラクト（Keplr）</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button disabled={connecting} onClick={connectKeplr}>{connected ? "再接続" : "Keplrに接続"}</button>
              <div style={{ fontSize: 13, color: "#666" }}>
                Chain: {CHAIN_ID}{rpcInUse ? `  RPC: ${rpcInUse}` : ""}
              </div>
            </div>
            <div style={{ marginTop: 8, fontSize: 13 }}>
              Owner (接続後に自動入力可):
              <input
                style={{ width: "100%" }}
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="あなたのアドレス"
              />
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: "#555" }}>
              手数料: {priceLabel}
              {contractAddr && contractAddr !== "/XXX/" && (
                <button
                  style={{ marginLeft: 8 }}
                  onClick={async () => {
                    if (clientRef.current) {
                      await refreshState(clientRef.current, contractAddr);
                      setMessage("コントラクト状態を更新しました。");
                    }
                  }}
                >
                  状態更新
                </button>
              )}
            </div>

            {/* 実行（Keplr） */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
              <button disabled={minting || !connected} onClick={handleMintKeplr}>
                {minting ? "ミント中…" : "フリーミントを実行"}
              </button>
              {txHash && (
              <a
                href={`${EXPLORER_TX_BASE}${encodeURIComponent(txHash)}`}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 12, textDecoration: "underline" }}
                title="Mintscan で確認"
              >
                tx: {txHash}
              </a>
            )}
            </div>
          </div>
        )}

        {/* ==== TestWallet モード（CLIコマンド生成） ==== */}
        {walletMode === "testwallet" && (
          <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>TestWallet（neutrond CLI で実行）</div>
            <div style={{ display: "grid", gap: 8 }}>
              <label style={{ fontSize: 13 }}>
                Owner アドレス（neutron1...）:
                <input style={{ width: "100%" }} value={twOwner} onChange={(e) => setTwOwner(e.target.value)} placeholder="neutron1..." />
              </label>
              <label style={{ fontSize: 13 }}>
                --from のキー名:
                <input style={{ width: "100%" }} value={twKeyName} onChange={(e) => setTwKeyName(e.target.value)} placeholder="testwallet" />
              </label>
              <label style={{ fontSize: 13 }}>
                --node:
                <input style={{ width: "100%" }} value={twNode} onChange={(e) => setTwNode(e.target.value)} placeholder={ENV.VITE_RPC} />
              </label>
              <label style={{ fontSize: 13 }}>
                token_id（cw721.mint用）:
                <div style={{ display: "flex", gap: 8 }}>
                  <input style={{ width: "100%" }} value={twTokenId} onChange={(e) => setTwTokenId(e.target.value)} />
                  <button onClick={() => setTwTokenId(nowTokenId())}>再生成</button>
                </div>
              </label>
            </div>

            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>public_mint（推奨）</div>
              <pre style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 6, padding: 8, whiteSpace: "pre-wrap" }}>
{buildTwCmd("public")}
              </pre>
              <button onClick={() => copy(buildTwCmd("public"))}>コピー</button>
            </div>

            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>cw721.mint（public_mint非対応時）</div>
              <pre style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 6, padding: 8, whiteSpace: "pre-wrap" }}>
{buildTwCmd("cw721")}
              </pre>
              <button onClick={() => copy(buildTwCmd("cw721"))}>コピー</button>
            </div>
          </div>
        )}

        {message && (
          <div style={{ marginTop: 10, padding: 10, border: "1px solid #ABCE1C", background: "#f3f7ea", borderRadius: 6 }}>
            {message}
          </div>
        )}

        {/* ====================== 最後のセクション ====================== */}
        <div id="fixed-metadata-anchor" style={{ marginTop: 20 }} />
        <section style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, marginTop: 20, background: "#fafafa" }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>固定メタデータ（参照用）</div>

          {fixedMdLoading && <div style={{ fontSize: 13 }}>読み込み中…</div>}
          {fixedMdError && <div style={{ fontSize: 13, color: "#b00020" }}>取得エラー: {fixedMdError}</div>}

          {fixedMd && (
            <>
              <div style={{ fontSize: 14, lineHeight: 1.6 }}>
                {"name" in fixedMd && <div><b>name:</b> {String(fixedMd.name)}</div>}
                {"description" in fixedMd && <div><b>description:</b> {String(fixedMd.description)}</div>}
                {"image" in fixedMd && (
                  <div style={{ marginTop: 4 }}>
                    <b>image:</b>{" "}
                    <a href={tokenUriToFetchUrl(String(fixedMd.image))} target="_blank" rel="noreferrer">
                      {String(fixedMd.image)}
                    </a>
                  </div>
                )}
                {"attributes" in fixedMd && Array.isArray(fixedMd.attributes) && (
                  <div style={{ marginTop: 6 }}>
                    <b>attributes:</b>
                    <ul style={{ margin: "6px 0 0 18px" }}>
                      {fixedMd.attributes.map((a, i) => (
                        <li key={i} style={{ fontSize: 13 }}>
                          {a?.trait_type ? <b>{a.trait_type}:</b> : <b>(no trait):</b>} {String(a?.value ?? "")}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* 固定 image プレビュー */}
              <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, marginTop: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>固定 image プレビュー</div>
                {fixedMd?.image ? (
                  <img
                    src={tokenUriToFetchUrl(String(fixedMd.image))}
                    alt="fixed metadata image"
                    style={{ display: "block", maxWidth: "100%", height: "auto", borderRadius: 8 }}
                  />
                ) : (
                  <div style={{ fontSize: 13, color: "#777" }}>固定メタデータの image が未取得です。</div>
                )}
              </div>

              {/* Raw JSON（先頭だけプレビュー + 折りたたみ） */}
              <div style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Raw JSON（プレビュー＋折りたたみ）</div>
                {(() => {
                  const { head, tail } = jsonPreview(fixedMd, 14);
                  return (
                    <div>
                      <pre style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 6, padding: 8, whiteSpace: "pre-wrap" }}>
{head}
                      </pre>
                      {tail && tail.trim() && (
                        <details>
                          <summary style={{ cursor: "pointer" }}>残りを表示</summary>
                          <pre style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 6, padding: 8, whiteSpace: "pre-wrap", marginTop: 8 }}>
{tail}
                          </pre>
                        </details>
                      )}
                    </div>
                  );
                })()}
              </div>
            </>
          )}
        </section>
        {/* ==================== /最後のセクション ==================== */}
      </div>
    </div>
  );
}
