#[cfg(not(feature = "library"))]
use cosmwasm_std::entry_point;

use cosmwasm_std::{
    to_json_binary, Addr, Binary, Deps, DepsMut, Env, MessageInfo, Order, Response, StdResult,
};
use cw_storage_plus::Bound;

mod error;
mod msg;
mod state;

use crate::error::ContractError;
use crate::msg::{
    CountResp, ExecuteMsg, GetResp, InstantiateMsg, ListResp, QueryMsg, StatsMonthlyResp,
};
use crate::state::{
    normalize_species, Annotation, StoredRecord, VerificationEntry, ADMIN, BY_GEOHASH, BY_SPECIES,
    BY_TIME, NEXT_ID, RECORDS, VERIFIERS,
};

const MAX_LIMIT: u32 = 5_000;
const DEFAULT_LIMIT: u32 = 100;
const DEFAULT_GEOHASH_PRECISION: u8 = 6;

/* ===========================
 * role helpers
 * =========================== */

fn ensure_admin(deps: &DepsMut, sender: &Addr) -> Result<(), ContractError> {
    let admin = ADMIN.load(deps.storage)?;
    if &admin != sender {
        return Err(ContractError::Unauthorized);
    }
    Ok(())
}

fn ensure_verifier(deps: &DepsMut, sender: &Addr) -> Result<(), ContractError> {
    let ok = VERIFIERS.may_load(deps.storage, sender)?.unwrap_or(false);
    if !ok {
        return Err(ContractError::Unauthorized);
    }
    Ok(())
}

/* ===========================
 * payload extractors
 * =========================== */

fn extract_observed_at(payload: &serde_json::Value) -> Result<u64, ContractError> {
    let obj = payload.as_object().ok_or_else(|| ContractError::BadRequest {
        msg: "payload must be a JSON object".to_string(),
    })?;
    if let Some(v) = obj.get("observed_at") {
        if let Some(n) = v.as_u64() {
            return Ok(n);
        }
    }
    Err(ContractError::BadRequest {
        msg: "payload.observed_at (u64 seconds) is required".into(),
    })
}

fn extract_species(payload: &serde_json::Value) -> Option<String> {
    let obj = payload.as_object()?;
    if let Some(s) = obj.get("species") {
        if let Some(txt) = s.as_str() {
            return Some(txt.to_string());
        }
        if let Some(o) = s.as_object() {
            if let Some(scientific) = o.get("scientific").and_then(|x| x.as_str()) {
                return Some(scientific.to_string());
            }
            if let Some(name) = o.get("name").and_then(|x| x.as_str()) {
                return Some(name.to_string());
            }
        }
    }
    None
}

fn extract_geohash_prefix(payload: &serde_json::Value, precision: u8) -> String {
    let obj = match payload.as_object() {
        Some(o) => o,
        None => return String::new(),
    };
    let place = match obj.get("place").and_then(|v| v.as_object()) {
        Some(p) => p,
        None => return String::new(),
    };
    let lat = match place.get("lat").and_then(|x| x.as_f64()) {
        Some(v) => v,
        None => return String::new(),
    };
    let lon = match place.get("lon").and_then(|x| x.as_f64()) {
        Some(v) => v,
        None => return String::new(),
    };
    geohash_prefix(lat, lon, precision)
}

fn geohash_prefix(lat: f64, lon: f64, precision: u8) -> String {
    fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
        if v < lo {
            lo
        } else if v > hi {
            hi
        } else {
            v
        }
    }
    let lat = clamp(lat, -90.0, 90.0);
    let lon = clamp(lon, -180.0, 180.0);

    let lat_q = (((lat + 90.0) / 180.0) * ((1u32 << 15) as f64 - 1.0)).round() as u32;
    let lon_q = (((lon + 180.0) / 360.0) * ((1u32 << 15) as f64 - 1.0)).round() as u32;

    fn part1by1(mut n: u32) -> u32 {
        n = (n | (n << 8)) & 0x00FF00FF;
        n = (n | (n << 4)) & 0x0F0F0F0F;
        n = (n | (n << 2)) & 0x33333333;
        n = (n | (n << 1)) & 0x55555555;
        n
    }
    let morton = (part1by1(lon_q) << 1) | part1by1(lat_q);

    const ALPHABET: &[u8; 32] = b"0123456789bcdefghjkmnpqrstuvwxyz";
    let bits = morton as u64;
    let total_bits = 5 * (precision as usize);
    let mut out = String::with_capacity(precision as usize);
    for i in (0..total_bits).step_by(5).rev() {
        let idx = ((bits >> i) & 0x1F) as usize;
        out.push(ALPHABET[idx] as char);
    }
    out
}

