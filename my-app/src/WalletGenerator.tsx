// src/WalletGeneratorJP.jsx
import React, { useEffect, useMemo, useState } from "react";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { stringToPath } from "@cosmjs/crypto";
import { toHex } from "@cosmjs/encoding";
import {
  Eye, EyeOff, Copy, Download, KeyRound, Shield, RefreshCw, CheckCircle2, X,
} from "lucide-react";

/** チェーンのプリセット（必要に応じて追加OK） */
const CHAIN_PRESETS = {
  neutron:   { name: "Neutron",                 prefix: "neutron", coinType: 118 },
  cosmoshub: { name: "Cosmos Hub",              prefix: "cosmos",  coinType: 118 },
  osmosis:   { name: "Osmosis",                 prefix: "osmo",    coinType: 118 },
  juno:      { name: "Juno",                    prefix: "juno",    coinType: 118 },
  stargaze:  { name: "Stargaze",                prefix: "stars",   coinType: 118 },
  secret:    { name: "Secret Network",          prefix: "secret",  coinType: 529 },
  terra:     { name: "Terra",                   prefix: "terra",   coinType: 330 },
  kava:      { name: "Kava",                    prefix: "kava",    coinType: 459 },
  cryptoorg: { name: "Crypto.org / Cronos POS", prefix: "cro",     coinType: 394 },
};
const DEFAULT_CHAIN_KEY = "neutron";

/** coinType から BIP44 パスを作る */
function pathFrom(coinType, account = 0, change = 0, index = 0) {
  return `m/44'/${coinType}'/${account}'/${change}/${index}`;
}

/** 環境検出（簡易） */
const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
const isIOS = /iPad|iPhone|iPod/.test(ua);
const isInApp = /(FBAN|FBAV|Instagram|Line|LineApp|Twitter|KAKAOTALK)/i.test(ua);
const prefersReducedMotion =
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

