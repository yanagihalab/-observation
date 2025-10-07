// src/IPFSUploadAndMintPage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { GasPrice, calculateFee } from "@cosmjs/stargate";
import { toUtf8 } from "@cosmjs/encoding";
// import { HttpClient } from "@cosmjs/tendermint-rpc";
import { CosmWasmClient } from "@cosmjs/cosmwasm-stargate";

// function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// function base64ToHex(b64) {
//   try {
//     if (typeof window === "undefined") {
//       // eslint-disable-next-line no-undef
//       return Buffer.from(b64, "base64").toString("hex").toUpperCase();
//     }
//     const bin = atob(b64);
//     let out = "";
//     for (let i = 0; i < bin.length; i++) out += bin.charCodeAt(i).toString(16).padStart(2, "0");
//     return out.toUpperCase();
//   } catch { return ""; }
// }

// function b64try(s) {
//   try {
//     const dec = atob(s);
//     return /^[\x09\x0A\x0D\x20-\x7E]+$/.test(dec) ? dec : s;
//   } catch { return s; }
// }

// /** tx_search でコントラクト関連Txを1ページ取得（REST不使用） */
// async function fetchContractTxsPage({
//   rpc,
//   addr,
//   page = 1,
//   perPage = 50,
//   withBlockTime = true,
//   forceMode, // "wasm._contract_address" | "message.contract_address" | undefined
// }) {
//   const client = new HttpClient(rpc);
//   let mode = forceMode || "wasm._contract_address";

//   const call = async (qMode) => {
//     const req = {
//       jsonrpc: "2.0",
//       id: 1,
//       method: "tx_search",
//       params: {
//         query: `${qMode}='${addr}'`,
//         prove: false,
//         page: String(page),
//         per_page: String(perPage),
//         order_by: "desc",
//       },
//     };
//     return await client.execute(req);
//   };

//   // 1発目（wasm._contract_address）
//   let res = await call(mode);
//   let txs = res?.result?.txs ?? [];
//   const total = Number(res?.result?.total_count ?? 0);

//   // 最初のページで0件ならフォールバック
//   if (!forceMode && page === 1 && txs.length === 0 && mode === "wasm._contract_address") {
//     mode = "message.contract_address";
//     res = await call(mode);
//     txs = res?.result?.txs ?? [];
//   }

//   // ブロック時間（必要時のみ）
//   let timeByHeight = {};
//   if (withBlockTime && txs.length > 0) {
//     const heights = Array.from(new Set(txs.map((t) => Number(t.height))));
//     for (const h of heights) {
//       const r = await fetch(`${rpc}/block?height=${h}`);
//       const j = await r.json();
//       timeByHeight[h] = j?.result?.block?.header?.time || "";
//       await sleep(40);
//     }
//   }

//   console.log(txs);

//   const rows = txs.map((t) => ({
//     hashB64: t.hash,
//     hashHex: base64ToHex(t.hash),
//     height: Number(t.height),
//     code: Number(t.tx_result?.code ?? 0),
//     time: withBlockTime ? (timeByHeight[Number(t.height)] || "") : "",
//     // ★ 追加：イベントを保持（クリック時にここから id を抽出）
//     events: t.tx_result?.events ?? [],
//   }));

//   return { rows, total, modeUsed: mode };
// }

// const res = await fetchContractTxsPage({
//   rpc: "https://rpc-palvus.pion-1.ntrn.tech:443".trim().replace(/\/$/, ""),
//   addr: "neutron1n0h44yyn6lhswspgvgwn4nzak6q8aj5qx0vaj95k2n0pl4zlcv8qcwzcc3".trim(),
//   page: 1,
//   perPage: 50,
//   withBlockTime: true,
//   undefined,
// });
// console.log(res);


/**
 * 画像 → IPFS(Azure Functions) → CID を取得し、
 * { store: { payload: {...}, cid } } を execute。
 * - コントラクトアドレスは固定（Mintscan リンク付き）
 * - 画像アップロードは DEV: /ipfs-upload → 失敗時 Azure直 / 本番: Azure直
 * - application/json 失敗時は text/plain で再試行（CORS/Preflight回避）
 * - payload.extras は「既存更新ではなく要素の追加」
 * - place は任意（緯度/経度が空/不正なら送信に含めない）
 * - life_status / category が「その他」のとき詳細入力を追加し、payload に life_status_detail / category_detail を追加
 * - テキストボックスは初期値なし（placeholder のみ表示）
 * - ページ最下部に最終メタデータ（payload / store msg）を表示
 * - TxHash は Mintscan（neutron-testnet）リンクで表示
 * - スクロールロックの付け外し（cameraOpen に連動）
 */