/* ===========================
 * entry points
 * =========================== */

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    let start_id = msg.start_id.unwrap_or(1);
    NEXT_ID.save(deps.storage, &start_id)?;

    let admin = match msg.admin {
        Some(a) => deps.api.addr_validate(&a)?,
        None => info.sender.clone(),
    };
    ADMIN.save(deps.storage, &admin)?;

    if let Some(vs) = msg.verifiers {
        for v in vs {
            let addr = deps.api.addr_validate(&v)?;
            VERIFIERS.save(deps.storage, &addr, &true)?;
        }
    }

    Ok(Response::new()
        .add_attribute("action", "instantiate")
        .add_attribute("next_id", start_id.to_string())
        .add_attribute("admin", admin))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::Store { payload, cid } => exec_store(deps, env, info, payload, cid),
        ExecuteMsg::AppendAnnotation {
            id,
            note,
            photo_cid,
            tags,
        } => exec_append_annotation(deps, env, info, id, note, photo_cid, tags),
        ExecuteMsg::Verify {
            id,
            taxon_id,
            confidence,
        } => exec_verify(deps, env, info, id, taxon_id, confidence),
        ExecuteMsg::Hide { id, reason } => exec_hide(deps, env, info, id, reason),
        ExecuteMsg::SetVerifier { addr, enabled } => exec_set_verifier(deps, info, addr, enabled),
    }
}

fn normalize_cid(input: &str) -> Result<String, ContractError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(ContractError::BadRequest {
            msg: "cid is required".into(),
        });
    }
    // "ipfs://<cid>" → "<cid>" に正規化
    let cid = trimmed.strip_prefix("ipfs://").unwrap_or(trimmed).to_string();

    // 軽量チェック（長さ・文字クラス）
    if cid.len() < 20 || cid.len() > 200 {
        return Err(ContractError::BadRequest {
            msg: "cid length seems invalid".into(),
        });
    }
    if !cid
        .bytes()
        .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-' || c == b'=')
    {
        return Err(ContractError::BadRequest {
            msg: "cid has invalid characters".into(),
        });
    }
    Ok(cid)
}

fn exec_store(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    payload: serde_json::Value,
    cid_input: String,
) -> Result<Response, ContractError> {
    let observed_at = extract_observed_at(&payload)?;
    let species_opt = extract_species(&payload).map(|s| normalize_species(&s));
    let geohash = extract_geohash_prefix(&payload, DEFAULT_GEOHASH_PRECISION);
    let cid = normalize_cid(&cid_input)?; // 必須・正規化

    let mut id = NEXT_ID.load(deps.storage)?;

    let rec = StoredRecord {
        id,
        sender: info.sender.clone(),
        observed_at,
        species: species_opt.clone(),
        geohash_prefix: geohash.clone(),
        cid: cid.clone(),
        payload: payload.clone(),
        block_time: env.block.time.seconds(),
        block_height: env.block.height,
        hidden: false,
        hidden_reason: None,
        annotations: vec![],
        verifications: vec![],
    };

    RECORDS.save(deps.storage, id, &rec)?;
    BY_TIME.save(deps.storage, (observed_at, id), &())?;
    if let Some(sp) = species_opt {
        BY_SPECIES.save(deps.storage, (sp, id), &())?;
    }
    if !geohash.is_empty() {
        BY_GEOHASH.save(deps.storage, (geohash, id), &())?;
    }

    id += 1;
    NEXT_ID.save(deps.storage, &id)?;

    Ok(Response::new()
        .add_attribute("action", "store")
        .add_attribute("id", (id - 1).to_string())
        .add_attribute("sender", info.sender)
        .add_attribute("cid", cid))
}

