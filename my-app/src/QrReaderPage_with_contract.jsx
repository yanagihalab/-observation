// src/fetchContractTxs.jsx
import React, { useEffect, useMemo, useState } from "react";
import { HttpClient } from "@cosmjs/tendermint-rpc";
import { CosmWasmClient } from "@cosmjs/cosmwasm-stargate";

/* ============================
 * RPC utils (tx_search で一覧)
 * ============================ */

/** tx_search でコントラクト関連Txを1ページ取得（REST不使用） */
async function QrReaderPage_with_contract({
  rpc,
  addr,
  page = 1,
  perPage = 50,
  withBlockTime = true,
  forceMode, // "wasm._contract_address" | "message.contract_address" | "message.module" | undefined
}) {
  const client = new HttpClient(rpc);
  let mode = forceMode || "wasm._contract_address";

  const call = async (queryStr) => {
    const req = {
      jsonrpc: "2.0",
      id: 1,
      method: "tx_search",
      params: {
        query: queryStr,
        prove: false,
        page: String(page),
        per_page: String(perPage),
        order_by: "desc",
      },
    };
    return await client.execute(req);
  };

  const q1 = `wasm._contract_address='${addr}'`;
  const q2 = `message.contract_address='${addr}'`;
  const q3 = `message.module='wasm' AND message.contract_address='${addr}'`;

  // 1発目
  let queryUsed = mode === "message.contract_address" ? q2 : mode === "message.module" ? q3 : q1;
  let res = await call(queryUsed);
  let txs = res?.result?.txs ?? [];
  let total = Number(res?.result?.total_count ?? 0);

  // 最初のページで0件なら段階的にフォールバック
  if (!forceMode && page === 1 && txs.length === 0) {
    for (const q of [q2, q3]) {
      const r = await call(q);
      const cand = r?.result?.txs ?? [];
      if (cand.length > 0) {
        res = r; txs = cand; total = Number(r?.result?.total_count ?? 0); queryUsed = q; break;
      }
    }
  }

  // ブロック時間（必要時のみ）
  let timeByHeight = {};
  if (withBlockTime && txs.length > 0) {
    const heights = Array.from(new Set(txs.map((t) => Number(t.height))));
    for (const h of heights) {
      try {
        const r = await fetch(`${rpc}/block?height=${h}`);
        const j = await r.json();
        timeByHeight[h] = j?.result?.block?.header?.time || "";
      } catch { timeByHeight[h] = ""; }
      await sleep(40);
    }
  }

  const rows = txs.map((t) => ({
    hashB64: t.hash,
    hashHex: base64ToHex(t.hash),
    height: Number(t.height),
    code: Number(t.tx_result?.code ?? 0),
    time: withBlockTime ? (timeByHeight[Number(t.height)] || "") : "",
    // クリック時に id を抽出するため保持（tx_search側のevents）
    events: t.tx_result?.events ?? [],
  }));

  return { rows, total, modeUsed: queryUsed };
}

/** /tx?hash=0xHEX でイベントを引き直す（-b sync 直後の空log対策） */
async function fetchTxByHash({ rpc, hashHex }) {
  if (!hashHex) return null;
  try {
    const r = await fetch(`${rpc}/tx?hash=0x${hashHex}&prove=false`);
    if (!r.ok) return null;
    const j = await r.json();
    // tendermint RPC 形式： j.result.tx_result.events[]
    const evs = j?.result?.tx_result?.events ?? [];
    return Array.isArray(evs) ? evs : null;
  } catch {
    return null;
  }
}

