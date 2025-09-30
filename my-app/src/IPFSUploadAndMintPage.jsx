import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { GasPrice } from "@cosmjs/stargate";

/**
 * 更新点（2025-09-29）
 * - 画像 / メタデータのアップロードを Azure Functions のエンドポイント
 *     https://fukaya-lab.azurewebsites.net/api/ipfs/upload
 *   に統一。Payload は { Name, ContentType, Data(base64) }。
 * - 旧 FormData 方式を撤去。Pinata 関連もなし。
 * - 応答の CID 抽出は複数フィールド（cid/hash/IpfsHash/path 等）に対応。
 */

/** ← .env を使わず、ここでハードコード定義（指定どおり保持。ただし Pinata は撤去） */
const ENV = {
  VITE_CHAIN_ID: "pion-1",
  VITE_CHAIN_NAME: "Neutron Testnet (pion-1)",
  VITE_RPC: "https://rpc-palvus.pion-1.ntrn.tech",
  VITE_REST: "https://rest-palvus.pion-1.ntrn.tech",
  VITE_DENOM: "untrn",
  VITE_DENOM_DECIMALS: 6,
  VITE_DISPLAY_DENOM: "NTRN",
  VITE_BECH32_PREFIX: "neutron",

  VITE_GAS_PRICE: 0.025,

  VITE_CW721_CONTRACT_ADDR: "/XXX/",

  VITE_MINT_FEE_AMOUNT: 0,
  VITE_MINT_FEE_DENOM: "",

  VITE_MINT_MSG_KIND: "public_mint", // or "mint"

  VITE_IPFS_PUBLIC_GATEWAY: "https://ipfs.io/ipfs/",
  VITE_TX_EXPLORER_BASE: "https://neutron.celat.one/pion-1/txs/",

  // 自前バックエンド → Azure Functions のアップローダに差し替え
  // cURL 例：
  // curl -X POST -H "Content-Type: application/json" \
  //   -d '{"Name":"test2.json","ContentType":"application/json","Data":"...base64..."}' \
  //   https://fukaya-lab.azurewebsites.net/api/ipfs/upload
  VITE_CUSTOM_UPLOAD_ENDPOINT: "https://fukaya-lab.azurewebsites.net/api/ipfs/upload",
};

// ↓ 以降はこの ENV から値を参照
const CHAIN_ID = ENV.VITE_CHAIN_ID;
const CHAIN_NAME = ENV.VITE_CHAIN_NAME;
const RPC = ENV.VITE_RPC;
const REST = ENV.VITE_REST;
const DENOM = ENV.VITE_DENOM;
const DECIMALS = Number(ENV.VITE_DENOM_DECIMALS);
const DISPLAY_DENOM = ENV.VITE_DISPLAY_DENOM;
const BECH32_PREFIX = ENV.VITE_BECH32_PREFIX;
const GAS_PRICE_NUM = Number(ENV.VITE_GAS_PRICE);
const CW721_CONTRACT_DEFAULT = ENV.VITE_CW721_CONTRACT_ADDR;

const CUSTOM_UPLOAD_ENDPOINT = ENV.VITE_CUSTOM_UPLOAD_ENDPOINT;

const IPFS_GATEWAY = ENV.VITE_IPFS_PUBLIC_GATEWAY;

const ENV_FEE_AMOUNT = String(ENV.VITE_MINT_FEE_AMOUNT ?? "0");
const ENV_FEE_DENOM = ENV.VITE_MINT_FEE_DENOM || "";

const TX_EXPLORER_BASE = ENV.VITE_TX_EXPLORER_BASE || "";
const MINT_MSG_KIND = ENV.VITE_MINT_MSG_KIND || "public_mint";

