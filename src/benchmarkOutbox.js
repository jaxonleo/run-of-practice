// ── Benchmark recording outbox ──────────────────────────────────────────────
//
// A small durable local queue for pending attempt writes, so a signal drop or
// a same-identity refresh mid-recording does not lose entries (ROP-Benchmarks
// handoff 5.4). Scoped to a signed-in user or a recording grant, plus one
// assessment. It is NOT a second copy of the historical dataset: only writes
// that have not yet been acknowledged by the server live here.
//
// Every operation is wrapped so a browser that blocks IndexedDB (private
// windows, thumbnailers, strict privacy settings) silently falls back to an
// in-memory map for the life of the tab. Reads can come back empty; callers
// must render correctly with nothing queued.

const DB_NAME = 'rop-benchmarks';
const STORE = 'outbox';
const DB_VERSION = 1;

const mem = new Map(); // id -> entry, the fallback store
let useMemory = false;
let dbPromise = null;

function openDb() {
  if (useMemory) return Promise.reject(new Error('memory-fallback'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) { useMemory = true; reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('scope', 'scope', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { useMemory = true; reject(req.error); };
  });
  return dbPromise;
}

async function tx(mode, fn) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let out;
      Promise.resolve(fn(store)).then(v => { out = v; }).catch(reject);
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } catch (e) {
    useMemory = true;
    return fn(memStoreShim());
  }
}

// A tiny shim so the same fn body works against the in-memory map.
function memStoreShim() {
  return {
    put(entry) { mem.set(entry.id, entry); return req(entry); },
    get(id) { return req(mem.get(id) || undefined); },
    delete(id) { mem.delete(id); return req(undefined); },
    getAll() { return req([...mem.values()]); },
  };
  function req(value) { return { onsuccess: null, onerror: null, result: value, _v: value }; }
}

// IndexedDB request -> promise
function p(request) {
  if (request && '_v' in request) return Promise.resolve(request._v); // memory shim
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function outboxScopeForUser(userId, assessmentId) {
  return 'user:' + (userId || 'anon') + ':' + assessmentId;
}
export function outboxScopeForGrant(assessmentId) {
  return 'grant:' + assessmentId;
}

// entry: { assessmentId, participantId, slotIndex, kind, payload, opId,
//          expectedRowVersion }  ->  stored with id/status/attempts/timestamps
export async function outboxAdd(scope, entry) {
  const row = {
    id: entry.opId || (Date.now() + '-' + Math.random().toString(36).slice(2)),
    scope,
    assessmentId: entry.assessmentId,
    participantId: entry.participantId,
    slotIndex: entry.slotIndex,
    kind: entry.kind || 'attempt',
    payload: entry.payload,
    opId: entry.opId,
    expectedRowVersion: entry.expectedRowVersion ?? null,
    status: 'pending', // pending | saving | saved | retry | conflict
    server: null,
    attempts: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  try { await tx('readwrite', s => p(s.put(row))); } catch (e) { /* best effort */ }
  return row;
}

export async function outboxUpdate(id, patch) {
  try {
    await tx('readwrite', async s => {
      const cur = await p(s.get(id));
      if (!cur) return;
      await p(s.put({ ...cur, ...patch, updatedAt: Date.now() }));
    });
  } catch (e) { /* best effort */ }
}

export async function outboxRemove(id) {
  try { await tx('readwrite', s => p(s.delete(id))); } catch (e) { /* best effort */ }
}

export async function outboxList(scope) {
  try {
    const all = await tx('readonly', s => p(s.getAll()));
    return (all || []).filter(r => !scope || r.scope === scope).sort((a, b) => a.createdAt - b.createdAt);
  } catch (e) { return []; }
}

// Purge everything for a scope (logout, account change, grant revoked/expired).
export async function outboxClearScope(scope) {
  try {
    const all = await tx('readonly', s => p(s.getAll()));
    for (const r of (all || [])) if (r.scope === scope) await outboxRemove(r.id);
  } catch (e) { /* best effort */ }
}

// Purge every "user:" scope (a full sign-out / account switch).
export async function outboxClearAllUsers() {
  try {
    const all = await tx('readonly', s => p(s.getAll()));
    for (const r of (all || [])) if (String(r.scope).startsWith('user:')) await outboxRemove(r.id);
  } catch (e) { /* best effort */ }
}

// Send every pending/retry entry for a scope through `sendFn`, which must
// reauthorize the write server-side and return one of:
//   { ok: true }                     -> acknowledged, entry removed
//   { conflict: true, server }       -> entry kept, marked 'conflict'
//   { error }                        -> entry kept, marked 'retry', attempts++
// Idempotent replays (same opId) do not create extra attempts server-side, so
// re-flushing after a lost acknowledgement is safe.
export async function outboxFlush(scope, sendFn) {
  const rows = (await outboxList(scope)).filter(r => r.status === 'pending' || r.status === 'retry');
  const results = [];
  for (const r of rows) {
    await outboxUpdate(r.id, { status: 'saving' });
    let res;
    try { res = await sendFn(r); } catch (e) { res = { error: e }; }
    if (res && res.ok) {
      await outboxRemove(r.id);
      results.push({ id: r.id, status: 'saved' });
    } else if (res && res.conflict) {
      await outboxUpdate(r.id, { status: 'conflict', server: res.server || null });
      results.push({ id: r.id, status: 'conflict', server: res.server || null });
    } else {
      await outboxUpdate(r.id, { status: 'retry', attempts: r.attempts + 1 });
      results.push({ id: r.id, status: 'retry' });
    }
  }
  return results;
}

// Drop a conflicted entry once the user has reviewed the authoritative value.
export async function outboxResolveConflict(id) {
  await outboxRemove(id);
}