/** events から id を抽出（b64/プレーン両対応）*/
function extractIdFromEvents(events) {
  for (const ev of events || []) {
    if (ev.type !== "wasm") continue;
    for (const attr of ev.attributes || []) {
      if (attr.key === "id") {
        const n = Number(attr.value);
        if (Number.isFinite(n)) return n;
      }
      const k = b64try(attr.key);
      const v = b64try(attr.value);
      if (k === "id") {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
    }
  }
  return null;
}

/* ============================
 * Contract Smart Query (List 全ページ → CID一覧)
 * ============================ */

/** コントラクトの List をページングして id/cid 一覧を収集 */
async function fetchAllCids({ rpc, addr, pageSize = 500 }) {
  const client = await CosmWasmClient.connect(rpc);
  const out = [];
  let start_after = null;
  while (true) {
    // {"list":{"limit":..., "start_after":<id>}}
    const query = start_after == null
      ? { list: { limit: pageSize } }
      : { list: { limit: pageSize, start_after } };
    const res = await client.queryContractSmart(addr, query);
    const records = res?.records ?? [];
    for (const r of records) {
      // このコントラクトは StoredRecord に cid が必須で含まれます
      out.push({ id: r.id, cid: r.cid || "" });
    }
    const next = res?.next_start_after ?? null;
    if (!next) break;
    start_after = next;
    await sleep(20);
  }
  // id昇順で整列（任意）
  out.sort((a, b) => a.id - b.id);
  return out;
}

/** helpers */
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function base64ToHex(b64) {
  try {
    if (typeof window === "undefined") {
      // eslint-disable-next-line no-undef
      return Buffer.from(b64, "base64").toString("hex").toUpperCase();
    }
    const bin = atob(b64);
    let out = "";
    for (let i = 0; i < bin.length; i++) out += bin.charCodeAt(i).toString(16).padStart(2, "0");
    return out.toUpperCase();
  } catch { return ""; }
}
function b64try(s) {
  try {
    const dec = atob(s);
    return /^[\x09\x0A\x0D\x20-\x7E]+$/.test(dec) ? dec : s;
  } catch { return s; }
}

/* ============================
 * Component
 * ============================ */

export default function TxListTester() {
  // 入力
  const [rpc, setRpc] = useState("https://rpc-palvus.pion-1.ntrn.tech:443");
  const [addr, setAddr] = useState("neutron1j960c7dr8jc7tfnr7d4zx6xfgy5wme4xrg06gkwuyaf8jljsqhwq470v66");
  const [perPage, setPerPage] = useState(50);
  const [withTime, setWithTime] = useState(true);

  // 一覧状態（tx_search）
  const [page, setPage] = useState(1);
  const [modeUsed, setModeUsed] = useState("wasm._contract_address");
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Payload 詳細
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailId, setDetailId] = useState(null);
  const [detailCid, setDetailCid] = useState("");
  const [detailPayload, setDetailPayload] = useState("");

  // CID 一覧
  const [cidLoading, setCidLoading] = useState(false);
  const [cidError, setCidError] = useState("");
  const [cidRows, setCidRows] = useState([]); // [{id,cid}...]
  const [cidFilter, setCidFilter] = useState(""); // 検索（部分一致）

  const maxPer = useMemo(() => Math.max(1, Math.min(100, Number(perPage) || 50)), [perPage]);
  const totalPages = useMemo(() => (total > 0 ? Math.ceil(total / maxPer) : 1), [total, maxPer]);

  const load = async (opts = {}) => {
    setLoading(true); setErr("");
    try {
      const targetPage = opts.page ?? page;
      const forceMode =
        targetPage === 1
          ? undefined
          : (modeUsed.includes("message.contract_address")
              ? "message.contract_address"
              : modeUsed.includes("message.module")
                ? "message.module"
                : "wasm._contract_address");
      const res = await fetchContractTxsPage({
        rpc: rpc.trim().replace(/\/$/, ""),
        addr: addr.trim(),
        page: targetPage,
        perPage: maxPer,
        withBlockTime: withTime,
        forceMode,
      });
      setRows(res.rows);
      setTotal(res.total);
      setModeUsed(res.modeUsed);
      if (opts.page !== undefined) setPage(opts.page);
    } catch (e) {
      console.error(e); setErr(e?.message || String(e));
      setRows([]); setTotal(0);
    } finally { setLoading(false); }
  };

  useEffect(() => { load({ page: 1 }); /* eslint-disable-next-line */ }, []);

  const canPrev = page > 1;
  const canNext = page < totalPages;

  // 行クリック → events から id → get{id}
  const onRowClick = async (r) => {
    setDetailLoading(true); setDetailError(""); setDetailId(null); setDetailCid(""); setDetailPayload("");
    try {
      let id = extractIdFromEvents(r.events);

      // -b sync 直後などでevents空のとき、/tx?hash=0xHEX で再取得して再抽出
      if ((id == null || Number.isNaN(id)) && r.hashHex) {
        const freshEvents = await fetchTxByHash({ rpc: rpc.trim().replace(/\/$/, ""), hashHex: r.hashHex });
        if (freshEvents && freshEvents.length) {
          id = extractIdFromEvents(freshEvents);
        }
      }

      if (id == null || Number.isNaN(id)) {
        throw new Error("このTxのwasmイベントから id を抽出できませんでした（インデックス未完了/Store以外の可能性）");
      }

      const cw = await CosmWasmClient.connect(rpc.trim().replace(/\/$/, ""));
      const rec = await cw.queryContractSmart(addr.trim(), { get: { id } });
      setDetailId(id);
      setDetailCid(rec?.record?.cid || rec?.cid || "");
      const payload = rec?.record?.payload ?? rec?.payload ?? null;
      setDetailPayload(JSON.stringify(payload, null, 2));
    } catch (e) {
      console.error(e); setDetailError(`${e?.message || e}`);
    } finally { setDetailLoading(false); }
  };

  // CID一覧ロード
  const onLoadCids = async () => {
    setCidLoading(true); setCidError(""); setCidRows([]);
    try {
      const list = await fetchAllCids({ rpc: rpc.trim().replace(/\/$/, ""), addr: addr.trim(), pageSize: 500 });
      setCidRows(list);
    } catch (e) {
      console.error(e); setCidError(e?.message || String(e));
    } finally { setCidLoading(false); }
  };

  const copyCidList = async () => {
    const text = cidRows.map(r => `${r.id}\t${r.cid}`).join("\n");
    await navigator.clipboard.writeText(text);
    alert("Copied CID list (TSV)");
  };
  const downloadCidCsv = () => {
    const header = "id,cid\n";
    const body = cidRows.map(r => `${r.id},"${(r.cid || "").replace(/"/g,'""')}"`).join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `cid_list_${addr.slice(0,8)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const filteredCids = useMemo(() => {
    const q = cidFilter.trim();
    if (!q) return cidRows;
    return cidRows.filter(r =>
      String(r.id).includes(q) || (r.cid || "").toLowerCase().includes(q.toLowerCase())
    );
  }, [cidRows, cidFilter]);

  /* ============================
   * Render (white theme + scrollable)
   * ============================ */
  return (
    <div style={{ padding: 16, color: "#000", background: "#fff", minHeight: "100vh" }}>
      <h2 style={{ marginTop: 0 }}>Contract Tx List (RPC only) + Payload Viewer + CID List</h2>
      <p style={{ marginTop: 4, opacity: 0.8, fontSize: 13 }}>
        Executeメッセージ例（順序）：<code>{"{store:{payload:{...}, cid:\"…\"}}"}</code>
      </p>

      {/* Controls */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto", gap: 8, maxWidth: 1200 }}>
        <input value={rpc} onChange={(e) => setRpc(e.target.value)} placeholder="RPC endpoint" style={inputLight} />
        <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Contract address" style={{ ...inputLight, minWidth: 420 }} />
        <input type="number" min={1} max={100} value={maxPer} onChange={(e) => setPerPage(e.target.value)} title="per page" style={{ ...inputLight, width: 120 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={withTime} onChange={(e) => setWithTime(e.target.checked)} />
          Block time
        </label>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <button onClick={() => load({ page: 1 })} disabled={loading} style={btnLight}>Reload</button>
        <button onClick={() => load({ page: page - 1 })} disabled={loading || !canPrev} style={btnLight}>◀ Prev</button>
        <button onClick={() => load({ page: page + 1 })} disabled={loading || !canNext} style={btnLight}>Next ▶</button>
        <span style={{ opacity: 0.75, fontSize: 12 }}>
          page {page}/{totalPages} | total {total} | query: <code>{modeUsed}</code>
        </span>
      </div>

      {err && <div style={{ marginTop: 8, color: "#b91c1c" }}>Error: <code>{err}</code></div>}

      {/* List (scrollable area) */}
      <div style={{ overflowX: "auto", overflowY: "auto", marginTop: 12, maxHeight: "50vh", border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900, background: "#fff", color: "#111" }}>
          <thead>
            <tr style={{ background: "#f5f5f5" }}>
              <th style={thLight}>#</th>
              <th style={thLight}>Hash (b64)</th>
              <th style={thLight}>Hash (hex)</th>
              <th style={thLight}>Height</th>
              <th style={thLight}>Time (UTC)</th>
              <th style={thLight}>Code</th>
              <th style={thLight}>Mintscan</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.hashB64}-${i}`} onClick={() => onRowClick(r)} style={{ cursor: "pointer" }}>
                <td style={tdLight}>{(page - 1) * maxPer + i + 1}</td>
                <td style={tdLight}><code style={{ fontSize: 12 }}>{r.hashB64}</code></td>
                <td style={tdLight}><code style={{ fontSize: 12 }}>{r.hashHex}</code></td>
                <td style={tdLight}>{r.height}</td>
                <td style={tdLight}>{r.time ? r.time.replace("T"," ").replace("Z","") : ""}</td>
                <td style={{ ...tdLight, color: r.code === 0 ? "#059669" : "#dc2626", fontWeight: 600 }}>{r.code === 0 ? "OK" : `ERR ${r.code}`}</td>
                <td style={tdLight} onClick={(e)=>e.stopPropagation()}>
                  {r.hashHex ? (
                    <a href={`https://www.mintscan.io/neutron-testnet/tx/${r.hashHex}`} target="_blank" rel="noreferrer">Open</a>
                  ) : (
                    <a href={`https://www.mintscan.io/neutron-testnet/txs?txHash=${encodeURIComponent(r.hashB64)}`} target="_blank" rel="noreferrer">Open</a>
                  )}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (<tr><td colSpan={7} style={{ ...tdLight, opacity: 0.7 }}>No results</td></tr>)}
          </tbody>
        </table>
      </div>

      {/* Payload Viewer (white + scrollable) */}
      <div style={{ marginTop: 16 }}>
        <h3>Payload</h3>
        {detailLoading && <div>Loading payload…</div>}
        {detailError && <div style={{ color: "#b91c1c" }}>Error: {detailError}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, maxWidth: 1200 }}>
          {detailId != null && (
            <div style={{ fontSize: 14 }}>
              <b>ID</b>: {detailId}
              {detailCid ? (<span style={{ marginLeft: 12 }}><b>CID</b>: <code>{detailCid}</code></span>) : null}
            </div>
          )}
          <pre style={{ ...preWhite, maxHeight: "45vh", overflowY: "auto" }}>
{detailPayload || "// click a tx row (ExecuteMsg::Store) to load payload by id"}
          </pre>
        </div>
      </div>

      {/* CID List（Listクエリで全件） */}
      <div style={{ marginTop: 24 }}>
        <h3>CID List</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <button onClick={onLoadCids} disabled={cidLoading} style={btnLight}>{cidLoading ? "Loading..." : "Load CIDs"}</button>
          <input value={cidFilter} onChange={(e)=>setCidFilter(e.target.value)} placeholder="filter: id or CID substring" style={{ ...inputLight, minWidth: 320 }} />
          <button onClick={copyCidList} disabled={!cidRows.length} style={btnLight}>Copy (TSV)</button>
          <button onClick={downloadCidCsv} disabled={!cidRows.length} style={btnLight}>Download CSV</button>
          <span style={{ opacity: 0.75, fontSize: 12 }}>total: {cidRows.length} / shown: {filteredCids.length}</span>
        </div>
        {cidError && <div style={{ color: "#b91c1c", marginBottom: 8 }}>Error: {cidError}</div>}
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden", background: "#fff", maxHeight: "45vh", overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", color: "#111" }}>
            <thead>
              <tr style={{ background: "#f5f5f5" }}>
                <th style={thLight}>ID</th>
                <th style={thLight}>CID</th>
              </tr>
            </thead>
            <tbody>
              {filteredCids.map((r)=>(
                <tr key={r.id}>
                  <td style={tdLight}>{r.id}</td>
                  <td style={{ ...tdLight, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" }}>
                    <code>{r.cid}</code>
                  </td>
                </tr>
              ))}
              {!cidLoading && !filteredCids.length && (<tr><td colSpan={2} style={{ ...tdLight, opacity: 0.7 }}>No CIDs</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// "neutron1j960c7dr8jc7tfnr7d4zx6xfgy5wme4xrg06gkwuyaf8jljsqhwq470v66"

/* ---- styles ---- */
const inputLight = {
  padding: "8px 10px",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  background: "#fff",
  color: "#111",
  fontSize: 14,
  outline: "none",
};
const btnLight = {
  padding: "8px 12px",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  background: "#fafafa",
  color: "#111",
  cursor: "pointer",
};
const thLight = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "1px solid #eee",
  fontWeight: 600,
  fontSize: 13,
};
const tdLight = {
  padding: "8px 10px",
  borderBottom: "1px solid #f2f2f2",
  fontSize: 13,
  verticalAlign: "top",
  background: "#fff",
};
const preWhite = {
  margin: 0,
  padding: 12,
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  background: "#f9fafb",
  color: "#111",
  fontSize: 12,
  lineHeight: 1.5,
};