fn exec_append_annotation(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    id: u64,
    note: Option<String>,
    photo_cid: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<Response, ContractError> {
    if note.as_ref().map(|s| s.is_empty()).unwrap_or(false) {
        return Err(ContractError::BadRequest {
            msg: "note must not be empty".into(),
        });
    }
    if note.is_none() && photo_cid.is_none() && tags.as_ref().map(|t| t.is_empty()).unwrap_or(true)
    {
        return Err(ContractError::BadRequest {
            msg: "at least one of note/photo_cid/tags is required".into(),
        });
    }

    RECORDS.update(deps.storage, id, |maybe| -> Result<_, ContractError> {
        let mut rec = maybe.ok_or(ContractError::NotFound)?;
        rec.annotations.push(Annotation {
            at: env.block.time.seconds(),
            by: info.sender.clone(),
            note,
            photo_cid,
            tags,
        });
        Ok(rec)
    })?;

    Ok(Response::new()
        .add_attribute("action", "append_annotation")
        .add_attribute("id", id.to_string())
        .add_attribute("by", info.sender))
}

fn exec_verify(
    mut deps: DepsMut,
    env: Env,
    info: MessageInfo,
    id: u64,
    taxon_id: String,
    confidence: u8,
) -> Result<Response, ContractError> {
    ensure_verifier(&mut deps, &info.sender)?;
    if taxon_id.trim().is_empty() {
        return Err(ContractError::BadRequest {
            msg: "taxon_id must not be empty".into(),
        });
    }
    RECORDS.update(deps.storage, id, |maybe| -> Result<_, ContractError> {
        let mut rec = maybe.ok_or(ContractError::NotFound)?;
        rec.verifications.push(VerificationEntry {
            at: env.block.time.seconds(),
            verifier: info.sender.clone(),
            taxon_id,
            confidence,
        });
        Ok(rec)
    })?;

    Ok(Response::new()
        .add_attribute("action", "verify")
        .add_attribute("id", id.to_string())
        .add_attribute("verifier", info.sender))
}

fn exec_hide(
    mut deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    id: u64,
    reason: Option<String>,
) -> Result<Response, ContractError> {
    ensure_admin(&mut deps, &info.sender)?;
    RECORDS.update(deps.storage, id, |maybe| -> Result<_, ContractError> {
        let mut rec = maybe.ok_or(ContractError::NotFound)?;
        rec.hidden = true;
        rec.hidden_reason = reason.clone();
        Ok(rec)
    })?;

    Ok(Response::new()
        .add_attribute("action", "hide")
        .add_attribute("id", id.to_string()))
}

/* ============== query entry ============== */

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Get { id } => to_json_binary(&query_get(deps, id)?),
        QueryMsg::List {
            species,
            geohash_prefix,
            start,
            end,
            limit,
            start_after,
        } => to_json_binary(&query_list(
            deps,
            species,
            geohash_prefix,
            start,
            end,
            limit,
            start_after,
        )?),
        QueryMsg::Count {
            species,
            geohash_prefix,
            start,
            end,
        } => to_json_binary(&query_count(deps, species, geohash_prefix, start, end)?),
        QueryMsg::StatsMonthly {
            species,
            geohash_prefix,
            year,
        } => to_json_binary(&query_stats_monthly(deps, species, geohash_prefix, year)?),
    }
}

fn query_get(deps: Deps, id: u64) -> StdResult<GetResp> {
    let rec = RECORDS.may_load(deps.storage, id)?;
    Ok(GetResp { record: rec })
}

/* ============== list / count 共通 ============== */

fn filter_match(
    rec: &StoredRecord,
    geohash_prefix: Option<&str>,
    start: Option<u64>,
    end: Option<u64>,
) -> bool {
    if let Some(geo) = geohash_prefix {
        if !rec.geohash_prefix.starts_with(geo) {
            return false;
        }
    }
    if let Some(lo) = start {
        if rec.observed_at < lo {
            return false;
        }
    }
    if let Some(hi) = end {
        if rec.observed_at > hi {
            return false;
        }
    }
    true
}

