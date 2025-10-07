// src/eQRpaper.jsx (or eQRpaper_snap.jsx)
import { useEffect, useMemo, useRef, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { GasPrice, calculateFee } from "@cosmjs/stargate";
import { toUtf8 } from "@cosmjs/encoding";

/**
 * e-QRpaper (必須ステップ版 + メトリクス計測)
 * 1) QRスキャン（必須）… JSONから name/description/unique_id/qr_id/observed_at を取得
 * 2) Keplr接続（必須）
 * 3) コントラクトへ送信（必須）
 * - payload: QR由来の name/description + unique_id/qr_id/observed_at
 * - cid: 固定値（非表示で常に付与）
 * - Metrics: QR読取 → Txハッシュ取得 の所要時間を localStorage に保存・集計・CSV出力
 */

// ── 環境設定 ─────────────────────────────────────────────
const ENV = {
  CHAIN_ID: "pion-1",
  CHAIN_NAME: "Neutron Testnet (pion-1)",
  DENOM: "untrn",
  DENOM_DECIMALS: 6,
  DISPLAY_DENOM: "NTRN",
  BECH32_PREFIX: "neutron",
  GAS_PRICE: 0.025,
  GAS_ADJUSTMENT: 1.5,
  CONTRACT_ADDR: "neutron1j960c7dr8jc7tfnr7d4zx6xfgy5wme4xrg06gkwuyaf8jljsqhwq470v66",
};

// ★ 固定CID（非表示・常にこの値を送信）
const FIXED_CID = "QmTuDCtiZJjRFqiZ6D5X2iNX8ejwNu6Kv1F7EcThej8yHu";

// ★ QRスキャナ表示サイズ（コンパクト）
const SCAN_PANEL = { width: 320, height: 360, qrbox: 220 };

const CHAIN_ID = ENV.CHAIN_ID;
const CHAIN_NAME = ENV.CHAIN_NAME;
const DENOM = ENV.DENOM;
const DISPLAY_DENOM = ENV.DISPLAY_DENOM;
const BECH32_PREFIX = ENV.BECH32_PREFIX;
const GAS_PRICE_NUM = Number(ENV.GAS_PRICE);
const GAS_ADJ = Number(ENV.GAS_ADJUSTMENT);
const CONTRACT_ADDR = ENV.CONTRACT_ADDR;

const TX_EXPLORER_BASE = "https://www.mintscan.io/neutron-testnet/tx/";
const formatTxLink = (h) => (h ? `${TX_EXPLORER_BASE}${h}` : "");

// Keplr提案用の到達可能エンドポイント探索
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
      const probe =
        kind === "rpc"
          ? `${u}/health`
          : `${u}/cosmos/base/tendermint/v1beta1/node_info`;
      const r = await fetch(probe, { method: "GET" });
      if (r.ok) return u;
    } catch {}
  }
  throw new Error(`No ${kind.toUpperCase()} endpoint reachable`);
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

// ── Metrics helpers ─────────────────────────────────────
const LS_KEY = "eqr_metrics_v1";
function loadMetrics() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; }
}
function saveMetrics(arr) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); } catch {}
}
function toCsv(rows) {
  const header = ["scan_time_iso","tx_time_iso","duration_ms","duration_s","txhash","name","description","unique_id","qr_id"];
  const escape = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map(r => [
    escape(new Date(r.scan_at).toISOString()),
    escape(new Date(r.tx_at).toISOString()),
    r.ms,
    (r.ms/1000).toFixed(3),
    escape(r.txhash),
    escape(r.name),
    escape(r.description),
    escape(r.unique_id),
    escape(r.qr_id),
  ].join(","));
  return [header.join(","), ...lines].join("\n");
}
function statsFrom(durationsMs) {
  if (!durationsMs.length) return null;
  const arr = durationsMs.slice().sort((a,b)=>a-b);
  const n = arr.length;
  const sum = arr.reduce((a,b)=>a+b,0);
  const avg = sum/n;
  const min = arr[0], max = arr[n-1];
  const pick = (p) => arr[Math.min(n-1, Math.floor(p*(n-1)))];
  const med = pick(0.5), p90 = pick(0.9), p95 = pick(0.95), p99 = pick(0.99);
  return { n, avg, min, max, med, p90, p95, p99 };
}