// Candidate public endpoints (RPC/REST) for Neutron testnet (pion-1)
const RPC_CANDIDATES = [
  "https://rpc-palvus.pion-1.ntrn.tech",
  "https://neutron-testnet-rpc.polkachu.com:443",
  "https://rpc.pion.remedy.tm.p2p.org",
];
const REST_CANDIDATES = [
  "https://rest-palvus.pion-1.ntrn.tech",
  "https://neutron-testnet-api.polkachu.com",
  "https://api.pion.remedy.tm.p2p.org",
];
async function firstReachable(urls, kind = "rpc") {
  for (const u of urls) {
    try {
      const probe = kind === "rpc" ? `${u}/health` : `${u}/cosmos/base/tendermint/v1beta1/node_info`;
      const r = await fetch(probe, { method: "GET" });
      if (r.ok) return u;
    } catch (e) { /* try next */ }
  }
  throw new Error(`No ${kind.toUpperCase()} endpoint reachable`);
}

function formatExplorerTx(txhash) {
  if (!txhash || !TX_EXPLORER_BASE) return "";
  return `${TX_EXPLORER_BASE}${txhash}`;
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
function nowTokenId() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 8);
  return `nft-${y}${m}${da}-${h}${mi}${s}-${rand}`;
}

/**
 * ===== Azure uploader helpers =====
 */
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
function jsonToBase64(obj) {
  const enc = new TextEncoder();
  const bytes = enc.encode(JSON.stringify(obj));
  return arrayBufferToBase64(bytes.buffer);
}
function extractCidFromResponse(j) {
  if (!j || typeof j !== "object") return "";
  const tryFields = [
    "cid", "CID", "Cid",
    "ipfs", "Ipfs",
    "ipfsHash", "IpfsHash",
    "hash", "Hash",
    "path", "Path",
    "url", "Url",
  ];
  let val = null;
  for (const f of tryFields) {
    if (typeof j[f] === "string" && j[f].length) { val = j[f]; break; }
  }
  if (!val && j.pin && typeof j.pin.cid === "string") val = j.pin.cid;
  if (!val && typeof j.result === "string") val = j.result;
  if (!val) return "";
  // normalize
  const ipfsMatch = val.match(/\/(?:ipfs|IPFS)\/([^/?#]+)/);
  if (ipfsMatch) val = ipfsMatch[1];
  val = val.replace(/^ipfs:\/\//i, "").replace(/^ipfs\//i, "");
  return val;
}

/** Azure Functions 用: 任意バイナリ（ファイル）アップロード */
async function customUploadFile(file, endpoint) {
  const ab = await file.arrayBuffer();
  const base64 = arrayBufferToBase64(ab);
  const payload = {
    Name: file.name || `file-${Date.now()}`,
    ContentType: file.type || "application/octet-stream",
    Data: base64,
  };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Custom upload failed: ${res.status} ${text}`);
  let j = {};
  try { j = JSON.parse(text); } catch { /* non-JSON */ }
  const cid = extractCidFromResponse(j) || extractCidFromResponse({ path: text });
  if (!cid) throw new Error(`Custom upload response does not contain CID. Raw: ${text.slice(0, 400)}`);
  return cid;
}

/** Azure Functions 用: JSON メタデータアップロード */
async function customUploadJSON(jsonObj, endpoint, nameHint = "metadata.json") {
  const base64 = jsonToBase64(jsonObj);
  const payload = {
    Name: nameHint.endsWith('.json') ? nameHint : `${nameHint}.json`,
    ContentType: "application/json",
    Data: base64,
  };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Custom JSON upload failed: ${res.status} ${text}`);
  let j = {};
  try { j = JSON.parse(text); } catch { /* non-JSON */ }
  const cid = extractCidFromResponse(j) || extractCidFromResponse({ path: text });
  if (!cid) throw new Error(`Custom JSON upload response does not contain CID. Raw: ${text.slice(0, 400)}`);
  return cid;
}

/** ここからUI */
function MintNFTPage() {
  const navigate = useNavigate();

  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [attributes, setAttributes] = useState([{ trait_type: "", value: "" }]);

  const [tokenId, setTokenId] = useState(nowTokenId());
  const [owner, setOwner] = useState(""); // Keplr接続後
  const [contractAddr, setContractAddr] = useState(CW721_CONTRACT_DEFAULT);

  const [cidImage, setCidImage] = useState("");
  const [cidMetadata, setCidMetadata] = useState("");

  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [minting, setMinting] = useState(false);

  const [txHash, setTxHash] = useState("");
  const [message, setMessage] = useState("");

  // 追加：コントラクト状態
  const [cfg, setCfg] = useState(null);       // { public_mint_enabled, mint_start, mint_end, revealed, ... }
  const [price, setPrice] = useState(null);   // { denom, amount }
  const [supply, setSupply] = useState(null); // { total_minted, max_supply }
  const [isAdminView, setIsAdminView] = useState(false);
  const [fixTokenId, setFixTokenId] = useState("");

  const clientRef = useRef(null);

  // レイアウト
  const [clientWidth, setClientWidth] = useState(100);
  const [itemWidth, setItemWidth] = useState(400);
  useEffect(() => {
    const resize = () => {
      const client = document.documentElement.clientWidth - 16;
      const columns = Math.max(1, Math.ceil(client / 400));
      setClientWidth(client);
      setItemWidth(client / columns - 16);
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // Keplr接続
  const connectKeplr = async () => {
    try {
      setConnecting(true);
      setMessage("");

      // Probe RPC/REST candidates for pion-1
      const rpcUrl = await firstReachable(RPC_CANDIDATES, "rpc");
      const restUrl = await firstReachable(REST_CANDIDATES, "rest");

      if (!window.keplr) {
        throw new Error("Keplrが見つかりません。ブラウザ拡張をインストールしてください。");
      }
      if (window.keplr.experimentalSuggestChain && CHAIN_ID) {
        await window.keplr.experimentalSuggestChain({
          chainId: CHAIN_ID,
          chainName: CHAIN_NAME,
          rpc: rpcUrl,
          rest: restUrl,
          bip44: { coinType: 118 },
          bech32Config: {
            bech32PrefixAccAddr: BECH32_PREFIX,
            bech32PrefixAccPub: `${BECH32_PREFIX}pub`,
            bech32PrefixValAddr: `${BECH32_PREFIX}valoper`,
            bech32PrefixValPub: `${BECH32_PREFIX}valoperpub`,
            bech32PrefixConsAddr: `${BECH32_PREFIX}valcons`,
            bech32PrefixConsPub: `${BECH32_PREFIX}valconspub`,
          },
          currencies: [{ coinDenom: DISPLAY_DENOM, coinMinimalDenom: DENOM, coinDecimals: DECIMALS }],
          feeCurrencies: [{
            coinDenom: DISPLAY_DENOM,
            coinMinimalDenom: DENOM,
            coinDecimals: DECIMALS,
            gasPriceStep: { low: 0.01, average: GAS_PRICE_NUM, high: 0.04 },
          }],
          stakeCurrency: { coinDenom: DISPLAY_DENOM, coinMinimalDenom: DENOM, coinDecimals: DECIMALS },
          features: ["cosmwasm"],
        });
      }

      await window.keplr.enable(CHAIN_ID);
      const offlineSigner = await window.keplr.getOfflineSignerAuto(CHAIN_ID);
      const [{ address }] = await offlineSigner.getAccounts();

      const gasPrice = GasPrice.fromString(`${GAS_PRICE_NUM}${DENOM}`);
      const client = await SigningCosmWasmClient.connectWithSigner(rpcUrl, offlineSigner, {
        gasPrice,
        prefix: BECH32_PREFIX,
      });

      clientRef.current = client;
      setOwner(address);
      setConnected(true);
      setMessage(`Keplrに接続しました（RPC: ${rpcUrl}）`);

      // 接続直後に状態取得
      if (contractAddr && contractAddr !== "/XXX/") {
        await refreshContractState(client, contractAddr);
      }
    } catch (err) {
      console.error(err);
      setMessage(err.message || String(err));
    } finally {
      setConnecting(false);
    }
  };

  // 状態取得
  const refreshContractState = async (client, addr) => {
    try {
      const cfgResp = await client.queryContractSmart(addr, { config: {} });
      const priceResp = await client.queryContractSmart(addr, { mint_price: {} });
      const supplyResp = await client.queryContractSmart(addr, { supply: {} });
      setCfg(cfgResp);
      setPrice(priceResp);
      setSupply(supplyResp);
    } catch (e) {
      console.warn("query failed:", e?.message || e);
    }
  };

  // ファイル選択
  const onSelectFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    const url = await fileToDataUrl(f);
    setPreview(url);
    setName(f.name.replace(/\.[^/.]+$/, ""));
  };

  // Attributes 操作
  const addAttribute = () => setAttributes((prev) => [...prev, { trait_type: "", value: "" }]);
  const removeAttribute = (idx) => setAttributes((prev) => prev.filter((_, i) => i !== idx));
  const updateAttribute = (idx, key, val) =>
    setAttributes((prev) => prev.map((a, i) => (i === idx ? { ...a, [key]: val } : a)));

  // 画像→メタデータの順でIPFSへ（Azure Functions 専用）
  const handleUploadToIPFS = async () => {
    try {
      setUploading(true);
      setMessage("");
      setCidImage("");
      setCidMetadata("");

      if (!file) throw new Error("画像ファイルを選択してください。");
      if (!CUSTOM_UPLOAD_ENDPOINT) {
        throw new Error("カスタムアップロードエンドポイントが未設定です（ENV.VITE_CUSTOM_UPLOAD_ENDPOINT）。");
      }

      // 1) 画像 → CID（Azure: base64）
      const imageCid = await customUploadFile(file, CUSTOM_UPLOAD_ENDPOINT);
      setCidImage(imageCid);

      // 2) メタデータ生成 → CID（Azure: base64）
      const filteredAttributes = attributes
        .filter((a) => a.trait_type || a.value)
        .map((a) => ({ trait_type: a.trait_type || "", value: a.value || "" }));

      const metadata = {
        name: name || tokenId,
        description: description || "",
        image: `ipfs://${imageCid}`,
        attributes: filteredAttributes,
      };

      const jsonName = (name || tokenId) + ".json";
      const metadataCid = await customUploadJSON(metadata, CUSTOM_UPLOAD_ENDPOINT, jsonName);
      setCidMetadata(metadataCid);

      setMessage("IPFSアップロードが完了しました。続けてNFTをミントできます。");
    } catch (err) {
      console.error(err);
      setMessage(err.message || String(err));
    } finally {
      setUploading(false);
    }
  };

  // ミント
  const handleMint = async () => {
    try {
      setMinting(true);
      setMessage("");
      setTxHash("");

      if (!clientRef.current) throw new Error("Keplrに接続してください。");
      if (!contractAddr || contractAddr === "/XXX/") throw new Error("CW721コントラクトアドレスを入力してください。");
      if (!owner) throw new Error("オーナーアドレス(Owner)が空です。");
      if (!cidMetadata) throw new Error("先にIPFSへアップロードしてメタデータCIDを取得してください。");

      const client = clientRef.current;

      // Reveal前はコントラクト側で placeholder_uri が採用されます。
      const execMsg =
        MINT_MSG_KIND === "public_mint"
          ? { public_mint: { token_id: tokenId, owner, token_uri: `ipfs://${cidMetadata}` } }
          : { mint: { token_id: tokenId, owner, token_uri: `ipfs://${cidMetadata}` } };

      // 手数料：コントラクトの mint_price を優先。未取得時のみ ENV フォールバック。
      let funds;
      const denom = price?.denom || ENV_FEE_DENOM;
      const amount = price?.amount || ENV_FEE_AMOUNT;
      if (denom && String(amount) !== "0") {
        funds = [{ amount: String(amount), denom: String(denom) }];
      }

      const result = await client.execute(owner, contractAddr, execMsg, "auto", `mint ${tokenId}`, funds);
      const txhash = result?.transactionHash || result?.hash || "";
      setTxHash(txhash);
      setMessage("NFTミントが完了しました。");

      // 供給情報更新
      await refreshContractState(client, contractAddr);
    } catch (err) {
      console.error(err);
      const t = String(err?.message || err);
      if (t.includes("MintNotOpen")) setMessage("ミント期間外です（MintNotOpen）");
      else if (t.includes("PublicMintDisabled")) setMessage("現在ミントは停止中です（PublicMintDisabled）");
      else if (t.includes("PerAddressLimitReached")) setMessage("このアドレスのミント上限に達しています（PerAddressLimitReached）");
      else if (t.includes("MaxSupplyReached")) setMessage("供給上限に達しています（MaxSupplyReached）");
      else if (t.includes("Insufficient mint fee") || t.includes("InsufficientMintFee")) setMessage("手数料が不足しています（InsufficientMintFee）");
      else if (t.includes("TransferLocked")) setMessage("転送ロック中の操作は拒否されました（TransferLocked）");
      else setMessage(t);
    } finally {
      setMinting(false);
    }
  };

  // 任意：管理者向け fix_token_uri
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const handleFixTokenUri = async () => {
    try {
      if (!clientRef.current) throw new Error("Keplrに接続してください。");
      if (!contractAddr || contractAddr === "/XXX/") throw new Error("CW721コントラクトアドレスを入力してください。");
      if (!fixTokenId) throw new Error("token_id を入力してください。");
      const client = clientRef.current;
      const res = await client.execute(owner, contractAddr, { fix_token_uri: { token_id: fixTokenId } }, "auto", "fix token uri");
      setTxHash(res?.transactionHash || res?.hash || "");
      setMessage("fix_token_uri を実行しました。");
    } catch (e) {
      setMessage(e?.message || String(e));
    }
  };

  const explorerLink = useMemo(() => (txHash ? formatExplorerTx(txHash) : ""), [txHash]);

  // ミント期間の見やすい表示
  const periodLabel = useMemo(() => {
    if (!cfg) return "-";
    const s = Number(cfg.mint_start || 0);
    const e = Number(cfg.mint_end || 0);
    const fmt = (x) => (x ? new Date(x * 1000).toISOString().slice(0, 19).replace("T", " ") + "Z" : "無制限");
    return `${fmt(s)} 〜 ${fmt(e)}`;
  }, [cfg]);

  return (
    <div className="div_base">
      <div className="div_header">IPFSアップロード & NFTミント（Neutron Testnet）</div>

      <div className="div_content">
        <div style={{ width: clientWidth, margin: "8px auto" }}>
          {/* ウォレット接続 */}
          <div style={{ margin: "8px 0", padding: "12px", border: "1px solid #ddd", borderRadius: "8px" }}>
            <div style={{ fontWeight: 600, marginBottom: "6px" }}>ウォレット接続</div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
              <button type="button" disabled={connecting} onClick={connectKeplr}>
                {connected ? "再接続" : "Keplrに接続"}
              </button>
              <div style={{ fontSize: "12px", color: "#666" }}>
                Chain: <b>{CHAIN_NAME}</b> ({CHAIN_ID})
              </div>
            </div>
            <div style={{ marginTop: "6px", fontSize: "13px" }}>
              Owner（受取アドレス）:
              <input style={{ width: "100%" }} placeholder="あなたのアドレス" value={owner} onChange={(e) => setOwner(e.target.value)} />
            </div>
            <div style={{ marginTop: "6px", fontSize: "13px" }}>
              CW721コントラクトアドレス:
              <div style={{ display: "flex", gap: 8 }}>
                <input style={{ flex: 1 }} placeholder="/XXX/" value={contractAddr} onChange={(e) => setContractAddr(e.target.value)} />
                <button
                  type="button"
                  onClick={async () => {
                    if (clientRef.current && contractAddr && contractAddr !== "/XXX/") {
                      await refreshContractState(clientRef.current, contractAddr);
                      setMessage("コントラクトの状態を更新しました。");
                    }
                  }}
                >
                  状態更新
                </button>
              </div>
            </div>
          </div>

          {/* 現在のコントラクト状態 */}
          <div style={{ margin: "8px 0", padding: "12px", border: "1px solid #eee", borderRadius: "8px", background: "#fafafa" }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>コントラクト状態</div>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              <div>公開ミント: {cfg?.public_mint_enabled ? "有効" : "停止"}</div>
              <div>ミント期間: {periodLabel}</div>
              <div>Reveal状態: {cfg?.revealed ? "公開済み" : "未公開（placeholder適用）"}</div>
              <div>手数料: {price ? `${price.amount} ${price.denom}` : (ENV_FEE_DENOM && ENV_FEE_AMOUNT !== "0" ? `${ENV_FEE_AMOUNT} ${ENV_FEE_DENOM}（ENV）` : "無料")}</div>
              <div>供給: {supply ? `${supply.total_minted}${supply.max_supply ? ` / ${supply.max_supply}` : ""}` : "-"}</div>
              <div>転送ロック: {cfg?.transfer_locked ? "ON" : "OFF"}</div>
              {cfg?.base_uri && <div>base_uri: {cfg.base_uri}</div>}
              {cfg?.placeholder_uri && <div>placeholder_uri: {cfg.placeholder_uri}</div>}
              {cfg?.fee_recipient && <div>fee_recipient: {cfg.fee_recipient}</div>}
            </div>
          </div>

          {/* 画像選択 */}
          <div style={{ margin: "8px 0", padding: "12px", border: "1px solid #ddd", borderRadius: "8px" }}>
            <div style={{ fontWeight: 600, marginBottom: "6px" }}>1) 画像ファイル</div>
            <input type="file" accept="image/*" onChange={onSelectFile} />
            {preview && (
              <div style={{ marginTop: "8px" }}>
                <img src={preview} alt="preview" style={{ objectFit: "cover", width: itemWidth, height: itemWidth, borderRadius: "4px" }} />
              </div>
            )}
          </div>

          {/* メタデータ */}
          <div style={{ margin: "8px 0", padding: "12px", border: "1px solid #ddd", borderRadius: "8px" }}>
            <div style={{ fontWeight: 600, marginBottom: "6px" }}>2) メタデータ</div>
            <div style={{ display: "grid", gap: "6px" }}>
              <div>
                トークンID:
                <div style={{ display: "flex", gap: "8px" }}>
                  <input style={{ flex: 1 }} value={tokenId} onChange={(e) => setTokenId(e.target.value)} />
                  <button type="button" onClick={() => setTokenId(nowTokenId())}>再生成</button>
                </div>
              </div>
              <div>
                名前（name）:
                <input style={{ width: "100%" }} placeholder="My NFT Name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                説明（description）:
                <textarea style={{ width: "100%" }} rows={3} placeholder="説明…" value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div style={{ marginTop: "8px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontWeight: 600 }}>Attributes</div>
                  <button type="button" onClick={addAttribute}>行を追加</button>
                </div>
                {attributes.map((a, idx) => (
                  <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "8px", marginTop: "6px" }}>
                    <input placeholder="trait_type (例: rarity)" value={a.trait_type} onChange={(e) => updateAttribute(idx, "trait_type", e.target.value)} />
                    <input placeholder="value (例: rare)" value={a.value} onChange={(e) => updateAttribute(idx, "value", e.target.value)} />
                    <button type="button" onClick={() => removeAttribute(idx)}>削除</button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* アップロード＆ミント */}
          <div style={{ margin: "8px 0", padding: "12px", border: "1px solid #ddd", borderRadius: "8px" }}>
            <div style={{ fontWeight: 600, marginBottom: "6px" }}>3) アップロード＆ミント</div>

            <div style={{ display: "grid", gap: "8px" }}>
              <button type="button" onClick={handleUploadToIPFS} disabled={uploading || !file}>
                {uploading ? "アップロード中…" : "IPFSへアップロード（画像→メタデータ）"}
              </button>

              <div style={{ fontSize: "13px" }}>
                画像CID: {cidImage ? <a href={`${IPFS_GATEWAY}${cidImage}`} target="_blank" rel="noreferrer">{cidImage}</a> : "-"}
              </div>
              <div style={{ fontSize: "13px" }}>
                メタデータCID: {cidMetadata ? <a href={`${IPFS_GATEWAY}${cidMetadata}`} target="_blank" rel="noreferrer">{cidMetadata}</a> : "-"}
              </div>

              <button type="button" onClick={handleMint} disabled={minting || !cidMetadata || !connected}>
                {minting ? "ミント中…" : "NFTをミント"}
              </button>

              <div style={{ fontSize: "13px" }}>
                TxHash: {txHash ? (explorerLink ? <a href={explorerLink} target="_blank" rel="noreferrer">{txHash}</a> : txHash) : "-"}
              </div>

              <div style={{ fontSize: 12, color: "#777" }}>
                {cfg?.revealed
                  ? "※ Reveal済み：保存される token_uri は base_uri + token_id になります。"
                  : "※ 未Reveal：保存される token_uri は placeholder_uri になります（ここで指定したCIDは表示に使われません）。"}
              </div>
            </div>
          </div>

          {/* 管理者向け（任意） */}
          <div style={{ margin: "8px 0" }}>
            <button type="button" onClick={() => setAdminPanelOpen((v) => !v)}>{adminPanelOpen ? "▲ 管理者パネルを閉じる" : "▼ 管理者パネルを開く"}</button>
            {adminPanelOpen && (
              <div style={{ marginTop: 8, padding: 12, border: "1px dashed #bbb", borderRadius: 8 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>管理者向けユーティリティ</div>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 13, color: "#555" }}>
                    Reveal 後に既発行トークンのURIを <code>base_uri + token_id</code> に更新します。
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input style={{ flex: 1 }} placeholder="token_id" value={fixTokenId} onChange={(e) => setFixTokenId(e.target.value)} />
                    <button type="button" onClick={handleFixTokenUri}>fix_token_uri 実行</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {message && (
            <div style={{ marginTop: "8px", padding: "10px", background: "#f3f7ea", border: "1px solid #ABCE1C", borderRadius: "6px" }}>
              {message}
            </div>
          )}
        </div>
      </div>

      {/* フッター（既存UIに合わせて） */}
      <div style={{ height: "2px", backgroundColor: "#ABCE1C" }}></div>
      <div style={{ height: "60px", display: "flex" }}>
        <div className="div_footer" role="button" onClick={() => navigate('/qr-reader')}>
          <i className="material-icons">qr_code_scanner</i>
        </div>
        <div style={{ width: "2px", backgroundColor: "#ABCE1C", margin: "10px 0px" }}></div>
        <div className="div_footer" role="button" onClick={() => navigate('/ipfs-upload-mint')}>
          <i className="material-icons">upload_file</i>
        </div>
        <div style={{ width: "2px", backgroundColor: "#ABCE1C", margin: "10px 0px" }}></div>
        <div className="div_footer" role="button" onClick={() => navigate('/ipfs-list')}>
          <i className="material-icons">collections</i>
        </div>
      </div>
    </div>
  );
}

export default MintNFTPage;