fn query_list(
    deps: Deps,
    species: Option<String>,
    geohash_prefix: Option<String>,
    start: Option<u64>,
    end: Option<u64>,
    limit: Option<u32>,
    start_after: Option<u64>,
) -> StdResult<ListResp> {
    let limit = limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT) as usize;

    let mut out: Vec<StoredRecord> = Vec::with_capacity(limit);
    let mut last_id: Option<u64> = None;

    if let Some(sp0) = species.clone().map(|s| normalize_species(&s)) {
        // species index: keys are id only（prefix化でspecies成分は除去）
        let start_bound = start_after.map(Bound::exclusive);
        let iter = BY_SPECIES
            .prefix(sp0)
            .range(deps.storage, start_bound, None, Order::Ascending);

        for item in iter {
            let (id, _) = item?.into();
            if let Some(rec) = RECORDS.may_load(deps.storage, id)? {
                if filter_match(&rec, geohash_prefix.as_deref(), start, end) && !rec.hidden {
                    last_id = Some(id);
                    out.push(rec);
                    if out.len() == limit {
                        break;
                    }
                }
            }
        }
    } else if let Some(geo) = geohash_prefix.clone() {
        let start_bound = start_after.map(Bound::exclusive);
        let iter = BY_GEOHASH
            .prefix(geo)
            .range(deps.storage, start_bound, None, Order::Ascending);

        for item in iter {
            let (id, _) = item?.into();
            if let Some(rec) = RECORDS.may_load(deps.storage, id)? {
                if filter_match(&rec, None, start, end) && !rec.hidden {
                    last_id = Some(id);
                    out.push(rec);
                    if out.len() == limit {
                        break;
                    }
                }
            }
        }
    } else {
        // time index: (observed_at, id)
        let lo = start.unwrap_or(0);
        let hi = end.unwrap_or(u64::MAX);

        // ページング: start_after がある場合は (lo, id) を exclusive に
        let start_key = match start_after {
            Some(sa) => Some(Bound::exclusive((lo, sa))),
            None => Some(Bound::inclusive((lo, 0u64))),
        };
        let end_key = Some(Bound::inclusive((hi, u64::MAX)));

        let iter = BY_TIME.range(deps.storage, start_key, end_key, Order::Ascending);

        for item in iter {
            let ((_, id), _) = item?;
            if let Some(rec) = RECORDS.may_load(deps.storage, id)? {
                if filter_match(&rec, geohash_prefix.as_deref(), None, None) && !rec.hidden {
                    last_id = Some(id);
                    out.push(rec);
                    if out.len() == limit {
                        break;
                    }
                }
            }
        }
    }

    let next = if out.len() == limit { last_id } else { None };
    Ok(ListResp {
        records: out,
        next_start_after: next,
    })
}

fn query_count(
    deps: Deps,
    species: Option<String>,
    geohash_prefix: Option<String>,
    start: Option<u64>,
    end: Option<u64>,
) -> StdResult<CountResp> {
    let mut cnt: u64 = 0;

    if let Some(sp0) = species.clone().map(|s| normalize_species(&s)) {
        let iter = BY_SPECIES
            .prefix(sp0)
            .range(deps.storage, None, None, Order::Ascending);
        for item in iter {
            let (id, _) = item?.into();
            if let Some(rec) = RECORDS.may_load(deps.storage, id)? {
                if !rec.hidden && filter_match(&rec, geohash_prefix.as_deref(), start, end) {
                    cnt += 1;
                }
            }
        }
    } else if let Some(geo) = geohash_prefix.clone() {
        let iter = BY_GEOHASH
            .prefix(geo)
            .range(deps.storage, None, None, Order::Ascending);
        for item in iter {
            let (id, _) = item?.into();
            if let Some(rec) = RECORDS.may_load(deps.storage, id)? {
                if !rec.hidden && filter_match(&rec, None, start, end) {
                    cnt += 1;
                }
            }
        }
    } else {
        let lo = start.unwrap_or(0);
        let hi = end.unwrap_or(u64::MAX);
        let iter = BY_TIME.range(
            deps.storage,
            Some(Bound::inclusive((lo, 0u64))),
            Some(Bound::inclusive((hi, u64::MAX))),
            Order::Ascending,
        );
        for item in iter {
            let ((_, id), _) = item?;
            if let Some(rec) = RECORDS.may_load(deps.storage, id)? {
                if !rec.hidden && filter_match(&rec, geohash_prefix.as_deref(), None, None) {
                    cnt += 1;
                }
            }
        }
    }

    Ok(CountResp { count: cnt })
}

