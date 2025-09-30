// src/pages/FaucetPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  Download, RefreshCw, CheckCircle2, AlertTriangle, Copy, ExternalLink, Info, KeyRound, RotateCw,
} from "lucide-react";

// ====== env ======
const API_FAUCET = import.meta.env.VITE_FAUCET_API || "/api/faucet";
const API_BASE = API_FAUCET.replace(/\/faucet$/, ""); // => "/api"
const EXPLORER_TX = import.meta.env.VITE_EXPLORER_TX || "";
const EXPLORER_ACC = import.meta.env.VITE_EXPLORER_ACC || "";

// ====== helpers ======
const getPrefix = (addr = "") => (addr.includes("1") ? addr.split("1")[0] : "");
const fmtSec = (s) => {
  s = Number(s || 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return (h ? `${h}h` : "") + (m ? `${m}m` : "") + (!h && !m ? `${ss}s` : "");
};

// ====== page ======
export default function FaucetPage() {
  // form
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [otp, setOtp] = useState("");

  // server info
  const [info, setInfo] = useState(null);
  const [infoErr, setInfoErr] = useState("");
  const otpRequired = !!info?.otp?.required;

  // action state
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(null);        // true/false/null
  const [txhash, setTxhash] = useState("");
  const [error, setError] = useState("");

  // validation
  const validAddrShape = useMemo(
    () => /^[a-z0-9]+1[ac-hj-np-z02-9]{20,}$/i.test(address.trim()),
    [address]
  );
  const prefixMatch = useMemo(() => {
    if (!info?.prefix || !address) return true;
    return getPrefix(address.trim()) === info.prefix;
  }, [address, info?.prefix]);

  const canSend = validAddrShape && prefixMatch && (!otpRequired || otp.trim().length > 0) && !busy;

  // load server info
  async function loadInfo() {
    try {
      setInfoErr("");
      const r = await fetch(`${API_BASE}/info`, { cache: "no-store" });
      const j = await r.json();
      setInfo(j);
    } catch (e) {
      setInfoErr(e?.message || String(e));
    }
  }
  useEffect(() => {
    loadInfo();
  }, []);

  // copy helper
  async function copy(text) {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); alert("コピーしました"); }
    catch { alert("コピーに失敗しました"); }
  }

  // request faucet
  async function requestFaucet() {
    setBusy(true); setOk(null); setTxhash(""); setError("");
    try {
      const res = await fetch(API_FAUCET, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: address.trim(), note, otp: otp.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setOk(false);
        setError(data.error || `${res.status} ${res.statusText}`);
        return;
      }
      setOk(true);
      setTxhash(data.transactionHash || "");
    } catch (e) {
      setOk(false);
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
      // 成功・失敗に関わらず最新の残量などを再取得
      loadInfo();
    }
  }

  const txUrl = useMemo(() => (EXPLORER_TX && txhash ? EXPLORER_TX.replace(/\/?$/, "/") + txhash : ""), [txhash]);
  const accUrl = useMemo(() => (EXPLORER_ACC && info?.faucetAddress ? EXPLORER_ACC.replace(/\/?$/, "/") + info.faucetAddress : ""), [info?.faucetAddress]);

  return (
    <div className="min-h-screen w-full bg-white text-black p-4 md:p-8">
      <div className="mx-auto max-w-2xl">
        {/* HEADER */}
        <header className="mb-6 flex items-center gap-3">
          <Download className="w-7 h-7" />
          <h1 className="text-2xl font-bold">Faucet（テスト用トークン請求）</h1>
        </header>

        {/* MAIN CARD */}
        <div className="rounded border p-4 space-y-6">
          {/* ==== SERVER INFO (集約表示) ==== */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold">
                <Info className="w-4 h-4" /> サーバ設定（/api/info）
              </div>
              <button onClick={loadInfo} className="inline-flex items-center gap-2 border rounded px-2 py-1 text-sm">
                <RotateCw className="w-4 h-4" /> Refresh
              </button>
            </div>

            {infoErr && (
              <div className="rounded border border-red-600 bg-red-50 p-3 text-sm">{infoErr}</div>
            )}

            {info && (
              <div className="space-y-2">
                <Row k="Faucet Address" v={
                  <span className="flex items-center gap-2">
                    <span className="font-mono break-all">{info.faucetAddress || "-"}</span>
                    {info.faucetAddress && (
                      <>
                        <button onClick={() => copy(info.faucetAddress)} className="border rounded px-2 py-0.5 text-xs"><Copy className="w-3 h-3" /></button>
                        {accUrl && <a className="text-blue-600 underline text-xs inline-flex items-center gap-1" href={accUrl} target="_blank" rel="noreferrer"><ExternalLink className="w-3 h-3" />explorer</a>}
                      </>
                    )}
                  </span>
                }/>
                <Row k="Chain ID" v={info.chainId} />
                <Row k="Prefix" v={info.prefix} />
                <Row k="Denom" v={info.denom} />
                <Row k="RPC URL" v={info.rpcUrl} />
                <Row k="Min Gas Price" v={info.minGasPrice} />
                <Row k="Faucet Amount" v={String(info.faucetAmount)} />
                <Row k="Rate Limit" v={`IP: ${info.maxPerIp}/window, Addr: ${info.maxPerAddr}/window, Window: ${fmtSec(info.windowSec)}`} />
                <Row k="OTP Required" v={String(info.otp?.required)} />
                {info.otp?.required && <Row k="OTP Remaining" v={info.otp?.remaining == null ? "-" : String(info.otp.remaining)} />}
              </div>
            )}

            {/* クライアント側ENVの併記 */}
            <div className="pt-2">
              <div className="font-semibold mb-1">クライアント（Vite env）</div>
              <table className="w-full text-sm">
                <tbody>
                  <Tr k="VITE_FAUCET_API" v={import.meta.env.VITE_FAUCET_API || "/api/faucet"} />
                  <Tr k="VITE_EXPLORER_TX" v={import.meta.env.VITE_EXPLORER_TX || "(なし)"} />
                  <Tr k="VITE_EXPLORER_ACC" v={import.meta.env.VITE_EXPLORER_ACC || "(なし)"} />
                </tbody>
              </table>
            </div>
          </section>

          {/* ==== REQUEST FORM ==== */}
          <section className="space-y-3">
            <div className="font-semibold">請求フォーム</div>

            <div className="space-y-1">
              <label className="block text-sm">受取アドレス / Recipient address</label>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="neutron1..."
                className="w-full border rounded px-3 py-2"
              />
              {!prefixMatch && address && info?.prefix && (
                <p className="text-xs text-red-600">
                  アドレスの prefix（<code>{getPrefix(address)}</code>）がサーバ設定（<code>{info.prefix}</code>）と一致しません。
                </p>
              )}
              {!validAddrShape && address && (
                <p className="text-xs text-red-600">bech32 形式に見えません。スペースや全角文字に注意してください。</p>
              )}
            </div>

            <div className="space-y-1">
              <label className="block text-sm">メモ（任意）/ Memo (optional)</label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="faucet via demo ui"
                className="w-full border rounded px-3 py-2"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-sm flex items-center gap-2">
                <KeyRound className="w-4 h-4" />
                ワンタイムコード / One-time code {otpRequired ? "(必須)" : "(任意)"}
              </label>
              <input
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="例: 9FJ7K2M8B3"
                className="w-full border rounded px-3 py-2"
              />
              {otpRequired && <p className="text-xs text-gray-600">配布されたコードを入力してください。</p>}
            </div>

            <div className="flex gap-3">
              <button
                onClick={requestFaucet}
                disabled={!canSend}
                className="inline-flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded disabled:opacity-60"
              >
                {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {busy ? "送信中…" : "Request faucet（請求）"}
              </button>
            </div>
          </section>

          {/* ==== RESULT ==== */}
          {ok !== null && (
            <div className={`rounded p-3 text-sm flex items-center gap-2 border ${ok ? "border-green-600 bg-green-50" : "border-red-600 bg-red-50"}`}>
              {ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              <span>{ok ? "送付しました / Sent" : `失敗しました / Failed${error ? `: ${error}` : ""}`}</span>
            </div>
          )}

          {txhash && (
            <div className="rounded border p-3 space-y-2">
              <div className="text-xs text-gray-600">txhash</div>
              <div className="flex items-start gap-2">
                <p className="flex-1 font-mono break-all text-sm">{txhash}</p>
                <button onClick={() => copy(txhash)} className="border rounded px-3 py-1.5 text-sm">
                  <Copy className="w-4 h-4" />
                </button>
              </div>
              {txUrl && (
                <a href={txUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-blue-600 underline text-sm">
                  <ExternalLink className="w-4 h-4" /> Open in explorer
                </a>
              )}
            </div>
          )}

          {/* ==== SECURITY NOTE ==== */}
          <section className="rounded border p-3 text-xs">
            セキュリティ: このUIはサーバAPIを呼び出すだけです。秘密鍵はサーバにのみ保管し、クライアントに埋め込まないでください。
          </section>
        </div>
      </div>
    </div>
  );
}

// simple table rows
function Row({ k, v }) {
  return (
    <div className="text-sm flex gap-3">
      <div className="w-40 text-gray-600">{k}</div>
      <div className="flex-1">{typeof v === "string" || typeof v === "number" ? String(v) : v}</div>
    </div>
  );
}
function Tr({ k, v }) {
  return (
    <tr>
      <td className="py-1 pr-4 text-gray-600 align-top">{k}</td>
      <td className="py-1 font-mono break-all">{String(v)}</td>
    </tr>
  );
}
