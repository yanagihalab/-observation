// src/MintNFTPage.jsx
import { useMemo, useRef, useState, useEffect } from "react";
import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { GasPrice } from "@cosmjs/stargate";

/** 必要最小の環境設定（チェーン & 既定ガス & 既定アドレス） */
const ENV = {
  VITE_CHAIN_ID: "pion-1",
  VITE_CHAIN_NAME: "Neutron Testnet (pion-1)",
  // 正しいRPCに修正 + フォールバック候補は下で疎通確認して使用
  VITE_RPC: "https://rpc-palvus.pion-1.ntrn.tech",
  VITE_DENOM: "untrn",
  VITE_DENOM_DECIMALS: 6,
  VITE_BECH32_PREFIX: "neutron",
  VITE_GAS_PRICE: 0.025,
  VITE_CW721_CONTRACT_ADDR: "/XXX/", // デプロイ後に差し替え
};

const CHAIN_ID = ENV.VITE_CHAIN_ID;
const DENOM = ENV.VITE_DENOM;
const GAS_PRICE_NUM = Number(ENV.VITE_GAS_PRICE);
const BECH32_PREFIX = ENV.VITE_BECH32_PREFIX;
const DEFAULT_CONTRACT = ENV.VITE_CW721_CONTRACT_ADDR;

// ===== 固定メタデータ（参照用・固定表示）=====
const FIXED_MD_NAME = "Participation Certificate NFT";
const FIXED_MD_DESC = "10042025深谷研菊地研合同イベント参加証NFT";
const FIXED_MD_IMAGE =
  "https://ipfs.yamada.jo.sus.ac.jp/ipfs/QmTuDCtiZJjRFqiZ6D5X2iNX8ejwNu6Kv1F7EcThej9yHu";

// 既にアップロード済みの metadata.json の URI が分かっているなら下に設定（空でもOK）
const METADATA_URI_FIXED = "";

// Public RPC 候補（最初に応答したURLを使用）
const RPC_CANDIDATES = [
  ENV.VITE_RPC,
  "https://neutron-testnet-rpc.polkachu.com:443",
  "https://rpc.pion.remedy.tm.p2p.org",
];

async function firstReachable(urls) {
  for (const u of urls) {
    try {
      const r = await fetch(`${u}/health`, { method: "GET" });
      if (r.ok) return u;
    } catch (_e) {}
  }
  throw new Error("到達可能なRPCが見つかりませんでした");
}

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