export default function WalletGenerator() {
  // チェーン選択 & 詳細設定トグル
  const [chainKey, setChainKey] = useState(DEFAULT_CHAIN_KEY);
  const [advanced, setAdvanced] = useState(false);

  // パラメータ
  const [prefix, setPrefix] = useState(CHAIN_PRESETS[DEFAULT_CHAIN_KEY].prefix);
  const [wordCount, setWordCount] = useState(24);
  const [hdPath, setHdPath] = useState(pathFrom(CHAIN_PRESETS[DEFAULT_CHAIN_KEY].coinType));

  // 生成結果
  const [mnemonic, setMnemonic] = useState("");
  const [address, setAddress] = useState("");
  const [pubkeyHex, setPubkeyHex] = useState("");

  // UI 状態
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false); // .json 保存できたら完了
  const [banner, setBanner] = useState(isInApp); // in-app ブラウザ注意
  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);

  // keystore 用パスワード
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");

  const canEncrypt = useMemo(
    () => mnemonic && password.length >= 8 && password === password2,
    [mnemonic, password, password2]
  );

  // 離脱警告（ニーモニック生成済み & 未完了）
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (mnemonic && !done) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [mnemonic, done]);

  // チェーン選択が変わったら（詳細設定OFFのときだけ）自動反映
  useEffect(() => {
    const preset = CHAIN_PRESETS[chainKey];
    if (!preset) return;
    if (!advanced) {
      setPrefix(preset.prefix);
      setHdPath(pathFrom(preset.coinType, 0, 0, 0));
    }
  }, [chainKey, advanced]);

  function scrollToTop() {
    const el = document.getElementById("top");
    if (el?.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
    else {
      try { window.scrollTo({ top: 0, behavior: "smooth" }); }
      catch { window.scrollTo(0, 0); }
    }
  }

  async function generateWallet() {
    setBusy(true);
    setError("");
    try {
      const path = stringToPath(hdPath);
      const wallet = await DirectSecp256k1HdWallet.generate(Number(wordCount), {
        prefix,
        hdPaths: [path],
      });
      const m = wallet.mnemonic;
      const [acc] = await wallet.getAccounts();
      setMnemonic(m);
      setAddress(acc.address);
      setPubkeyHex(acc.pubkey ? toHex(acc.pubkey) : "");
      setShowMnemonic(false);
      setDone(false); // 新規生成時は完了フラグを戻す
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  // クリップボード：HTTPS/localhost→ClipboardAPI、その他→execCommand フォールバック
  async function copy(text) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast("コピーしました");
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) throw new Error("execCommand failed");
        toast("コピーしました");
      } catch (e) {
        alert("コピーに失敗しました。HTTPS（または http://localhost）で開いてください。");
        console.error(e);
      }
    }
  }

  // ダウンロード：Blob → 失敗時 data:URL フォールバック（iOS対策）
  function download(filename, content, mime = "text/plain;charset=utf-8") {
    try {
      const blob = new Blob([content], { type: mime });

      // 旧 Edge
      if (window.navigator && "msSaveOrOpenBlob" in window.navigator) {
        // @ts-ignore
        window.navigator.msSaveOrOpenBlob(blob, filename);
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 0);
    } catch (e) {
      try {
        const a = document.createElement("a");
        a.href = `data:${mime},${encodeURIComponent(content)}`;
        a.download = filename;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch (err) {
        alert(".txt の保存に失敗しました。別ブラウザ/HTTPSでお試しください。");
        console.error(err);
      }
    }
  }

  function downloadMnemonicTxt() {
    if (!mnemonic) return;
    const body = `# CosmJS mnemonic (DO NOT SHARE) / 絶対に共有しないでください
# prefix=${prefix}
# path=${hdPath}

${mnemonic}
`;
    download("cosmos_mnemonic.txt", body);
  }

  // --- Crypto helpers (AES-GCM + PBKDF2) ---
  async function deriveAesKey(pass, salt) {
    const enc = new TextEncoder();
    const material = await crypto.subtle.importKey("raw", enc.encode(pass), { name: "PBKDF2" }, false, ["deriveKey"]);
    return await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: 250000 },
      material,
      { name: "AES-GCM", length: 256 },
      false, ["encrypt", "decrypt"]
    );
  }
  function randBytes(n) { const u8 = new Uint8Array(n); crypto.getRandomValues(u8); return u8; }
  function b64(u8) { let s = ""; u8.forEach((b) => (s += String.fromCharCode(b))); return btoa(s); }

  async function encryptMnemonic() {
    if (!mnemonic) return;
    if (!canEncrypt) {
      alert("パスワード要件を満たしていません（8文字以上・確認一致）/ Password must be 8+ chars and match");
      return;
    }
    const salt = randBytes(16);
    const iv   = randBytes(12);
    const key  = await deriveAesKey(password, salt);
    const enc  = new TextEncoder();
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(mnemonic));
    const out = {
      version: 1,
      kdf: { algo: "PBKDF2", hash: "SHA-256", iterations: 250000, salt: b64(salt) },
      cipher: { algo: "AES-GCM", iv: b64(iv), ciphertext: b64(new Uint8Array(cipher)) },
      meta: {
        bech32Prefix: prefix,
        hdPath,
        createdAt: new Date().toISOString(),
        note: "Decrypt with WebCrypto / ブラウザWebCryptoで復号",
      },
      address,
      pubkeyHex,
    };
    download("cosmos_keystore.json", JSON.stringify(out, null, 2), "application/json");
    setDone(true);                    // 完了
    setTimeout(scrollToTop, 50);      // 直後に最上部へ
    toast(isIOS
      ? "保存しました。ファイルAppに保存されているか確認してください。"
      : "保存しました。ダウンロードフォルダを確認してください。"
    );
  }

  function resetAll() {
    setMnemonic("");
    setAddress("");
    setPubkeyHex("");
    setPassword("");
    setPassword2("");
    setShowMnemonic(false);
    setError("");
    setDone(false);
  }

  function toast(msg) {
    // シンプルなトースト（モバイル向けに大きめ）
    const d = document.createElement("div");
    d.textContent = msg;
    d.style.cssText =
      "position:fixed;left:50%;bottom:12px;transform:translateX(-50%);background:#111827;color:#E5E7EB;padding:10px 14px;border-radius:12px;z-index:9999;font-size:14px;max-width:90%;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.4)";
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 1800);
  }

  const spin = busy && !prefersReducedMotion ? "animate-spin" : "";

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 py-10 px-4"
         style={{ paddingTop: "max(1rem, env(safe-area-inset-top))", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="mx-auto max-w-3xl">
        <header id="top" className="mb-4 flex items-center gap-3">
          <KeyRound className="w-8 h-8" />
          <h1 className="text-2xl font-bold">CosmJS Wallet Generator（ウォレット生成）</h1>
        </header>

        {/* In-App ブラウザ注意（スマホ想定） */}
        {banner && (
          <div className="mb-4 rounded-xl border border-yellow-700 bg-yellow-900/30 text-yellow-100 p-3 flex items-start gap-2">
            <span className="mt-0.5">⚠️</span>
            <div className="text-sm leading-relaxed">
              アプリ内ブラウザではダウンロードやクリップボードが制限される場合があります。Safari/Chrome で開くと確実です。
              <div className="text-xs opacity-80 mt-1">Open in Safari/Chrome for reliable downloads & clipboard.</div>
            </div>
            <button onClick={() => setBanner(false)} className="ml-auto opacity-80 hover:opacity-100" aria-label="close">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 shadow-xl p-4 md:p-6 space-y-6">
          {/* === 完了バナー === */}
          {done && (
            <div className="rounded-xl border border-emerald-700 bg-emerald-900/30 text-emerald-100 p-4 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 mt-0.5" />
              <div>
                <div className="font-semibold">完了 / Done</div>
                <p className="text-sm mt-1">
                  keystore <code>.json</code> を保存しました。復元にはこのファイルとパスワードが必要です。
                </p>
                <button
                  onClick={() => { resetAll(); }}
                  className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-slate-800 hover:bg-slate-700 px-4 py-3 text-base font-medium"
                  style={{ touchAction: "manipulation" }}
                >
                  もう一度作る / Make another
                </button>
              </div>
            </div>
          )}

          {/* === チェーン選択 & 詳細設定トグル === */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Chain select */}
            <div className="md:col-span-2">
              <label className="block text-sm text-slate-300 mb-1">Chain（チェーン）</label>
              <select
                value={chainKey}
                onChange={(e) => setChainKey(e.target.value)}
                disabled={done}
                className="w-full text-base rounded-xl bg-slate-800 border border-slate-700 px-3 py-3 outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-60"
              >
                {Object.entries(CHAIN_PRESETS).map(([key, c]) => {
                  const label = `${c.name} — prefix ${c.prefix} / coin_type ${c.coinType}` + (key !== "neutron" ? " 工事中" : "");
                  return (
                    <option key={key} value={key}>{label}</option>
                  );
                })}
              </select>
              <p className="mt-1 text-xs text-slate-400">
                選択したチェーンに応じて Prefix と HD Path を自動設定します（通常はこのままでOK）。
              </p>
            </div>

            {/* Advanced toggle */}
            <div className="md:col-span-1 flex items-end">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={advanced}
                  onChange={(e) => setAdvanced(e.target.checked)}
                  disabled={done}
                  className="h-5 w-5 accent-cyan-500 disabled:opacity-60"
                />
                Advanced settings（詳細設定：オンで手動編集可）
              </label>
            </div>

            {/* Prefix */}
            <div>
              <label className="block text-sm text-slate-300 mb-1">Bech32 Prefix（接頭辞）</label>
              <input
                value={prefix}
                onChange={(e) => setPrefix(e.target.value.trim())}
                disabled={!advanced || done}
                className="w-full text-base rounded-xl bg-slate-800 border border-slate-700 px-3 py-3 outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-60"
                placeholder="neutron"
                autoComplete="off" autoCorrect="off" spellCheck={false}
              />
              {!advanced && (
                <p className="mt-1 text-xs text-slate-400">通常は変更不要（Neutron は neutron）。</p>
              )}
            </div>

            {/* Word Count（ユーザ選択OK） */}
            <div>
              <label className="block text-sm text-slate-300 mb-1">Word Count（ニーモニック語数）</label>
              <select
                value={wordCount}
                onChange={(e) => setWordCount(Number(e.target.value))}
                disabled={done}
                className="w-full text-base rounded-xl bg-slate-800 border border-slate-700 px-3 py-3 outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-60"
              >
                <option value={12}>12 words（12語）</option>
                <option value={24}>24 words（24語）</option>
              </select>
              <p className="mt-1 text-xs text-slate-400">推奨：24語（より高いエントロピー）。</p>
            </div>

            {/* HD Path */}
            <div>
              <label className="block text-sm text-slate-300 mb-1">HD Path (BIP44)（HDパス）</label>
              <input
                value={hdPath}
                onChange={(e) => setHdPath(e.target.value)}
                disabled={!advanced || done}
                className="w-full text-base rounded-xl bg-slate-800 border border-slate-700 px-3 py-3 outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-60"
                placeholder="m/44'/118'/0'/0/0"
                autoComplete="off" autoCorrect="off" spellCheck={false}
              />
              {!advanced && (
                <p className="mt-1 text-xs text-slate-400">
                  通常は <code>m/44'/118'/0'/0/0</code> のままで問題ありません（Cosmos系既定）。
                </p>
              )}
            </div>
          </section>

          {/* === アクション === */}
          <section className="flex flex-wrap gap-3">
            <button
              onClick={generateWallet}
              disabled={busy || done}
              className="inline-flex items-center gap-2 rounded-2xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 px-4 py-3 text-base font-medium"
              style={{ touchAction: "manipulation" }}
            >
              <RefreshCw className={`w-4 h-4 ${spin}`} />
              {busy ? "Generating...（生成中）" : "Generate Wallet（ウォレット生成）"}
            </button>
            <button
              onClick={resetAll}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-800 hover:bg-slate-700 px-4 py-3 text-base font-medium"
              style={{ touchAction: "manipulation" }}
            >
              Reset（リセット）
            </button>
          </section>

          {/* === エラー === */}
          {error && (
            <div className="rounded-xl border border-rose-800/60 bg-rose-900/30 text-rose-200 p-3 text-sm">
              エラー / Error: {error}
            </div>
          )}

          {/* === ニーモニック === */}
          <section className="grid grid-cols-1 gap-4">
            <div className="rounded-xl border border-slate-800/60 bg-slate-900/40 p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-slate-200">Mnemonic（BIP39 ニーモニック）</h3>
                <button
                  onClick={() => setShowMnemonic((s) => !s)}
                  disabled={!mnemonic || done}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-60 px-3 py-2"
                  title={showMnemonic ? "Hide / 隠す" : "Reveal / 表示"}
                  style={{ touchAction: "manipulation" }}
                >
                  {showMnemonic ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  {showMnemonic ? "Hide / 隠す" : "Reveal / 表示"}
                </button>
              </div>
              <p className="text-xs text-slate-400 mb-2">
                ※ 絶対に他人と共有しないでください（Never share your mnemonic）。クラウド保存やスクショもNG（No cloud or screenshots）。
              </p>
              <div className="rounded-xl bg-slate-950/40 border border-slate-800 p-3">
                <p className={`font-mono break-words text-sm ${showMnemonic ? "blur-0" : "blur-sm select-none"}`}>
                  {mnemonic || "(まだ生成していません / Not generated yet)"}
                </p>
              </div>
              <div className="mt-3 flex gap-3">
                <button
                  onClick={() => copy(mnemonic)}
                  disabled={!mnemonic} // 完了後もコピー可
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-60 px-3 py-2"
                  style={{ touchAction: "manipulation" }}
                >
                  <Copy className="w-4 h-4" /> Copy（コピー）
                </button>
                <button
                  onClick={downloadMnemonicTxt}
                  disabled={!mnemonic} // 完了後もDL可
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-60 px-3 py-2"
                  style={{ touchAction: "manipulation" }}
                >
                  <Download className="w-4 h-4" /> Download .txt（テキスト保存）
                </button>
              </div>
            </div>

            {/* === Address & Pubkey === */}
            <div className="rounded-xl border border-slate-800/60 bg-slate-900/40 p-4">
              <h3 className="font-semibold text-slate-200 mb-2">Address & Public Key（アドレスと公開鍵）</h3>
              <div className="space-y-2">
                <Field label="Address（アドレス）" value={address} onCopy={() => copy(address)} />
                <Field label="HD Path（HDパス）" value={hdPath} onCopy={() => copy(hdPath)} />
                <Field label="Pubkey (hex)（公開鍵16進）" value={pubkeyHex} onCopy={() => copy(pubkeyHex)} />
              </div>
            </div>

            {/* === 暗号化保存 === */}
            <div className="rounded-xl border border-slate-800/60 bg-slate-900/40 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-4 h-4" />
                <h3 className="font-semibold text-slate-200">
                  Encrypt & Download Keystore (.json)（暗号化してJSON保存）
                </h3>
              </div>
              <p className="text-xs text-slate-400 mb-3">
                ブラウザのWebCryptoでAES-GCM暗号化し、JSONとして保存します（PBKDF2/SHA-256, 250k iterations）。
                / Encrypted with browser WebCrypto (AES-GCM, PBKDF2/SHA-256, 250k iterations).
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="relative">
                  <input
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={done}
                    placeholder="Password (8+ chars)（8文字以上）"
                    className="w-full text-base pr-10 rounded-xl bg-slate-800 border border-slate-700 px-3 py-3 outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-60"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 opacity-80 hover:opacity-100"
                    aria-label="toggle password"
                    style={{ touchAction: "manipulation" }}
                  >
                    {showPw ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPw2 ? "text" : "password"}
                    value={password2}
                    onChange={(e) => setPassword2(e.target.value)}
                    disabled={done}
                    placeholder="Confirm Password（確認）"
                    className="w-full text-base pr-10 rounded-xl bg-slate-800 border border-slate-700 px-3 py-3 outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-60"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw2((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 opacity-80 hover:opacity-100"
                    aria-label="toggle confirm password"
                    style={{ touchAction: "manipulation" }}
                  >
                    {showPw2 ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
              <div className="mt-3">
                <button
                  onClick={encryptMnemonic}
                  disabled={!canEncrypt || done}
                  className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 px-4 py-3 text-base font-medium"
                  style={{ touchAction: "manipulation" }}
                >
                  <Download className="w-4 h-4" /> Encrypt & Download .json（暗号化保存）
                </button>
              </div>
            </div>
          </section>
        </div>

        <footer className="mt-6 text-xs text-slate-500">
          Built with CosmJS (@cosmjs/proto-signing). This UI does not keep any state after refresh. / CosmJS で実装。ページを更新しても状態は保持されません（ステートレス）。
        </footer>
      </div>
    </div>
  );
}

function Field({ label, value, onCopy }) {
  return (
    <div>
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <div className="flex-1 rounded-xl bg-slate-950/40 border border-slate-800 px-3 py-2 font-mono text-sm break-all">
          {value || "-"}
        </div>
        <button
          onClick={onCopy}
          disabled={!value}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-60 px-3 py-2"
          style={{ touchAction: "manipulation" }}
        >
          <Copy className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