const ENV = {
  CHAIN_ID: "pion-1",
  CHAIN_NAME: "Neutron Testnet (pion-1)",
  DENOM: "untrn",
  DENOM_DECIMALS: 6,
  DISPLAY_DENOM: "NTRN",
  BECH32_PREFIX: "neutron",
  GAS_PRICE: 0.025,
  GAS_ADJUSTMENT: 1.5,
  CONTRACT_ADDR: "neutron1n0h44yyn6lhswspgvgwn4nzak6q8aj5qx0vaj95k2n0pl4zlcv8qcwzcc3",
  CUSTOM_UPLOAD_ENDPOINT: "https://fukaya-lab.azurewebsites.net/api/ipfs/upload",
};

// consts
const CHAIN_ID = ENV.CHAIN_ID;
const CHAIN_NAME = ENV.CHAIN_NAME;
const DENOM = ENV.DENOM;
const DECIMALS = Number(ENV.DENOM_DECIMALS);
const DISPLAY_DENOM = ENV.DISPLAY_DENOM;
const BECH32_PREFIX = ENV.BECH32_PREFIX;
const GAS_PRICE_NUM = Number(ENV.GAS_PRICE);
const GAS_ADJ = Number(ENV.GAS_ADJUSTMENT);
const CONTRACT_ADDR = ENV.CONTRACT_ADDR;

const CONTRACT_EXPLORER_URL =
  `https://www.mintscan.io/neutron-testnet/address/${CONTRACT_ADDR}`;
const TX_EXPLORER_BASE = "https://www.mintscan.io/neutron-testnet/txs/";
const formatTxLink = (h) => (h ? `${TX_EXPLORER_BASE}${h}` : "");

// RPC/REST
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

// DEV proxy
const IS_DEV = typeof import.meta !== "undefined" && !!import.meta.env?.DEV;
const DEV_PROXY_PATH = "/ipfs-upload";