// ── Component ───────────────────────────────────────────
export default function EQRpaper() {
  // ステップ状態
  const [scannerOpen, setScannerOpen] = useState(true); // 初期状態でスキャナを開く
  const [qrWidth, setQrWidth] = useState(SCAN_PANEL.width);
  const [qrHeight, setQrHeight] = useState(SCAN_PANEL.height);
  const [lastQrRaw, setLastQrRaw] = useState("");

  // フォーム（QRから反映／編集可）
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [uniqueId, setUniqueId] = useState("");
  const [qrId, setQrId] = useState("");
  const [observedAtSec, setObservedAtSec] = useState(nowUnixSec()); // 必須（u64秒）

  // Keplr / Client
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [owner, setOwner] = useState("");
  const clientRef = useRef(null);
  const [rpcUrlUsed, setRpcUrlUsed] = useState("");

  // 送信
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [message, setMessage] = useState("");

  // 計測：QR読取時刻 → Txハッシュ取得時刻
  const [scanStartedAt, setScanStartedAt] = useState(null); // ms (Date.now)
  const [metrics, setMetrics] = useState([]);               // 記録配列

  // 初回ロードでメトリクス復元
  useEffect(() => { setMetrics(loadMetrics()); }, []);

  // ステップ完了条件
  const step1Done = useMemo(
    () => Boolean(name && description && uniqueId && qrId && Number.isFinite(Number(observedAtSec))),
    [name, description, uniqueId, qrId, observedAtSec]
  );
  const step2Done = connected;
  const step3Ready = step1Done && step2Done;

  // ===== QR成功時：name / description / unique_id / qr_id / observed_at を取り込み =====
  const handleQrScanSuccess = (decodedText) => {
    setLastQrRaw(decodedText);
    try {
      const j = JSON.parse(decodedText);
      const n = j.name ?? j.title ?? "";
      const d = j.description ?? j.desc ?? j.detail ?? "";
      const u = j.unique_id ?? j.uniqueId ?? j.uid ?? "";
      const q = j.qr_id ?? j.qrId ?? j.qrid ?? j.qr ?? "";

      if (n) setName(String(n));
      if (d) setDescription(String(d));
      setUniqueId(String(u || ""));
      setQrId(String(q || ""));

      if (j.observed_at != null) {
        if (typeof j.observed_at === "number") setObservedAtSec(j.observed_at);
        else if (typeof j.observed_at === "string") {
          const t = Date.parse(j.observed_at);
          if (Number.isFinite(t)) setObservedAtSec(Math.floor(t / 1000));
        }
      }

      // ★ 計測開始点をセット（ユーザ操作時間も含めた総所要時間）
      setScanStartedAt(Date.now());

      setMessage("✅ QR読み取り完了：name/description ほかをフォームへ反映しました。次は【Step 2】Keplr接続へ。");
    } catch {
      setMessage("⚠️ このQRはJSONではありません。name/description等を含むJSONのQRを読み取ってください。");
    }
    setScannerOpen(false);
  };

  // QRスキャナのライフサイクル（サイズ固定・コンパクト）
  useEffect(() => {
    if (!scannerOpen) return;

    const applyFixedSize = () => {
      setQrWidth(SCAN_PANEL.width);
      setQrHeight(SCAN_PANEL.height);
      return SCAN_PANEL.qrbox;
    };
    let qrboxSide = applyFixedSize();
    const onResize = () => { qrboxSide = applyFixedSize(); };
    window.addEventListener("resize", onResize);

    const scanner = new Html5QrcodeScanner("qr-camera-reader", {
      fps: 10,
      qrbox: { width: qrboxSide, height: qrboxSide },
      aspectRatio: 1.0,
      rememberLastUsedCamera: true,
    });

    scanner.render(
      (decodedText) => { try { scanner.clear(); } catch {} handleQrScanSuccess(decodedText); },
      () => {}
    );

    return () => { window.removeEventListener("resize", onResize); try { scanner.clear(); } catch {} };
  }, [scannerOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // 送信（execute store）：cid は FIXED_CID を常に付与
  const execPayload = useMemo(() => ({
    name,
    description,
    unique_id: uniqueId,
    qr_id: qrId,
    observed_at: Number(observedAtSec),
  }), [name, description, uniqueId, qrId, observedAtSec]);

  const execMsg = useMemo(() => ({
    store: { payload: execPayload, cid: FIXED_CID }
  }), [execPayload]);

  const handleStore = async () => {
    try {
      if (!step3Ready) return;
      setSending(true); setMessage(""); setTxHash("");
      const client = clientRef.current;
      if (!client) throw new Error("Keplrに接続してください。");
      if (!owner) throw new Error("送信者アドレスが未設定です。");

      const execEncodeObj = {
        typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
        value: { sender: owner, contract: CONTRACT_ADDR, msg: toUtf8(JSON.stringify(execMsg)), funds: [] },
      };

      let fee = "auto";
      try {
        const gas = await client.simulate(owner, [execEncodeObj], "store from e-QRpaper");
        const gasPrice = GasPrice.fromString(`${GAS_PRICE_NUM}${DENOM}`);
        fee = calculateFee(Math.round(gas * GAS_ADJ), gasPrice);
      } catch { fee = "auto"; }

      const res = await client.execute(owner, CONTRACT_ADDR, execMsg, fee, "store from e-QRpaper");
      const txhash = res?.transactionHash || res?.hash || "";
      setTxHash(txhash);
      setMessage("✅ 送信しました。");

      // ★ 計測: Tx 取得時に記録
      if (scanStartedAt) {
        const txAt = Date.now();
        const rec = {
          scan_at: scanStartedAt,
          tx_at: txAt,
          ms: txAt - scanStartedAt,
          txhash,
          name,
          description,
          unique_id: uniqueId,
          qr_id: qrId,
        };
        const next = [rec, ...metrics].slice(0, 5000); // 最大5000件保持
        setMetrics(next);
        saveMetrics(next);
      }
    } catch (err) {
      setMessage(`❌ ${err?.message || err}`);
    } finally {
      setSending(false);
    }
  };

  // Keplr 接続（Step 1 完了後に実行可）
  const connectKeplr = async () => {
    try {
      if (!step1Done) { setMessage("⚠️ 先に【Step 1】QRスキャンを完了してください。"); return; }
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
          currencies: [{ coinDenom: DISPLAY_DENOM, coinMinimalDenom: DENOM, coinDecimals: Number(ENV.DENOM_DECIMALS) }],
          feeCurrencies: [{ coinDenom: DISPLAY_DENOM, coinMinimalDenom: DENOM, coinDecimals: Number(ENV.DENOM_DECIMALS), gasPriceStep: { low: 0.01, average: GAS_PRICE_NUM, high: 0.04 } }],
          stakeCurrency: { coinDenom: DISPLAY_DENOM, coinMinimalDenom: DENOM, coinDecimals: Number(ENV.DENOM_DECIMALS) },
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
      setMessage("✅ Keplr接続完了。次は【Step 3】コントラクトへ送信を実行してください。");
    } catch (err) {
      setMessage(`❌ Keplr接続に失敗: ${err?.message || err}`);
    } finally {
      setConnecting(false);
    }
  };

  // ── UI: ステップ見出しカード ──────────────────────────
  const StepCard = ({ step, title, required = true, done, blocked, children }) => (
    <div
      style={{
        border: `2px solid ${done ? "#16a34a" : blocked ? "#dc2626" : "#f59e0b"}`,
        background: done ? "#f0fdf4" : blocked ? "#fef2f2" : "#fffbeb",
        borderRadius: 12,
        padding: 12,
        margin: "12px 8px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div
          style={{
            width: 28, height: 28, borderRadius: 9999,
            background: done ? "#16a34a" : blocked ? "#dc2626" : "#f59e0b",
            color: "#fff", display: "grid", placeItems: "center", fontWeight: 800
          }}
        >
          {step}
        </div>
        <div style={{ fontWeight: 800 }}>
          {title} {required ? <span style={{ color: blocked ? "#dc2626" : "#b45309" }}>(必須)</span> : null}
          {done ? <span style={{ marginLeft: 8, color: "#16a34a", fontWeight: 700 }}>✔ 完了</span> : null}
          {blocked && !done ? <span style={{ marginLeft: 8, color: "#dc2626", fontWeight: 700 }}>※ 先にこの手順を実行してください</span> : null}
        </div>
      </div>
      {children}
    </div>
  );

  // ── Metrics UI ────────────────────────────────────────
  const latest = metrics.slice(0, 50);
  const stat = statsFrom(metrics.map(m=>m.ms)) || { n:0, avg:0, min:0, max:0, med:0, p90:0, p95:0, p99:0 };

  const downloadCsv = () => {
    const csv = toCsv(metrics);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `eqr_metrics_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };
  const resetMetrics = () => {
    if (!confirm("計測記録を全て削除します。よろしいですか？")) return;
    setMetrics([]); saveMetrics([]);
  };

  return (
    <div className="div_base" style={{ minHeight: "100vh", overflowY: "auto" }}>
      <div className="div_header">
        e-QRpaper: <b>必須ステップ</b>を順に実行して送信（Neutron Testnet）
      </div>

      {/* Step 1 */}
      <StepCard
        step={1}
        title="QRコードをスキャンする"
        required
        done={step1Done}
        blocked={!step1Done}
      >
        <div style={{ marginBottom: 8, color: step1Done ? "#166534" : "#b45309" }}>
          スキャン成功時：<code>name</code> / <code>description</code> / <code>unique_id</code> / <code>qr_id</code> / <code>observed_at</code> を自動反映。<br/>
          ※ この時刻が「計測開始時刻」になります（Txハッシュ取得までの総時間を測定）。
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" onClick={() => setScannerOpen((v) => !v)} style={{ padding: "8px 12px", borderRadius: 8 }}>
            {scannerOpen ? "QRスキャナを閉じる" : "QRスキャナを開く"}
          </button>
        </div>
        {scannerOpen && (
          <div className="div_content" style={{ overflow: "hidden", marginTop: 8 }}>
            <div
              id="qr-camera-reader"
              style={{
                width: qrWidth, height: qrHeight, margin: "8px auto",
                border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff",
              }}
            />
          </div>
        )}

        {/* フォーム（編集可） */}
        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          <div>
            name：
            <input style={{ width: "100%" }} value={name} onChange={(e) => setName(e.target.value)} placeholder="(QRから取得 / 手入力可)" />
          </div>
          <div>
            description：
            <input style={{ width: "100%" }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="(QRから取得 / 手入力可)" />
          </div>
          <div>
            unique_id：
            <input style={{ width: "100%" }} value={uniqueId} onChange={(e) => setUniqueId(e.target.value)} placeholder="(QRから取得 / 手入力可)" />
          </div>
          <div>
            qr_id：
            <input style={{ width: "100%" }} value={qrId} onChange={(e) => setQrId(e.target.value)} placeholder="(QRから取得 / 手入力可)" />
          </div>
          <div>
            観測日時（observed_at）：
            <input
              type="datetime-local"
              value={toLocalDatetimeInputValue(observedAtSec)}
              onChange={(e)=>setObservedAtSec(parseLocalDatetimeInputValue(e.target.value))}
              style={{ width: "100%" }}
            />
            <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
              UNIX秒: {observedAtSec} <button type="button" onClick={()=>setObservedAtSec(nowUnixSec())}>現在時刻</button>
            </div>
          </div>
        </div>
      </StepCard>

      {/* Step 2 */}
      <StepCard
        step={2}
        title="Keplr に接続する"
        required
        done={step2Done}
        blocked={!step1Done}
      >
        {!step1Done && <div style={{ color: "#dc2626", marginBottom: 8 }}>※ 先に <b>Step 1: QRスキャン</b> を完了してください。</div>}
        <button
          type="button"
          onClick={async () => {
            if (!step1Done) { setMessage("⚠️ 先に【Step 1】QRスキャンを完了してください。"); return; }
            try {
              setConnecting(true); setMessage("");
              const rpcUrl = await firstReachable(RPC_CANDIDATES, "rpc");
              const restUrl = await firstReachable(REST_CANDIDATES, "rest");
              setRpcUrlUsed(rpcUrl);
              if (!window.keplr) throw new Error("Keplrが見つかりません。");

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
                  currencies: [{ coinDenom: DISPLAY_DENOM, coinMinimalDenom: DENOM, coinDecimals: Number(ENV.DENOM_DECIMALS) }],
                  feeCurrencies: [{ coinDenom: DISPLAY_DENOM, coinMinimalDenom: DENOM, coinDecimals: Number(ENV.DENOM_DECIMALS), gasPriceStep: { low: 0.01, average: GAS_PRICE_NUM, high: 0.04 } }],
                  stakeCurrency: { coinDenom: DISPLAY_DENOM, coinMinimalDenom: DENOM, coinDecimals: Number(ENV.DENOM_DECIMALS) },
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
              setMessage("✅ Keplr接続完了。次は【Step 3】コントラクトへ送信を実行してください。");
            } catch (err) {
              setMessage(`❌ Keplr接続に失敗: ${err?.message || err}`);
            } finally {
              setConnecting(false);
            }
          }}
          disabled={!step1Done || connecting || step2Done}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            fontWeight: 800,
            background: !step1Done ? "#fecaca" : step2Done ? "#86efac" : "#22c55e",
            color: "#111",
            cursor: !step1Done || connecting || step2Done ? "not-allowed" : "pointer",
          }}
        >
          {step2Done ? "接続済み" : connecting ? "接続中…" : "Keplr に接続（必須）"}
        </button>
        {rpcUrlUsed && step2Done && <div style={{ fontSize: 12, color: "#166534", marginTop: 6 }}>RPC: {rpcUrlUsed}</div>}
      </StepCard>

      {/* Step 3 */}
      <StepCard
        step={3}
        title="コントラクトへ送信する"
        required
        done={Boolean(txHash)}
        blocked={!step2Done}
      >
        {!step2Done && <div style={{ color: "#dc2626", marginBottom: 8 }}>※ 先に <b>Step 2: Keplr接続</b> を完了してください。</div>}
        <button
          type="button"
          onClick={handleStore}
          disabled={!step3Ready || sending}
          style={{
            padding: "12px 16px",
            borderRadius: 12,
            fontWeight: 900,
            fontSize: 16,
            background: !step3Ready ? "#fecaca" : "#16a34a",
            color: "#fff",
            boxShadow: "0 2px 0 rgba(0,0,0,0.1)",
            cursor: !step3Ready || sending ? "not-allowed" : "pointer",
          }}
        >
          {sending ? "送信中…" : "store TX を送る（必須・最終）"}
        </button>
        <div style={{ fontSize: 13, marginTop: 8 }}>
          TxHash: {txHash ? (<a href={formatTxLink(txHash)} target="_blank" rel="noreferrer">{txHash}</a>) : "-"}
        </div>
      </StepCard>

      {/* メッセージ */}
      {message && (
        <div style={{ margin: "8px", padding: 10, background: "#f3f7ea", border: "1px solid #ABCE1C", borderRadius: 6 }}>
          {message}
        </div>
      )}

      {/* Metrics 集計表示 */}
      <div style={{ margin: "12px 8px", padding: 12, border: "1px solid #e5e7eb", borderRadius: 10, background: "#fafafa" }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>⏱️ 計測集計（QR→TxHash）</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 14 }}>
          <span>count: <b>{stat.n}</b></span>
          <span>avg: <b>{(stat.avg/1000).toFixed(3)}s</b></span>
          <span>min: <b>{(stat.min/1000).toFixed(3)}s</b></span>
          <span>median: <b>{(stat.med/1000).toFixed(3)}s</b></span>
          <span>p90: <b>{(stat.p90/1000).toFixed(3)}s</b></span>
          <span>p95: <b>{(stat.p95/1000).toFixed(3)}s</b></span>
          <span>max: <b>{(stat.max/1000).toFixed(3)}s</b></span>
        </div>

        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={downloadCsv} disabled={!metrics.length} style={{ padding: "6px 10px", borderRadius: 8 }}>
            CSVダウンロード
          </button>
          <button onClick={resetMetrics} disabled={!metrics.length} style={{ padding: "6px 10px", borderRadius: 8, color: "#b91c1c", border: "1px solid #e5e7eb" }}>
            全削除（リセット）
          </button>
        </div>

        <div style={{ marginTop: 10, borderTop: "1px dashed #ddd", paddingTop: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>最新50件</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f1f5f9" }}>
                  <th style={th}>#</th>
                  <th style={th}>scan_at</th>
                  <th style={th}>tx_at</th>
                  <th style={th}>duration</th>
                  <th style={th}>txhash</th>
                  <th style={th}>unique_id</th>
                  <th style={th}>qr_id</th>
                  <th style={th}>name</th>
                  <th style={th}>description</th>
                </tr>
              </thead>
              <tbody>
                {latest.map((r, i) => (
                  <tr key={`${r.txhash}-${i}`} style={{ background: i%2? "#fff":"#f9fafb" }}>
                    <td style={td}>{metrics.length - i}</td>
                    <td style={td}>{new Date(r.scan_at).toLocaleString()}</td>
                    <td style={td}>{new Date(r.tx_at).toLocaleString()}</td>
                    <td style={td}>{(r.ms/1000).toFixed(3)}s</td>
                    <td style={td}><code style={{fontSize:12}}>{r.txhash}</code></td>
                    <td style={td}><code style={{fontSize:12}}>{r.unique_id}</code></td>
                    <td style={td}><code style={{fontSize:12}}>{r.qr_id}</code></td>
                    <td style={td}>{r.name}</td>
                    <td style={td}>{r.description}</td>
                  </tr>
                ))}
                {!latest.length && (
                  <tr><td style={td} colSpan={9}>(記録なし)</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// 表示用の軽量スタイル
const th = { textAlign:"left", padding:"6px 8px", borderBottom:"1px solid #e5e7eb", fontSize:12 };
const td = { padding:"6px 8px", borderBottom:"1px solid #f3f4f6", fontSize:12 };