/* ============== stats (簡易: 年=31536000秒近似) ============== */

fn year_bounds_utc(year: u32) -> (u64, u64) {
    let start = u64::from(year) * 31_536_000;
    let end = u64::from(year + 1) * 31_536_000 - 1;
    (start, end)
}

fn month_from_unix_utc(ts: u64) -> u32 {
    let seconds_in_year = 31_536_000u64;
    let sec = ts % seconds_in_year;
    let month = (sec * 12 / seconds_in_year) + 1;
    month as u32
}

fn query_stats_monthly(
    deps: Deps,
    species: Option<String>,
    geohash_prefix: Option<String>,
    year: u32,
) -> StdResult<StatsMonthlyResp> {
    let (start, end) = year_bounds_utc(year);
    let mut months = [0u64; 12];

    // 走査集合の選択
    if let Some(sp0) = species.clone().map(|s| normalize_species(&s)) {
        let iter = BY_SPECIES
            .prefix(sp0)
            .range(deps.storage, None, None, Order::Ascending);
        for item in iter {
            let (id, _) = item?.into();
            if let Some(rec) = RECORDS.may_load(deps.storage, id)? {
                if rec.hidden {
                    continue;
                }
                if !filter_match(&rec, geohash_prefix.as_deref(), Some(start), Some(end)) {
                    continue;
                }
                let m = month_from_unix_utc(rec.observed_at);
                if (1..=12).contains(&m) {
                    months[(m - 1) as usize] += 1;
                }
            }
        }
    } else if let Some(geo) = geohash_prefix.clone() {
        let iter = BY_GEOHASH
            .prefix(geo)
            .range(deps.storage, None, None, Order::Ascending);
        for item in iter {
            let (id, _) = item?.into();
            if let Some(rec) = RECORDS.may_load(deps.storage, id)? {
                if rec.hidden {
                    continue;
                }
                if !filter_match(&rec, None, Some(start), Some(end)) {
                    continue;
                }
                let m = month_from_unix_utc(rec.observed_at);
                if (1..=12).contains(&m) {
                    months[(m - 1) as usize] += 1;
                }
            }
        }
    } else {
        // 時間インデックスで期間絞り
        let iter = BY_TIME.range(
            deps.storage,
            Some(Bound::inclusive((start, 0u64))),
            Some(Bound::inclusive((end, u64::MAX))),
            Order::Ascending,
        );
        for item in iter {
            let ((_, id), _) = item?;
            if let Some(rec) = RECORDS.may_load(deps.storage, id)? {
                if rec.hidden {
                    continue;
                }
                if let Some(geo) = geohash_prefix.as_deref() {
                    if !rec.geohash_prefix.starts_with(geo) {
                        continue;
                    }
                }
                let m = month_from_unix_utc(rec.observed_at);
                if (1..=12).contains(&m) {
                    months[(m - 1) as usize] += 1;
                }
            }
        }
    }

    Ok(StatsMonthlyResp { months })
}

/* ===========================
 * admin helper
 * =========================== */

fn exec_set_verifier(
    mut deps: DepsMut,
    info: MessageInfo,
    addr: String,
    enabled: bool,
) -> Result<Response, ContractError> {
    ensure_admin(&mut deps, &info.sender)?;
    let a = deps.api.addr_validate(&addr)?;
    VERIFIERS.save(deps.storage, &a, &enabled)?;
    Ok(Response::new()
        .add_attribute("action", "set_verifier")
        .add_attribute("addr", a)
        .add_attribute("enabled", enabled.to_string()))
}