async function firstReachable(urls, kind = "rpc") {
  for (const u of urls) {
    try {
      const probe = kind === "rpc" ? `${u}/health` : `${u}/cosmos/base/tendermint/v1beta1/node_info`;
      const r = await fetch(probe, { method: "GET" });
      if (r.ok) return u;
    } catch { }
  }
  throw new Error(`No ${kind.toUpperCase()} endpoint reachable`);
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
function nowUnixSec() { return Math.floor(Date.now() / 1000); }
function toLocalDatetimeInputValue(unixSec) {
  const d = new Date(unixSec * 1000);
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}
function parseLocalDatetimeInputValue(s) {
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

/** ==== Uploader helpers ==== */
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
function extractCidFromResponse(j) {
  if (!j || typeof j !== "object") return "";
  const fields = ["cid", "CID", "Cid", "ipfs", "Ipfs", "ipfsHash", "IpfsHash", "hash", "Hash", "path", "Path", "url", "Url"];
  let val = null;
  for (const f of fields) if (typeof j[f] === "string" && j[f]) { val = j[f]; break; }
  if (!val && j.pin && typeof j.pin.cid === "string") val = j.pin.cid;
  if (!val && typeof j.result === "string") val = j.result;
  if (!val) return "";
  const m = val.match(/\/(?:ipfs|IPFS)\/([^/?#]+)/);
  if (m) val = m[1];
  return val.replace(/^ipfs:\/\//i, "").replace(/^ipfs\//i, "");
}
async function customUploadFileWithFallback(file) {
  const ab = await file.arrayBuffer();
  const base64 = arrayBufferToBase64(ab);
  const payload = { Name: file.name || `file-${Date.now()}`, ContentType: file.type || "application/octet-stream", Data: base64 };

  const endpoints = IS_DEV ? [DEV_PROXY_PATH, ENV.CUSTOM_UPLOAD_ENDPOINT] : [ENV.CUSTOM_UPLOAD_ENDPOINT];
  const contentTypes = ["application/json", "text/plain;charset=UTF-8"];

  let lastErr = null, lastDetail = null;
  for (const ep of endpoints) {
    for (const ct of contentTypes) {
      try {
        const res = await fetch(ep, {
          method: "POST",
          headers: { "Content-Type": ct },
          body: JSON.stringify(payload),
          mode: "cors",
          credentials: "omit",
        });
        const text = await res.text();
        if (!res.ok) { lastErr = new Error(`Upload failed ${res.status} at ${ep}`); lastDetail = { endpoint: ep, status: res.status, body: text.slice(0, 200) }; continue; }
        let j = {};
        try { j = JSON.parse(text); } catch { }
        const cid = extractCidFromResponse(j) || extractCidFromResponse({ path: text });
        if (!cid) { lastErr = new Error(`Response has no CID at ${ep}`); lastDetail = { endpoint: ep, status: res.status, body: text.slice(0, 400) }; continue; }
        return { cid, endpoint: ep, raw: text };
      } catch (e) {
        lastErr = e; lastDetail = { endpoint: ep, error: String(e?.message || e) };
      }
    }
  }
  const msg = `画像アップロードに失敗しました。${lastErr ? String(lastErr) : ""}`;
  throw Object.assign(new Error(msg), { detail: lastDetail });
}

/** ==== Main UI ==== */
export default function MintNFTPage() {
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [showPayload, setShowPayload] = useState(false);

  async function fetchAllCids() {
    const rpc = "https://rpc-palvus.pion-1.ntrn.tech:443".trim().replace(/\/$/, "");
    const addr = "neutron1n0h44yyn6lhswspgvgwn4nzak6q8aj5qx0vaj95k2n0pl4zlcv8qcwzcc3".trim();
    const client = await CosmWasmClient.connect(rpc);
    const out = [];
    let start_after = null;
    while (true) {
      const query = start_after == null
        ? { list: { limit: 500 } }
        : { list: { limit: 500, start_after } };
      const res = await client.queryContractSmart(addr, query);
      console.log(res);
      const records = res?.records ?? [];
      for (const r of records) {
        out.push({ id: r.id, cid: (r.cid || ""), mine: (owner && (owner == r.sender)) });
      }
      const next = res?.next_start_after ?? null;
      if (!next) break;
      start_after = next;
    }
    // id昇順で整列（任意）
    out.sort((a, b) => a.id - b.id);
    console.log(out);
    setItems(out.filter(item => item.id >= 13));
  }
  const listing = async () => {
    await fetchAllCids();
  }

  // Wallet
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [owner, setOwner] = useState(""); // placeholder のみ表示
  const clientRef = useRef(null);
  const [rpcUrlUsed, setRpcUrlUsed] = useState("");

  // Payload（CLI準拠）— テキストは初期値なし（placeholder のみ）
  const [observedAtSec, setObservedAtSec] = useState(nowUnixSec());
  const [speciesScientific, setSpeciesScientific] = useState("");
  const [nameJa, setNameJa] = useState("");

  // ▼ カテゴリと生育状態（「その他」選択時は詳細欄）
  const [category, setCategory] = useState(""); // 未選択から開始
  const [categoryDetail, setCategoryDetail] = useState("");
  const [lifeStatus, setLifeStatus] = useState("野生"); // 既定は野生のまま
  const [lifeStatusDetail, setLifeStatusDetail] = useState("");

  const [notes, setNotes] = useState("");

  // 追加メタ（追加のみ／placeholder）
  const [extras, setExtras] = useState([{ key: "", value: "" }]);
  const addExtra = () => setExtras((p) => [...p, { key: "", value: "" }]);
  const removeExtra = (i) => setExtras((p) => p.filter((_, idx) => idx !== i));
  const updateExtra = (i, k, v) => setExtras((p) => p.map((e, idx) => idx === i ? { ...e, [k]: v } : e));

  // 場所（任意・空欄可）
  const [latDeg, setLatDeg] = useState("");
  const [lonDeg, setLonDeg] = useState("");
  const fillCurrentLocation = async () => {
    if (!navigator.geolocation) { setMessage("このブラウザは位置情報に対応していません。"); return; }
    if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
      setMessage("位置情報はHTTPSまたはlocalhostでのみ使用できます。"); return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatDeg(String(pos.coords.latitude.toFixed(6)));
        setLonDeg(String(pos.coords.longitude.toFixed(6)));
      },
      (err) => setMessage(`現在地の取得に失敗: ${err?.message || err}`),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  };

  // 画像
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [cidImage, setCidImage] = useState("");
  const [uploadDiag, setUploadDiag] = useState(null);

  // カメラ
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [facingMode, setFacingMode] = useState("environment");
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [message, setMessage] = useState("");

  // スクロール制御（オーバーレイ中だけロック）
  useEffect(() => {
    const html = document.documentElement, body = document.body;
    if (cameraOpen) {
      const prevHtmlOverflow = html.style.overflow;
      const prevBodyOverflow = body.style.overflow;
      const prevOverscroll = body.style.overscrollBehavior;
      html.style.overflow = "hidden";
      body.style.overflow = "hidden";
      body.style.overscrollBehavior = "contain";
      return () => { html.style.overflow = prevHtmlOverflow; body.style.overflow = prevBodyOverflow; body.style.overscrollBehavior = prevOverscroll; };
    }
  }, [cameraOpen]);

  // レイアウト
  const [clientWidth, setClientWidth] = useState(100);
  const [itemWidth, setItemWidth] = useState(400);
  useEffect(() => {
    const resize = () => {
      const client = document.documentElement.clientWidth - 16;
      const columns = Math.max(1, Math.ceil(client / 320));
      setClientWidth(client);
      setItemWidth(client / columns - 16);
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => () => stopCamera(), []);

  // Keplr 接続
  const connectKeplr = async () => {
    try {
      setConnecting(true); setMessage("");
      const rpcUrl = await firstReachable(RPC_CANDIDATES, "rpc");
      const restUrl = await firstReachable(REST_CANDIDATES, "rest");
      setRpcUrlUsed(rpcUrl);
      if (!window.keplr) throw new Error("Keplrが見つかりません。拡張機能をインストールしてください。");

      if (window.keplr.experimentalSuggestChain) {
        await window.keplr.experimentalSuggestChain({
          chainId: CHAIN_ID, chainName: CHAIN_NAME, rpc: rpcUrl, rest: restUrl,
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
          feeCurrencies: [{ coinDenom: DISPLAY_DENOM, coinMinimalDenom: DENOM, coinDecimals: DECIMALS, gasPriceStep: { low: 0.01, average: GAS_PRICE_NUM, high: 0.04 } }],
          stakeCurrency: { coinDenom: DISPLAY_DENOM, coinMinimalDenom: DENOM, coinDecimals: DECIMALS },
          features: ["cosmwasm"],
        });
      }

      await window.keplr.enable(CHAIN_ID);
      const offlineSigner = await window.keplr.getOfflineSignerAuto(CHAIN_ID);
      const [{ address }] = await offlineSigner.getAccounts();
      const gasPrice = GasPrice.fromString(`${GAS_PRICE_NUM}${DENOM}`);
      const client = await SigningCosmWasmClient.connectWithSigner(rpcUrl, offlineSigner, { gasPrice, prefix: BECH32_PREFIX });
      clientRef.current = client;
      setOwner(address);
      setConnected(true);
      setMessage(`Keplrに接続しました（RPC: ${rpcUrl}）`);
    } catch (err) {
      console.error(err); setMessage(err?.message || String(err));
    } finally { setConnecting(false); }
  };

  // カメラ
  async function startCamera(mode) {
    try {
      setCameraOpen(true);
      setCameraError("");
      setFacingMode(mode);
      if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") { setCameraError("HTTPS または localhost でアクセスしてください。"); return; }
      if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
      if (!navigator.mediaDevices?.getUserMedia) { setCameraError("このブラウザはカメラに対応していません。"); return; }
      try { const st = await navigator.permissions?.query?.({ name: "camera" }); if (st && st.state === "denied") { setCameraError("カメラがブロックされています。許可してください。"); return; } } catch { }

      const devices = (await navigator.mediaDevices.enumerateDevices());
      const targets = devices.filter(item => item.label == "Microsoft Camera Rear");
      if (mode == "environment" && targets.length == 1) {
        const constraints = { audio: false, video: { deviceId: { exact: targets[0].deviceId }, width: { ideal: 1280 }, height: { ideal: 1280 } } };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; try { await videoRef.current.play(); } catch { console.log("referror"); } }
      } else {
        const constraints = { audio: false, video: { facingMode: { ideal: mode }, width: { ideal: 1280 }, height: { ideal: 1280 } } };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; try { await videoRef.current.play(); } catch { console.log("referror"); } }
      }
    } catch (e) { console.error(e); setCameraError(e?.message || String(e)); setCameraOpen(false); }
  }

  function stopCamera() {
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
  }

  function downscaleAndToBlob(video, maxSide = 1280, quality = 0.92) {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return Promise.resolve(null);
    let W = w, H = h;
    if (w >= h && w > maxSide) { const r = maxSide / w; W = Math.round(w * r); H = Math.round(h * r); }
    else if (h > w && h > maxSide) { const r = maxSide / h; W = Math.round(w * r); H = Math.round(h * r); }
    const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d"); ctx.drawImage(video, 0, 0, W, H);
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality));
  }

  const takePhoto = async () => {
    try {
      const video = videoRef.current; if (!video) return;
      const blob = await downscaleAndToBlob(video, 1280, 0.92);
      if (!blob) { setMessage("画像の生成に失敗しました。"); return; }
      const name = `camera-${Date.now()}.jpg`;
      const f = new File([blob], name, { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      if (preview && preview.startsWith("blob:")) URL.revokeObjectURL(preview);
      setPreview(url); setFile(f); stopCamera();
    } catch (e) { console.error(e); setMessage(e?.message || String(e)); }
  };
  const flipCamera = async () => { await startCamera(facingMode === "environment" ? "user" : "environment"); };

  // ファイル選択
  const onSelectFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    if (!f.type.startsWith("image/")) { setMessage("画像ファイルを選択してください。"); return; }
    setFile(f); const url = await fileToDataUrl(f); setPreview(url);
  };

  // 画像→CID
  const handleUploadToIPFS = async () => {
    try {
      setUploading(true); setMessage(""); setCidImage(""); setUploadDiag(null);
      if (!file) throw new Error("画像を選択/撮影してください。");
      const { cid, endpoint, raw } = await customUploadFileWithFallback(file);
      setCidImage(cid);
      setUploadDiag({ ok: true, endpoint, sample: (raw || "").slice(0, 200) });
      setMessage("画像をIPFSにアップロードしました。CIDを使ってトランザクションを送信できます。");
    } catch (err) {
      console.error(err);
      const detail = err?.detail ? `\n詳細: ${JSON.stringify(err.detail).slice(0, 400)}` : "";
      setUploadDiag({ ok: false, error: String(err?.message || err), detail: err?.detail || null });
      setMessage(`画像CIDの取得に失敗しました。${detail}`);
    } finally { setUploading(false); }
  };

  // 送信
  const handleStore = async () => {
    try {
      setSending(true); setMessage(""); setTxHash("");
      if (!clientRef.current) throw new Error("Keplrに接続してください。");
      if (!owner) throw new Error("送信者アドレスが未設定です。");
      if (!cidImage) throw new Error("まず画像をIPFSにアップロードしてCIDを取得してください。");

      // place: 両方数値が入っているときだけ採用
      const latStr = (latDeg ?? "").trim();
      const lonStr = (lonDeg ?? "").trim();
      const hasLatLon =
        latStr.length > 0 && lonStr.length > 0 &&
        Number.isFinite(parseFloat(latStr)) && Number.isFinite(parseFloat(lonStr));
      const latNum = hasLatLon ? parseFloat(latStr) : null;
      const lonNum = hasLatLon ? parseFloat(lonStr) : null;
      const latInt = hasLatLon ? Math.round(latNum * 1000) : null;
      const lonInt = hasLatLon ? Math.round(lonNum * 1000) : null;

      const extrasFiltered = extras
        .filter((e) => (e.key ?? "").trim() || (e.value ?? "").trim())
        .map((e) => ({ key: String(e.key), value: String(e.value) }));

      const payload = {
        observed_at: Number(observedAtSec),
        species: { scientific: String(speciesScientific || "").trim(), vernacular_ja: String(nameJa || "").trim() },
        ...(category ? { category: String(category) } : {}),
        life_status: String(lifeStatus || "").trim(),
        ...(notes ? { notes: String(notes).trim() } : {}),
        ...(category === "その他" && categoryDetail.trim() ? { category_detail: categoryDetail.trim() } : {}),
        ...(lifeStatus === "その他" && lifeStatusDetail.trim() ? { life_status_detail: lifeStatusDetail.trim() } : {}),
        ...(hasLatLon ? { place: { lat: latInt, lon: lonInt } } : {}),
        ...(extrasFiltered.length ? { extras: extrasFiltered } : {}),
      };
      const execMsg = { store: { payload, cid: cidImage } };

      const client = clientRef.current;

      /** @type {import('@cosmjs/cosmwasm-stargate').MsgExecuteContractEncodeObject} */
      const execEncodeObj = {
        typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
        value: { sender: owner, contract: CONTRACT_ADDR, msg: toUtf8(JSON.stringify(execMsg)), funds: [] },
      };

      let fee = "auto";
      try {
        const gas = await client.simulate(owner, [execEncodeObj], "store observation");
        const gasPrice = GasPrice.fromString(`${GAS_PRICE_NUM}${DENOM}`);
        fee = calculateFee(Math.round(gas * GAS_ADJ), gasPrice);
      } catch (e) {
        console.warn("simulate failed, fallback to auto fee:", e?.message || e);
        fee = "auto";
      }

      const result = await client.execute(owner, CONTRACT_ADDR, execMsg, fee, "store observation");
      const txhash = result?.transactionHash || result?.hash || "";
      setTxHash(txhash);
      setMessage("観測データの保存TXを送信しました。");
      setFile(null);
      setCidImage("");
      setPreview("");
    } catch (err) { console.error(err); setMessage(err?.message || String(err)); }
    finally { setSending(false); }
  };

  // 表示用
  const { latIntDisp, lonIntDisp } = useMemo(() => {
    const latStr = (latDeg ?? "").trim();
    const lonStr = (lonDeg ?? "").trim();
    const ok = latStr.length > 0 && lonStr.length > 0 &&
      Number.isFinite(parseFloat(latStr)) && Number.isFinite(parseFloat(lonStr));
    return ok
      ? { latIntDisp: Math.round(parseFloat(latStr) * 1000), lonIntDisp: Math.round(parseFloat(lonStr) * 1000) }
      : { latIntDisp: "-", lonIntDisp: "-" };
  }, [latDeg, lonDeg]);

  const finalPayload = useMemo(() => {
    const latStr = (latDeg ?? "").trim();
    const lonStr = (lonDeg ?? "").trim();
    const hasLatLon = latStr.length > 0 && lonStr.length > 0 &&
      Number.isFinite(parseFloat(latStr)) && Number.isFinite(parseFloat(lonStr));
    const extrasFiltered = extras
      .filter((e) => (e.key ?? "").trim() || (e.value ?? "").trim())
      .map((e) => ({ key: String(e.key), value: String(e.value) }));
    return {
      observed_at: Number(observedAtSec),
      species: { scientific: String(speciesScientific || "").trim(), vernacular_ja: String(nameJa || "").trim() },
      ...(category ? { category: String(category) } : {}),
      life_status: String(lifeStatus || "").trim(),
      ...(notes ? { notes: String(notes).trim() } : {}),
      ...(category === "その他" && categoryDetail.trim() ? { category_detail: categoryDetail.trim() } : {}),
      ...(lifeStatus === "その他" && lifeStatusDetail.trim() ? { life_status_detail: lifeStatusDetail.trim() } : {}), // safe: life_status key exists
      ...(hasLatLon ? { place: { lat: Math.round(parseFloat(latStr) * 1000), lon: Math.round(parseFloat(lonStr) * 1000) } } : {}),
      ...(extrasFiltered.length ? { extras: extrasFiltered } : {}),
    };
  }, [observedAtSec, speciesScientific, nameJa, category, categoryDetail, lifeStatus, lifeStatusDetail, notes, latDeg, lonDeg, extras]);

  const finalMsg = useMemo(() => ({ store: { payload: finalPayload, cid: cidImage || "(CID未取得)" } }), [finalPayload, cidImage]);

  const copyJson = async (obj) => {
    try { await navigator.clipboard.writeText(JSON.stringify(obj, null, 2)); setMessage("JSONをコピーしました。"); }
    catch { setMessage("クリップボードの書き込みに失敗しました。"); }
  };

  return (
    <div className="div_base" style={{ minHeight: "100vh", overflowY: "auto" }}>
      <div className="div_header">Flora Observation: 画像→IPFS(CID)→store TX（Neutron Testnet）</div>
      <div className="div_content">

        {/* ウォレット接続 / コントラクト（固定リンク付き） */}
        <div style={{ margin: "8px 0", padding: "12px", border: "1px solid #ccc", borderRadius: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: "6px" }}>ウォレット接続</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" disabled={connecting} onClick={connectKeplr}>
              {connected ? "再接続" : "Keplrに接続"}
            </button>
            <div style={{ fontSize: 12, color: "#666" }}>
              Chain: <b>{CHAIN_NAME}</b> ({CHAIN_ID}) {rpcUrlUsed ? `— RPC: ${rpcUrlUsed}` : ""}
            </div>
          </div>
          <div style={{ marginTop: 6, fontSize: 13 }}>
            送信者（Owner）:
            <input
              style={{ width: "100%" }}
              placeholder="例: neutron1..."
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            />
          </div>
          <div style={{ marginTop: 6, fontSize: 13 }}>
            コントラクトアドレス（固定）:{" "}
            <a href={CONTRACT_EXPLORER_URL} target="_blank" rel="noreferrer">
              <code>{CONTRACT_ADDR}</code>
            </a>
          </div>
        </div>

        {/* 観測ペイロード */}
        <div style={{ margin: "8px 0", padding: "12px", border: "1px solid #ccc", borderRadius: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>観測ペイロード</div>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                観測日時:
                <input
                  type="datetime-local"
                  value={toLocalDatetimeInputValue(observedAtSec)}
                  onChange={(e) => setObservedAtSec(parseLocalDatetimeInputValue(e.target.value))}
                  style={{ width: "100%" }}
                />
                <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                  UNIX秒: {observedAtSec} <button type="button" onClick={() => setObservedAtSec(nowUnixSec())}>現在時刻</button>
                </div>
              </div>
              <div>
                生育状態（life_status）:
                <select value={lifeStatus} onChange={(e) => setLifeStatus(e.target.value)}>
                  <option value="野生">野生</option>
                  <option value="飼育または栽培">飼育または栽培</option>
                  <option value="その他">その他</option>
                </select>
                {lifeStatus === "その他" && (
                  <input
                    style={{ width: "100%", marginTop: 6 }}
                    placeholder="例: 半栽培・保全区域内 等"
                    value={lifeStatusDetail}
                    onChange={(e) => setLifeStatusDetail(e.target.value)}
                  />
                )}
              </div>
            </div>

            <div>
              学名（species.scientific）:
              <input
                style={{ width: "100%" }}
                placeholder="例: Prunus mume"
                value={speciesScientific}
                onChange={(e) => setSpeciesScientific(e.target.value)}
              />
            </div>
            <div>
              和名（species.vernacular_ja）:
              <input
                style={{ width: "100%" }}
                placeholder="例: ウメ"
                value={nameJa}
                onChange={(e) => setNameJa(e.target.value)}
              />
            </div>

            <div>
              カテゴリ（category）:
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="" disabled>選択してください</option>
                <option value="不明">不明</option>
                <option value="鳥類">鳥類</option>
                <option value="爬虫類または両生類">爬虫類または両生類</option>
                <option value="哺乳類">哺乳類</option>
                <option value="魚類">魚類</option>
                <option value="虫または甲殻類">虫または甲殻類</option>
                <option value="植物">植物</option>
                <option value="菌類（キノコなど）">菌類（キノコなど）</option>
                <option value="その他">その他</option>
              </select>
              {category === "その他" && (
                <input
                  style={{ width: "100%", marginTop: 6 }}
                  placeholder="例: 原生生物・コケ植物 等"
                  value={categoryDetail}
                  onChange={(e) => setCategoryDetail(e.target.value)}
                />
              )}
            </div>

            <div>
              備考（notes）:
              <textarea
                rows={2}
                style={{ width: "100%" }}
                placeholder="例: 東京駅付近"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {/* 場所（任意、空欄OK） */}
            <div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>場所（任意）</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8 }}>
                <input
                  placeholder="緯度（度） 例: 35.681"
                  value={latDeg}
                  onChange={(e) => setLatDeg(e.target.value)}
                />
                <input
                  placeholder="経度（度） 例: 139.767"
                  value={lonDeg}
                  onChange={(e) => setLonDeg(e.target.value)}
                />
                <button type="button" onClick={fillCurrentLocation}>現在地</button>
              </div>
              <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                ※ どちらかが空欄/不正なら <code>place</code> は送信に含めません（エラーになりません）。<br />
                送信値プレビュー: lat={latIntDisp} / lon={lonIntDisp}（度×1000）
              </div>
            </div>

            {/* 追加メタデータ（追加のみ） */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 600 }}>追加メタデータ（extras）</div>
                <button type="button" onClick={addExtra}>行を追加</button>
              </div>
              {extras.map((e, idx) => (
                <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, marginTop: 6 }}>
                  <input placeholder="例: exif.camera_model" value={e.key} onChange={(ev) => updateExtra(idx, "key", ev.target.value)} />
                  <input placeholder="例: Canon EOS R50" value={e.value} onChange={(ev) => updateExtra(idx, "value", ev.target.value)} />
                  <button type="button" onClick={() => removeExtra(idx)}>削除</button>
                </div>
              ))}
              <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                ※ ここで入力した要素は <code>payload.extras</code> に<b>追加</b>されます（既存を更新しません）。
              </div>
            </div>
          </div>
        </div>

        {/* 画像 → IPFS（CID取得） */}
        <div style={{ margin: "8px 0", padding: "12px", border: "1px solid #ccc", borderRadius: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>画像 → IPFS（CID取得）</div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" onClick={() => startCamera("environment")} disabled={cameraOpen}>カメラを起動（背面）</button>
            <button type="button" onClick={() => document.getElementById("file-picker")?.click()} disabled={cameraOpen}>ファイルから選択</button>
            <input id="file-picker" type="file" accept="image/*" onChange={onSelectFile} style={{ display: "none" }} />
          </div>

          {preview && (
            <div style={{ marginTop: 8 }}>
              <img src={preview} alt="preview" style={{ objectFit: "cover", width: itemWidth, height: itemWidth, borderRadius: 4 }} />
            </div>
          )}

          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            {!preview && (<div style={{ fontWeight: "bold", color: "#b00020" }}>写真を撮影してください</div>)}
            {preview && (
              <button type="button" onClick={handleUploadToIPFS} disabled={uploading || !file}>
                {uploading ? "アップロード中…" : "IPFSへアップロード（画像→CID）"}
              </button>
            )}
            <div style={{ fontSize: 13 }}>
              画像CID: {cidImage || "-"}
            </div>

            {uploadDiag && (
              <div style={{ fontSize: 12, color: uploadDiag.ok ? "#2f7d32" : "#b00020" }}>
                {uploadDiag.ok
                  ? <>アップロード成功（endpoint: <code>{uploadDiag.endpoint}</code>）</>
                  : <>アップロード失敗: {uploadDiag.error}</>}
                {uploadDiag.detail && (
                  <div style={{ marginTop: 4 }}>
                    詳細: <code style={{ wordBreak: "break-all" }}>{JSON.stringify(uploadDiag.detail)}</code>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 送信（execute store） */}
        <div style={{ margin: "8px 0", padding: "12px", border: "1px solid #ccc", borderRadius: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>コントラクトへ送信</div>
          {!cidImage && (<div style={{ fontWeight: "bold", color: "#b00020" }}>写真をアップロードしてください</div>)}
          {cidImage && (
            <button type="button" onClick={handleStore} disabled={sending || !connected}>
              {sending ? "送信中…" : "store TX を送る"}
            </button>
          )}
          <div style={{ fontSize: 13, marginTop: 8 }}>
            TxHash: {txHash ? (<a href={formatTxLink(txHash)} target="_blank" rel="noreferrer">{txHash}</a>) : "-"}
          </div>
          <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
            ガス価格: {GAS_PRICE_NUM} {DENOM} / ガス調整: {GAS_ADJ}
          </div>
        </div>

        {/* 画像一覧 */}
        <div style={{ margin: "8px 0" }}>
          <div style={{ fontWeight: 600, margin: "0px 12px" }}>画像一覧<button type="button" onClick={listing} style={{margin: "0px 8px"}}>更新</button></div>
          <div style={{ display: "flex", flexWrap: "wrap", width: clientWidth, padding: "8px" }}>
            {items.map(item => (
              <div key={item.id} style={{ position: "relative", margin: "8px", width: itemWidth, height: itemWidth }}>
                <img style={{ objectFit: "cover", width: itemWidth, height: itemWidth }} src={('https://ipfs.yamada.jo.sus.ac.jp/ipfs/' + item.cid)} />
                {item.mine && (<div style={{ position: "absolute", top: 0, left: 0, backgroundColor: "#c0c000", color: "#ffffff" }}>★</div>)}
              </div>
            ))}
          </div>
        </div>

        {/* 最下部：最終メタデータ表示 */}
        {!showPayload && (
          <div style={{ padding: 12, background: "#fafafa", cursor: "pointer", userSelect: "none" }} role="button" onClick={() => setShowPayload(true)}>
            <div style={{ fontWeight: 700 }}>最終メタデータ<span style={{ color: "#ABCE1C", fontWeight: "bold" }}>＋</span></div>
          </div>
        )}
        {showPayload && (
          <div style={{ padding: 12, background: "#fafafa" }}>
            <div style={{ fontWeight: 700, marginBottom: 6, cursor: "pointer", userSelect: "none" }} role="button" onClick={() => setShowPayload(false)}>最終メタデータ（payload / 送信メッセージ）<span style={{ color: "#ABCE1C", fontWeight: "bold" }}>－</span></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>payload</div>
                <pre style={{ margin: 0, padding: 8, background: "#fff", border: "1px solid #eee", borderRadius: 6, overflow: "auto" }}>
                  {JSON.stringify(finalPayload, null, 2)}
                </pre>
                <button type="button" onClick={() => copyJson(finalPayload)} style={{ marginTop: 6 }}>payload をコピー</button>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>store メッセージ</div>
                <pre style={{ margin: 0, padding: 8, background: "#fff", border: "1px solid #eee", borderRadius: 6, overflow: "auto" }}>
                  {JSON.stringify(finalMsg, null, 2)}
                </pre>
                <button type="button" onClick={() => copyJson(finalMsg)} style={{ marginTop: 6 }}>メッセージをコピー</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* メッセージ */}
      <div style={{ background: "#f3f7ea", border: "1px solid #ABCE1C", borderRadius: 6, zIndex: 9998, padding: 10 }}>
        {!message && (<span>メッセージがある場合はここに表示されます</span>)}
        {message && (<span>{message}</span>)}
      </div>

      {/* カメラオーバーレイ */}
      {cameraOpen && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            zIndex: 9999, padding: 12, touchAction: "none"
          }}
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          <div style={{ color: "#fff", marginBottom: 8, fontWeight: 600 }}>カメラ撮影</div>
          <video ref={videoRef} playsInline muted autoPlay style={{ width: "min(95vw, 480px)", height: "min(95vw, 480px)", background: "#000", borderRadius: 8, objectFit: "cover" }} />
          {cameraError && <div style={{ color: "#ffbdbd", marginTop: 6, fontSize: 12 }}>{cameraError}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" onClick={takePhoto}>シャッター</button>
            <button type="button" onClick={flipCamera}>前/背面 切替</button>
            <button type="button" onClick={() => stopCamera()}>キャンセル</button>
          </div>
          <div style={{ color: "#bbb", marginTop: 6, fontSize: 12 }}>
            ※ HTTPS または localhost でのみカメラが使用できます
          </div>
        </div>
      )}
    </div>
  );
}