/** http(s) gateway → ipfs:// に変換 */
function httpGatewayToIpfsScheme(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/(?:ipfs|IPFS)\/([^/?#]+)(.*)?/);
    if (m) {
      const cid = m[1];
      const rest = m[2] || "";
      return `ipfs://${cid}${rest}`;
    }
  } catch (e) {}
  return url; // そのまま使う
}

/** ipfs:// → 取得用 http(s) URL へ変換（ipfs.io） */
function tokenUriToFetchUrl(uri) {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) {
    const path = uri.replace(/^ipfs:\/\//i, "");
    return `https://ipfs.io/ipfs/${path}`;
  }
  return uri;
}

/** ざっくりCID/URIチェック（ipfs:// 付き/無しの両方許可、CIDv0/v1想定） */
function normalizeTokenUriFromCid(input) {
  const s = (input || "").trim();
  if (!s) return "";
  if (s.startsWith("ipfs://")) return s;
  if (/^https?:\/\//i.test(s)) return httpGatewayToIpfsScheme(s); // gateway URL → ipfs://
  if (/^[a-zA-Z0-9=_-]{32,}$/.test(s)) return `ipfs://${s}`; // 素のCID
  return "";
}

/** QR文字列の汎用パーサ */
function parseQrContent(text) {
  if (!text) return {};
  const raw = text.trim();

  // 1) JSON 形式の可能性
  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      const obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : {};
    } catch (e) {}
  }

  // 2) URL 形式（nft:?cid=... / https://.../ipfs/<cid> など）
  try {
    const u = new URL(raw);
    const params = u.searchParams;
    const o = {};
    for (const [k, v] of params.entries()) o[k] = v;
    if (u.protocol.startsWith("ipfs")) o.cid = u.href;
    const m = u.pathname.match(/\/(?:ipfs|IPFS)\/([^/?#]+)/);
    if (!o.cid && m) o.cid = `ipfs://${m[1]}`;
    if (params.get("token_uri")) o.token_uri = params.get("token_uri");
    return o;
  } catch {
    // 3) 素の CID / ipfs:// / gateway URL とみなす
    return { cid: raw };
  }
}

/** 読み取ったJSONが NFT メタデータらしいか簡易判定 */
function looksLikeMetadata(obj) {
  if (!obj || typeof obj !== "object") return false;
  if ("name" in obj || "image" in obj || "attributes" in obj) return true;
  return false;
}

export default function MintNFTPage() {
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [owner, setOwner] = useState("");
  const [contractAddr, setContractAddr] = useState(DEFAULT_CONTRACT);
  const [message, setMessage] = useState("");
  const [minting, setMinting] = useState(false);
  const [txHash, setTxHash] = useState("");

  // token_id は QR で上書きされる想定（UI編集は不要）
  const [tokenId, setTokenId] = useState(nowTokenId());

  // token_uri（= metadata.json の場所）
  const [metadataUri, setMetadataUri] = useState(
    METADATA_URI_FIXED ? normalizeTokenUriFromCid(METADATA_URI_FIXED) : ""
  );

  // コントラクト状態
  const [price, setPrice] = useState(null); // { denom, amount }
  const [cfg, setCfg] = useState(null);     // { public_mint_enabled, ... }
  const [preferredKind, setPreferredKind] = useState("public_mint");

  const clientRef = useRef(null);
  const [rpcInUse, setRpcInUse] = useState("");

  // 追加メタデータ（on-chain extension として送る）
  const [extraAttrs, setExtraAttrs] = useState([{ trait_type: "", value: "" }]);
  const [extraNote, setExtraNote] = useState("");

  // 読取メタデータのプレビュー
  const [remoteMd, setRemoteMd] = useState(null);
  const [remoteMdLoading, setRemoteMdLoading] = useState(false);
  const [remoteMdError, setRemoteMdError] = useState("");

  // スクロール有効化（他CSSの overflow: hidden を無効化）
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "auto";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // ========== Keplr 接続 ==========
  const connectKeplr = async () => {
    try {
      setConnecting(true);
      setMessage("");

      if (!window.keplr) throw new Error("Keplrが見つかりません。拡張機能をインストールしてください。");

      const rpcUrl = await firstReachable(RPC_CANDIDATES);
      await window.keplr.enable(CHAIN_ID);
      const offlineSigner = await window.keplr.getOfflineSignerAuto(CHAIN_ID);
      const [{ address }] = await offlineSigner.getAccounts();

      const client = await SigningCosmWasmClient.connectWithSigner(
        rpcUrl, offlineSigner,
        { gasPrice: GasPrice.fromString(`${GAS_PRICE_NUM}${DENOM}`), prefix: BECH32_PREFIX }
      );

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

  // ========== QR スキャン ==========
  const qrFileRef = useRef(null);
  const scannerRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [lastQrText, setLastQrText] = useState("");

  async function startScan() {
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const cams = await Html5Qrcode.getCameras();
      if (!cams || cams.length === 0) throw new Error("カメラが見つかりません。HTTPS または localhost でアクセスしてください。");
      const camId = cams[0].id;

      const qr = new Html5Qrcode("qr-reader");
      scannerRef.current = qr;
      setScanning(true);

      await qr.start(
        camId,
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => {
          onQrDecoded(decodedText);
          stopScan(); // 1回で停止
        },
        (_err) => {}
      );
    } catch (e) {
      setMessage(e?.message || String(e));
    }
  }

  async function stopScan() {
    try {
      const qr = scannerRef.current;
      if (qr) {
        await qr.stop();
        await qr.clear();
        scannerRef.current = null;
      }
    } catch (e) {}
    setScanning(false);
  }

  useEffect(() => () => { stopScan(); }, []);

  async function scanFromFile(file) {
    if (!file) return;
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const qr = new Html5Qrcode("qr-reader-file");
      const text = await qr.scanFile(file, true);
      await qr.clear();
      onQrDecoded(text);
    } catch (e) {
      setMessage(e?.message || String(e));
    }
  }

  function onQrDecoded(text) {
    try {
      setLastQrText(text);

      // ① JSON そのものがmetadataの可能性
      if ((text || "").trim().startsWith("{")) {
        try {
          const obj = JSON.parse(text);
          if (looksLikeMetadata(obj)) {
            setRemoteMd(obj);
          }
          // JSON内に token_uri があれば優先
          if (typeof obj.token_uri === "string") {
            const uri = normalizeTokenUriFromCid(obj.token_uri);
            if (uri) setMetadataUri(uri);
          }
        } catch (e) {
          /* noop: 下で通常パス */
        }
      }

      // ② 通常パス（cid / token_uri を抽出）
      const parsed = parseQrContent(text);
      if (parsed.token_uri) {
        const uri = normalizeTokenUriFromCid(parsed.token_uri);
        if (uri) setMetadataUri(uri);
      } else if (parsed.cid) {
        const uri = normalizeTokenUriFromCid(parsed.cid);
        if (uri) setMetadataUri(uri);
      } else if (METADATA_URI_FIXED && !metadataUri) {
        setMetadataUri(normalizeTokenUriFromCid(METADATA_URI_FIXED));
      }

      if (parsed.token_id) setTokenId(String(parsed.token_id));
      if (parsed.contract) setContractAddr(String(parsed.contract));
      if (parsed.kind && (parsed.kind === "public_mint" || parsed.kind === "mint")) {
        setPreferredKind(parsed.kind);
      }
      if (parsed.owner && !owner) setOwner(String(parsed.owner));

      setMessage("QRコードを読み取りました。内容を反映しています。");

      // 読み取り後、読取メタデータへスクロール
      const anchor = document.getElementById("scanned-metadata-anchor");
      if (anchor) anchor.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      setMessage(e?.message || String(e));
    }
  }

  // ========== metadataUri がセットされたら metadata.json を取得して表示 ==========
  useEffect(() => {
    let abort = false;
    async function run() {
      if (!metadataUri) { setRemoteMd(null); return; }
      try {
        setRemoteMdLoading(true);
        setRemoteMdError("");
        const url = tokenUriToFetchUrl(metadataUri);
        const r = await fetch(url, { method: "GET" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!abort) setRemoteMd(j);
      } catch (e) {
        if (!abort) {
          setRemoteMd(null);
          setRemoteMdError(String(e?.message || e));
        }
      } finally {
        if (!abort) setRemoteMdLoading(false);
      }
    }
    run();
    return () => { abort = true; };
  }, [metadataUri]);

  // ========== on-chain extension（追記） ==========
  const addAttrRow = () => setExtraAttrs((prev) => [...prev, { trait_type: "", value: "" }]);
  const removeAttrRow = (i) => setExtraAttrs((prev) => prev.filter((_, idx) => idx !== i));
  const updateAttrRow = (i, key, val) =>
    setExtraAttrs((prev) => prev.map((a, idx) => (idx === i ? { ...a, [key]: val } : a)));

  function buildOnchainExtension() {
    const attrs = extraAttrs
      .filter((a) => (a.trait_type || "").trim() || (a.value || "").trim())
      .map((a) => ({ trait_type: (a.trait_type || "").trim(), value: (a.value || "").trim() }));

    if (extraNote.trim()) attrs.push({ trait_type: "Note", value: extraNote.trim() });

    const ext = {
      name: FIXED_MD_NAME,
      description: FIXED_MD_DESC,
      image: FIXED_MD_IMAGE,
    };
    if (attrs.length) ext.attributes = attrs;
    return ext;
  }

  // ========== ミント（extension をTXに同梱。未対応なら自動フォールバック） ==========
  const handleMint = async () => {
    try {
      setMinting(true);
      setMessage("");
      setTxHash("");

      if (!clientRef.current) throw new Error("Keplrに接続してください。");
      if (!owner) throw new Error("Owner が未設定です。");
      if (!contractAddr || contractAddr === "/XXX/") throw new Error("コントラクトアドレスが未設定です。");

      const token_uri = normalizeTokenUriFromCid(metadataUri);
      if (!token_uri) throw new Error("メタデータURI/CIDが不正です（例: ipfs://bafy... または https://.../ipfs/<cid>/...）");

      const client = clientRef.current;

      // 価格設定がある場合のみ funds を付ける（基本はフリーミント）
      let funds = undefined;
      if (price?.denom && String(price?.amount) !== "0") {
        funds = [{ amount: String(price.amount), denom: String(price.denom) }];
      }

      const extension = buildOnchainExtension();

      const execOnce = async (kind, withExtension) => {
        const base = { token_id: tokenId, owner, token_uri };
        const payload = withExtension ? { ...base, extension } : base;
        const msg = kind === "mint" ? { mint: payload } : { public_mint: payload };
        return client.execute(owner, contractAddr, msg, "auto", `ticket mint ${tokenId}`, funds);
      };

      let res;
      try {
        res = await execOnce(preferredKind, true);
      } catch (e1) {
        const t = String(e1?.message || e1);
        const noExtSupport =
          /unknown field.*extension|extra field.*extension|did not match any variant|no such variant|invalid type|invalid data/i.test(t);
        if (!noExtSupport) throw e1;

        try {
          res = await execOnce(preferredKind, false);
        } catch (e2) {
          const methodMissing =
            /unknown variant|no such variant|did not match any variant|found no variant|no variant named/i.test(
              String(e2?.message || e2)
            );
          if (!methodMissing) throw e2;
          const fallbackKind = preferredKind === "public_mint" ? "mint" : "public_mint";
          res = await execOnce(fallbackKind, false);
        }
      }

      setTxHash(res?.transactionHash || res?.hash || "");
      setMessage("入場券NFTのミントが完了しました。");

      // 次のIDを用意（連続ミント用）
      setTokenId(nowTokenId());
      setLastQrText("");
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

  const priceLabel = useMemo(() => (price?.denom ? `${price.amount} ${price.denom}` : "無料（0）"), [price]);

  // ===== スクロールできるラッパー（iOS/モバイル対応）=====
  const PAGE_WRAP = {
    minHeight: "100dvh",
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
    overscrollBehaviorY: "contain",
  };

  return (
    <div style={PAGE_WRAP}>
      <div style={{ maxWidth: 780, margin: "0 auto", padding: 16 }}>
        <h2>入場券NFT — QR読取り → 読取メタデータ表示 →（拡張）TX同梱フリーミント</h2>

        {/* QR 読取り（最上段） */}
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>QRコード読取り（カメラ）</div>
          <div id="qr-reader" style={{ width: 280, height: 280, background: "#fafafa", borderRadius: 8, maxWidth: "100%" }} />
          {/* ファイル読み取り用（scanFileは要素IDが必要） */}
          <div id="qr-reader-file" style={{ display: "none" }} />
          <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {!scanning ? <button onClick={startScan}>カメラを開始</button> : <button onClick={stopScan}>停止</button>}
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              画像から読む:
              <input ref={qrFileRef} type="file" accept="image/*" onChange={(e) => scanFromFile(e.target.files?.[0])} />
            </label>
          </div>
          {lastQrText && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#555", wordBreak: "break-all" }}>
              直近のQR内容: <code>{lastQrText}</code>
            </div>
          )}
        </div>

        {/* 読取メタデータ（QRから得た token_uri をfetch した内容を表示） */}
        <div id="scanned-metadata-anchor" />
        <div style={{ border: "1px solid #cfe3ff", borderRadius: 8, padding: 12, marginBottom: 12, background: "#f6faff" }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>読取メタデータ（プレビュー）</div>
          {!metadataUri && !remoteMd && (
            <div style={{ fontSize: 13, color: "#777" }}>まだ token_uri / metadata.json が読み込まれていません。</div>
          )}
          {metadataUri && (
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              token_uri:{" "}
              <a href={tokenUriToFetchUrl(metadataUri)} target="_blank" rel="noreferrer">
                {metadataUri}
              </a>
            </div>
          )}
          {remoteMdLoading && <div style={{ fontSize: 13 }}>読み込み中…</div>}
          {remoteMdError && <div style={{ fontSize: 13, color: "#b00020" }}>取得エラー: {remoteMdError}</div>}
          {remoteMd && (
            <div style={{ display: "grid", gap: 8 }}>
              {"name" in remoteMd && <div><b>name:</b> {String(remoteMd.name)}</div>}
              {"description" in remoteMd && <div><b>description:</b> {String(remoteMd.description)}</div>}
              {"external_url" in remoteMd && (
                <div><b>external_url:</b> <a href={String(remoteMd.external_url)} target="_blank" rel="noreferrer">{String(remoteMd.external_url)}</a></div>
              )}
              {"image" in remoteMd && (
                <div>
                  <b>image:</b>{" "}
                  <a href={tokenUriToFetchUrl(String(remoteMd.image))} target="_blank" rel="noreferrer">
                    {String(remoteMd.image)}
                  </a>
                  <div style={{ marginTop: 6 }}>
                    <img
                      src={tokenUriToFetchUrl(String(remoteMd.image))}
                      alt="metadata image"
                      style={{ maxWidth: "100%", height: "auto", borderRadius: 8 }}
                    />
                  </div>
                </div>
              )}
              {"animation_url" in remoteMd && (
                <div>
                  <b>animation_url:</b>{" "}
                  <a href={tokenUriToFetchUrl(String(remoteMd.animation_url))} target="_blank" rel="noreferrer">
                    {String(remoteMd.animation_url)}
                  </a>
                </div>
              )}
              {"attributes" in remoteMd && Array.isArray(remoteMd.attributes) && (
                <div>
                  <b>attributes:</b>
                  <ul style={{ margin: "6px 0 0 18px" }}>
                    {remoteMd.attributes.map((a, i) => (
                      <li key={i} style={{ fontSize: 13 }}>
                        {a?.trait_type ? <b>{a.trait_type}:</b> : <b>(no trait):</b>} {String(a?.value ?? "")}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Raw JSON</div>
                <pre style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 6, padding: 8, whiteSpace: "pre-wrap" }}>
{JSON.stringify(remoteMd, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* 固定メタデータ（参照用） */}
        <div id="fixed-metadata-anchor" />
        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, marginBottom: 12, background: "#fafafa" }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>固定メタデータ（参照用）</div>
          <div style={{ fontSize: 14, lineHeight: 1.6 }}>
            <div><b>name:</b> {FIXED_MD_NAME}</div>
            <div><b>description:</b> {FIXED_MD_DESC}</div>
            <div><b>image:</b> <a href={FIXED_MD_IMAGE} target="_blank" rel="noreferrer">{FIXED_MD_IMAGE}</a></div>
          </div>
        </div>

        {/* 固定 image のプレビュー */}
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>固定 image プレビュー</div>
          <img src={FIXED_MD_IMAGE} alt="fixed metadata image" style={{ display: "block", maxWidth: "100%", height: "auto", borderRadius: 8 }} />
        </div>

        {/* 追加メタデータ（on-chain extension としてTX同梱／任意） */}
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>追加メタデータ（TXに同梱 — IPFSへは保存しません）</div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 12, color: "#666" }}>
              ここで入力した内容は <code>extension</code> としてミントTXに同梱され、チェーン上に記録されます。
            </div>
            <button type="button" onClick={() => setExtraAttrs((prev) => [...prev, { trait_type: "", value: "" }])}>行を追加</button>
          </div>

          {extraAttrs.map((a, idx) => (
            <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, marginTop: 8 }}>
              <input
                placeholder="trait_type（例: Seat）"
                value={a.trait_type}
                onChange={(e) => setExtraAttrs(prev => prev.map((x,i)=> i===idx? {...x, trait_type: e.target.value}: x))}
              />
              <input
                placeholder="value（例: A-12）"
                value={a.value}
                onChange={(e) => setExtraAttrs(prev => prev.map((x,i)=> i===idx? {...x, value: e.target.value}: x))}
              />
              <button type="button" onClick={() => setExtraAttrs(prev => prev.filter((_,i)=> i!==idx))}>削除</button>
            </div>
          ))}

          <div style={{ marginTop: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>備考（Note, 任意）</div>
            <textarea
              rows={3}
              placeholder="表示上の補足や注意事項などを記述できます。"
              value={extraNote}
              onChange={(e) => setExtraNote(e.target.value)}
              style={{ width: "100%" }}
            />
          </div>

          {/* 送信前プレビュー */}
          <div style={{ marginTop: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>送信プレビュー（extension）</div>
            <pre style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 6, padding: 8, whiteSpace: "pre-wrap" }}>
{JSON.stringify((() => {
  const attrs = extraAttrs
    .filter(a => (a.trait_type || "").trim() || (a.value || "").trim())
    .map(a => ({ trait_type: (a.trait_type || "").trim(), value: (a.value || "").trim() }));
  if (extraNote.trim()) attrs.push({ trait_type: "Note", value: extraNote.trim() });
  const ext = { name: FIXED_MD_NAME, description: FIXED_MD_DESC, image: FIXED_MD_IMAGE };
  if (attrs.length) ext.attributes = attrs;
  return ext;
})(), null, 2)}
            </pre>
          </div>
        </div>

        {/* ウォレット & コントラクト（実行ボタンの直前） */}
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>ウォレット & コントラクト</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button disabled={connecting} onClick={connectKeplr}>{connected ? "再接続" : "Keplrに接続"}</button>
            <div style={{ fontSize: 13, color: "#666" }}>
              Chain: {CHAIN_ID}{rpcInUse ? `  RPC: ${rpcInUse}` : ""}
            </div>
          </div>
          <div style={{ marginTop: 8, fontSize: 13 }}>
            Owner:
            <input style={{ width: "100%" }} value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="あなたのアドレス" />
          </div>
          <div style={{ marginTop: 8, fontSize: 13 }}>
            コントラクトアドレス:
            <div style={{ display: "flex", gap: 8 }}>
              <input style={{ flex: 1 }} value={contractAddr} onChange={(e) => setContractAddr(e.target.value)} placeholder="/XXX/" />
              <button
                onClick={async () => {
                  if (clientRef.current && contractAddr && contractAddr !== "/XXX/") {
                    await refreshState(clientRef.current, contractAddr);
                    setMessage("コントラクト状態を更新しました。");
                  }
                }}
              >状態更新</button>
            </div>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: "#555" }}>
            手数料: {priceLabel}
          </div>
        </div>

        {/* 実行 */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button disabled={minting || !connected || !metadataUri} onClick={handleMint}>
            {minting ? "ミント中…" : "フリーミントを実行"}
          </button>
          {txHash && <code style={{ fontSize: 12 }}>tx: {txHash}</code>}
        </div>

        {message && (
          <div style={{ marginTop: 10, padding: 10, border: "1px solid #ABCE1C", background: "#f3f7ea", borderRadius: 6 }}>
            {message}
          </div>
        )}
      </div>
    </div>
  );
}
