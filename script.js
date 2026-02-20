// ===============================
// Supabase (Project API)
// ===============================
const SUPABASE_URL = "https://rdjrvlwomfptdtpekhkf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_uhNg9-afDOmbDVm34_BvEA_UhcHSMfC";

// v2 CDN exposes createClient on the global `supabase` namespace.
// We store the *client* on window.supabaseClient AND window.supabaseClientOnly,
// and also expose `window.supabase` as the client for easy console testing.
window.supabaseClient = window.supabaseClient || window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

console.log("Supabase initialized");
// ===============================
// REALTIME: job_logs subscription (cross-device updates)
// ===============================
window.__jobLogsSub = window.__jobLogsSub || null;

function startJobLogsRealtime(jobCode) {
  const sb = window.supabaseClient;
  if (!sb) return;

  // stop previous subscription (if any)
  try {
    if (window.__jobLogsSub) sb.removeChannel(window.__jobLogsSub);
  } catch {}

  window.__jobLogsSub = sb
    .channel('job_logs_' + jobCode)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'job_logs',
        filter: `job_code=eq.${jobCode}`
      },
      (payload) => {
        console.log('[REALTIME] job_logs change', payload.eventType, payload.new || payload.old);
        window.__lastJobLogEvent = payload;
        // later we will refresh the Office Logistics list UI here
      }
    )
    .subscribe((status) => {
      console.log('[REALTIME] subscribed', status, 'job_code=', jobCode);
    });
}

window.startJobLogsRealtime = startJobLogsRealtime; // for console testing

// ===============================
// Supabase: save piece status (one row)
// ===============================
async function sbSavePieceStatus({ jobId, jobCode, sheetLabel, pieceLabel, status }) {
  const sb = window.supabaseClient;
  if (!sb) throw new Error("Supabase client not initialized");

  const row = {
    job_id: jobId,                 // UUID
    job_code: jobCode,             // "industrial/24-36N"
    sheet_label: sheetLabel,       // "E3"
    piece_label: pieceLabel,       // "125B"
    status: status,                // "pink" | "blue" | ...
    updated_at: new Date().toISOString()
  };

  const { error } = await sb
    .from("piece_status")
    .upsert(row, { onConflict: "job_id,sheet_label,piece_label" });

  if (error) throw error;
  return true;
}
window.sbSavePieceStatus = sbSavePieceStatus; // for testing

// SUPABASE: batch load statuses for ONE sheet
// ===============================
async function sbLoadSheetStatuses(jobCode, sheetLabel) {
  const sb = window.supabaseClient;
  if (!sb) throw new Error("Supabase client missing");

  const sheet = __normLabel(sheetLabel);

  const { data, error } = await sb
    .from("piece_status")
    .select("piece_label,status")
    .eq("job_code", jobCode)
    .eq("sheet_label", sheet);

  if (error) throw error;

  const out = {};
  for (const row of (data || [])) {
    const k = __normLabel(row.piece_label);
    out[k] = String(row.status || "none");
  }

  console.log("[SUPABASE] raw count", sheet, (data || []).length);
  return out;
}

// in-memory cache for current sheet
window.__sheetStatusMap = window.__sheetStatusMap || {};
window.__sheetStatusKey = window.__sheetStatusKey || "";
console.log("POP BOOT ✓ script file loaded", Date.now());
'use strict';


// ===============================
// STATUS PERSISTENCE (per job + sheet + label)
// ===============================
function __jobId() {
  return (window.currentJob && window.currentJob.id)
    ? String(window.currentJob.id)
    : String(document.getElementById('job-input')?.value || '').trim();
}

function __sheetKey() {
  return String(window.currentSheetLabel || window.mapCurrentSheet || '').trim();
}

function __normLabel(label) {
  return String(label || '')
    .trim()
    .replace(/\.[a-z0-9]+$/i, '') // remove .png/.jpg
    .toUpperCase();
}

function __statusStoreKey() {
  const job = __jobId() || 'UNKNOWN_JOB';
  return `pop.status.${job}`;
}

function __readStatusStore() {
  try {
    return JSON.parse(localStorage.getItem(__statusStoreKey()) || '{}') || {};
  } catch {
    return {};
  }
}

function __writeStatusStore(obj) {
  localStorage.setItem(__statusStoreKey(), JSON.stringify(obj || {}));
}

function getSavedStatus(sheetLabel, pieceLabel) {
  const store = __readStatusStore();
  const sheet = __normLabel(sheetLabel);
  const piece = __normLabel(pieceLabel);
  return (store[sheet] && store[sheet][piece]) ? store[sheet][piece] : 'none';
}
// ===============================
// UNDO (last status change)
// ===============================
window.__undoStack = window.__undoStack || [];
window.__undoApplying = false;

function __pushUndo({ sheet, piece, prev, next }) {
  if (window.__undoApplying) return;
  if (!sheet || !piece) return;
  if (prev === next) return;

  window.__undoStack.push({ sheet, piece, prev, next, t: Date.now() });
  if (window.__undoStack.length > 50) window.__undoStack.shift();
}

window.undoLastStatus = function undoLastStatus() {
  const last = window.__undoStack.pop();
  if (!last) {
    setStatus('Nothing to undo.');
    return;
  }

  window.__undoApplying = true;
  try {
    setSavedStatus(last.sheet, last.piece, last.prev);
    setStatus(`Undo: ${last.piece} → ${last.prev === 'none' ? 'default' : last.prev}`);
  } finally {
    window.__undoApplying = false;
  }

  if (typeof window.renderMapNow === 'function') window.renderMapNow();
};

function setSavedStatus(sheetLabel, pieceLabel, mode) {
  console.log("[STATUS] setSavedStatus()", { sheetLabel, pieceLabel, mode });

  const sheet = __normLabel(sheetLabel);
  const piece = __normLabel(pieceLabel);
  const status = String(mode || 'none');
const prev = getSavedStatus(sheet, piece);
__pushUndo({ sheet, piece, prev, next: status });

  // 1) localStorage save (so colors persist even if Supabase fails)
  const store = __readStatusStore();
  store[sheet] = store[sheet] || {};

  if (status === 'none') delete store[sheet][piece];
  else store[sheet][piece] = status;

  __writeStatusStore(store);

    // ✅ keep in-memory sheet cache in sync (prevents mobile re-render from "bringing back" colors)
  window.__sheetStatusMap = window.__sheetStatusMap || {};
  if (sheet && piece) {
    if (status === 'none') delete window.__sheetStatusMap[piece];
    else window.__sheetStatusMap[piece] = status;
  }

  // 2) Supabase save
  sbSavePieceStatus({
    jobId: "5e23816a-9043-4f43-994e-df0118c1de94",
    jobCode: "industrial/24-36N",
    sheetLabel: sheet,
    pieceLabel: piece,
    status: status
  })
  .then(() => console.log("[SUPABASE] save ok", { sheet, piece, status }))
  .catch(err => console.warn("[SUPABASE] save failed", err));
}

// emergency wipe for current job (only if you ever choose to use it)
window.__wipeStatusesForJob = function () {
  localStorage.removeItem(__statusStoreKey());
  console.log('WIPED status store for job', __jobId());
};

// ---------- Elements (image is lazy-bound) ----------
const els = {
  jobInput: document.getElementById('job-input'),
  categorySelect: document.getElementById('category-select'),
  sheetSelect: document.getElementById('sheet-select'),
  filterInput: document.getElementById('filter-input'),
  status: document.getElementById('status-text'),
  step1Next: document.querySelector('#step-1 .next-btn'),
  step2Next: document.querySelector('#step-2 .next-btn'),
  step3Next: document.querySelector('#step-3 .next-btn'),
};
Object.defineProperty(els, 'image', {
  get () { return document.getElementById('sheet-image') || document.getElementById('image'); }
});

function setStatus(msg) {
  if (els.status) els.status.textContent = msg;
  console.log('[STATUS]', msg);
}
window.setStatus = setStatus;

// ---------- URL resolver ----------
function resolveImageUrl(item, kind = 'image') {
  const job = window.currentJob || {};
  const jobRoot = job.id ? `jobs/${job.id}/` : 'jobs/';
  const imagesDir = (job.imagesDir || `${jobRoot}images/`).replace(/^\.\/+/, '');
  const thumbsDir = (job.thumbsDir || `${jobRoot}thumbs/`).replace(/^\.\/+/, '');

  // ✅ FIX: include item.fetch for image
  let raw = (kind === 'thumb'
    ? (item.thumb || item.thumbnail || item.thumbPath || '')
    : (item.fetch || item.image || item.path || item.file || '')
  ) || '';

  if (/^(https?:)?\/\//i.test(raw) || raw.startsWith('/')) return raw;

  let s = String(raw).replace(/^\.\/+/, '').replace(/\\/g, '/');
  if (job.id && s.startsWith(`jobs/${job.id}/`)) return s;
  if (s.startsWith('images/')) return imagesDir + s.slice(7);
  if (s.startsWith('thumbs/')) return thumbsDir + s.slice(7);
  if (s.startsWith('assets/')) return jobRoot + s;
  if (s.includes('/')) return imagesDir + s;
  return (kind === 'thumb' ? thumbsDir : imagesDir) + s;
}
function buildSrc(_jobId, it) { return resolveImageUrl(it, 'image'); }

// ---------- Helpers ----------
function makeOptions(list, first = 'Select...') {
  const o = [`<option value="">${first}</option>`];
  for (const it of list) {
    if (typeof it === 'string') {
      o.push(`<option value="${it}">${it}</option>`);
    } else if (it && typeof it === 'object') {
      o.push(
        `<option value="${it.value ?? it.name ?? ''}">${it.label ?? it.name ?? it.value ?? ''}</option>`
      );
    }
  }
  return o.join('');
}

function naturalByLabel(a, b) {
  const pick = (x) => (x?.label ?? x?.name ?? x?.tag ?? x?.path ?? '').toString();
  return pick(a).localeCompare(pick(b), undefined, { numeric: true, sensitivity: 'base' });
}

function group(items) {
  const out = { Inventory: [] };
  for (const it of items) {
    // ✅ FIX: include fetch in rawPath so categorization works even when path is missing
    const rawPath = String(it.path || it.image || it.fetch || it.file || '').replace(/^\.\//, '');
    const segs = rawPath.split('/');
    let cat = '';

    for (const marker of ['images', 'assets']) {
      const idx = segs.findIndex(s => s.toLowerCase() === marker);
      if (idx !== -1 && segs[idx + 1] && segs.length > idx + 2) {
        cat = segs[idx + 1];
        break;
      }
    }

    if (!cat) {
      const base = (it.label || it.name || segs.at(-1) || '');
      const m = base.match(/^([A-Za-z]+)[-_]/);
      cat = m ? m[1] : 'Misc';
    }

    // ✅ FIX: preserve map/fetch/type so member mapping can work after jump
    const norm = {
      name: it.name || it.label || segs.at(-1) || 'item',
      label: it.label || it.name || rawPath,

      // keep a "path" for select dropdowns; prefer explicit path/image/file, else fetch
      path: it.image || it.path || it.file || it.fetch || rawPath,

      thumb: it.thumb || it.thumbnail || it.thumbPath,

      // preserve these fields
      fetch: it.fetch || '',
      map: it.map || '',
      type: it.type || ''
    };

    (out[cat] ||= []).push(norm);
    out.Inventory.push(norm);
  }
  return out;
}

// ---------- Load index for current job ----------
async function loadIndexForCurrentJob() {
  if (!window.currentJob?.indexUrl) {
    setStatus('No access code set.');
    return;
  }
  setStatus('Loading index…');
  try {
    console.log('[DEBUG] indexUrl =', window.currentJob.indexUrl);
    const res = await fetch(window.currentJob.indexUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    const arr = Array.isArray(raw) ? raw : Object.values(raw || {}).flat();
    if (!arr.length) {
      setStatus('No items in index.');
      return;
    }

    const groups = group(arr);
    Object.keys(groups).forEach(k => {
      groups[k] = (groups[k] || []).slice().sort(naturalByLabel);
    });
    window.currentIndex = groups;

    // categories
    const cats = Object.keys(groups).sort((a, b) => {
      if (a === 'Inventory' && b !== 'Inventory') return 1;
      if (b === 'Inventory' && a !== 'Inventory') return -1;
      return a.localeCompare(b);
    });

    cats.unshift('Office Logistics');

    if (els.categorySelect) {
      els.categorySelect.innerHTML = makeOptions(
        cats.map(c => ({
          value: c,
          label: `${c} (${(groups[c] || []).length})`
        })),
        'Select a category'
      );
      els.categorySelect.value = '';
      // ✅ Ensure Office Logistics is always available as a virtual category
if (els.categorySelect && !Array.from(els.categorySelect.options).some(o => o.value === 'Office Logistics')) {
  const opt = document.createElement('option');
  opt.value = 'Office Logistics';
  opt.textContent = 'Office Logistics';
  els.categorySelect.appendChild(opt);
}

    }
    if (els.step2Next) els.step2Next.disabled = true;
    if (els.sheetSelect) els.sheetSelect.innerHTML = makeOptions([], 'Select a sheet');

    // state
    window._allItems = arr;
    window._items = [];
    window._pos = 0;

    // viewer show
    window._show = function (i) {
      window._pos = Math.max(0, Math.min(i, window._items.length - 1));
      const it = window._items[window._pos];
      const img = els.image;
      if (!img) {
        console.warn('[SHOW] no #image element');
        return;
      }

      const wrap = document.getElementById('image-wrapper');
      if (wrap && getComputedStyle(wrap).position === 'static') {
        wrap.style.position = 'relative';
      }

      let cap = document.getElementById('image-caption');
      if (!cap && wrap) {
        cap = document.createElement('div');
        cap.id = 'image-caption';
        Object.assign(cap.style, {
          position: 'absolute',
          left: '12px',
          bottom: '12px',
          padding: '6px 10px',
          borderRadius: '10px',
          background: 'rgba(0,0,0,0.65)',
          color: '#fff',
          fontSize: '14px',
          lineHeight: '1.2',
          pointerEvents: 'none',
          maxWidth: 'calc(100% - 24px)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        });
        wrap.appendChild(cap);
      }

      if (!it) {
        img.removeAttribute('src');
        if (cap) cap.textContent = '';
        return;
      }

      img.src = buildSrc(window.currentJob.id, it);
      img.setAttribute('draggable', 'false');
      img.style.userSelect = 'none';
      img.style.webkitUserDrag = 'none';
      img.addEventListener('dragstart', e => e.preventDefault(), { passive: false });
      img.onerror = () => console.warn('IMAGE LOAD FAILED:', img.src);

      const label = it.label || it.name || it.path || '';
      const cat = els.categorySelect?.value || '';
      if (cap) {
        cap.textContent = `${cat ? cat + ' • ' : ''}${label}  (${window._pos + 1}/${window._items.length})`;
      }
      setStatus(`Showing: ${label} (${window._pos + 1}/${window._items.length})`);

      // ✅ FIX: pass item too (so we can load item.map for member details)
      setCurrentSheetLabel(label, it);

      if (els.sheetSelect) els.sheetSelect.value = it.path;
    };

    // wire once
    if (!window._wired) {
      window._wired = true;

      els.categorySelect?.addEventListener('change', () => {
        const cat = els.categorySelect.value;
         // Office Logistics is a "virtual category"
if (cat === 'Office Logistics') {
  // show logistics step/page
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  document.getElementById('step-office')?.classList.add('active');

  setStatus(`Office Logistics — job: ${window.currentJob?.id || ''}`);
  document.getElementById('office-job-code').textContent = window.currentJob?.id || '';


  // Optional: keep Step-2 Next disabled since we're not browsing images
  if (els.step2Next) els.step2Next.disabled = true;
  return;
}

        const base = window.currentIndex[cat] || [];
        if (els.step2Next) els.step2Next.disabled = !cat;

        const q = (els.filterInput?.value || '').toLowerCase();
        window._items = q
          ? base.filter(it =>
              (`${it.name || ''} ${it.label || ''} ${it.path || ''}`)
                .toLowerCase()
                .includes(q)
            )
          : base;

        if (els.sheetSelect) {
          els.sheetSelect.innerHTML = makeOptions(
            window._items.map(x => ({
              value: x.path,
              label: x.label || x.name || x.path
            })),
            'Select a sheet'
           
          );
        }
        if (window._items.length) {
          _show(0);
          if (els.step3Next) els.step3Next.disabled = false;
        } else {
          els.image?.removeAttribute('src');
          if (els.step3Next) els.step3Next.disabled = true;
          setStatus('No matches.');
        }
      });

      els.sheetSelect?.addEventListener('change', () => {
        const i = window._items.findIndex(it => it.path === els.sheetSelect.value);
        if (i >= 0) _show(i);
        if (els.step3Next) els.step3Next.disabled = i < 0;
      });

      els.filterInput?.addEventListener('input', () => {
        const cat = els.categorySelect?.value || '';
        const base = window.currentIndex[cat] || [];
        const q = (els.filterInput.value || '').toLowerCase();
        window._items = q
          ? base.filter(it =>
              (`${it.name || ''} ${it.label || ''} ${it.path || ''}`)
                .toLowerCase()
                .includes(q)
            )
          : base;

        if (els.sheetSelect) {
          els.sheetSelect.innerHTML = makeOptions(
            window._items.map(x => ({
              value: x.path,
              label: x.label || x.name || x.path
            })),
            'Select a sheet'
          );
        }
        if (window._items.length) {
          _show(0);
          if (els.step3Next) els.step3Next.disabled = false;
        } else {
          els.image?.removeAttribute('src');
          if (els.step3Next) els.step3Next.disabled = true;
          setStatus('No matches.');
        }
      });

      document.getElementById('prev-btn')?.addEventListener('click', () => _show(window._pos - 1));
      document.getElementById('next-btn')?.addEventListener('click', () => _show(window._pos + 1));
    }

    setStatus(
      `Index loaded. ${Object.keys(groups).length} categor${
        Object.keys(groups).length === 1 ? 'y' : 'ies'
      } found.`
    );
  } catch (err) {
    console.error(err);
    setStatus('Failed to load index.');
  }
}
window.loadIndexForCurrentJob = loadIndexForCurrentJob;

// ---------- Generic [data-go] nav ----------
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-go]');
  if (!btn) return;
  const n = parseInt(btn.getAttribute('data-go'), 10);
  if (!n) return;
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  const next = document.getElementById(`step-${n}`);
  if (next) next.classList.add('active');
});

// === Back button: pop view history (multi-level) ===
document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.back-btn');
  if (!btn) return;

  // stop the normal step-nav ([data-go]) from firing
  ev.preventDefault();


  const st = window.drillStack?.pop();
  if (!st) {
    console.log('[BACK] No history; staying put.');
    return;
  }

  console.log('[BACK] Restoring:', st.sheetLabel || st.imgSrc);
  restoreViewState(st);
}, true);

// ===== Supervisor Lock (client-side) =====
// Blocks ALL piece status changes unless unlocked by supervisor PIN.
// PIN is stored on THIS device (localStorage). Change/reset by supervisor only.
window.popSupervisor = window.popSupervisor || (() => {
  const KEY_PIN = 'pop.supervisor.pin';        // stored PIN (plain). Upgrade later if desired.
  const KEY_UNLOCKED = 'pop.supervisor.on';    // "1" when unlocked this session

  function isUnlocked() {
    return localStorage.getItem(KEY_UNLOCKED) === '1';
  }

  function lock(msg = 'Supervisor lock enabled.') {
    localStorage.setItem(KEY_UNLOCKED, '0');
    try { window.setStatus?.(msg); } catch {}
    // force mode back to normal
    if (window.currentStatusMode && window.currentStatusMode !== 'none') {
      window.currentStatusMode = 'none';
      document.querySelectorAll('.status-btn[data-status]').forEach(b => b.classList.remove('active'));
      document.querySelector('.status-btn[data-status="none"]')?.classList.add('active');
    }
    updateToolbarDisabledState();
    console.log('[SUP] LOCK');
  }

function unlock() {
  // ✅ Approved supervisor PIN (the only PIN that can unlock)
  // Change this one value to your real PIN.
  const APPROVED_PIN = '111111';

  // If a PIN was ever set on this device, use it.
  // Otherwise force the device to use the approved PIN.
  const stored = localStorage.getItem(KEY_PIN) || APPROVED_PIN;

  // Ensure the device has a stored PIN so it stays consistent
  if (!localStorage.getItem(KEY_PIN)) {
    localStorage.setItem(KEY_PIN, stored);
  }

  const pin = prompt('Supervisor PIN required:');
  if (!pin) return false;

  if (pin !== stored) {
    alert('Wrong PIN.');
    return false;
  }

  // ✅ stays unlocked on this device until manually locked
  localStorage.setItem(KEY_UNLOCKED, '1');
  updateToolbarDisabledState();
  window.setStatus?.('Supervisor unlocked on this device.');
  console.log('[SUP] UNLOCK');
  return true;
}


  function resetPin() {
    if (!isUnlocked()) {
      alert('Unlock as supervisor first.');
      return false;
    }
    const p1 = prompt('Enter NEW supervisor PIN:');
    if (!p1) return false;
    const p2 = prompt('Confirm NEW PIN:');
    if (!p2 || p2 !== p1) {
      alert('PINs did not match.');
      return false;
    }
    localStorage.setItem(KEY_PIN, p1);
    window.setStatus?.('Supervisor PIN updated on this device.');
    console.log('[SUP] PIN RESET');
    return true;
  }

  // Disable marking buttons when locked
  function updateToolbarDisabledState() {
    const locked = !isUnlocked();
    document.querySelectorAll('.status-btn[data-status]').forEach(btn => {
      const mode = btn.getAttribute('data-status') || 'none';
      // Always allow "none", block the marking colors
      btn.toggleAttribute('disabled', locked && mode !== 'none');
      btn.classList.toggle('locked', locked && mode !== 'none');
      btn.title = (locked && mode !== 'none')
        ? 'Supervisor locked'
        : (btn.title || '');
    });
  }

  // Convenience: Ctrl+Shift+L => unlock/lock toggle
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
      e.preventDefault();
      if (isUnlocked()) lock('Supervisor locked.');
      else unlock();
    }
    // Ctrl+Shift+R => reset PIN (only when unlocked)
    if (e.ctrlKey && e.shiftKey && (e.key === 'R' || e.key === 'r')) {
      e.preventDefault();
      resetPin();
    }
  });

  // Initialize default: locked unless previously unlocked
  if (localStorage.getItem(KEY_UNLOCKED) == null) localStorage.setItem(KEY_UNLOCKED, '0');
  // expose helper so other code can refresh button state
  window.__supUpdateToolbar = updateToolbarDisabledState;

  return { isUnlocked, lock, unlock, resetPin, updateToolbarDisabledState };
})();

// ----- Supervisor panel (Step 1 UI) -----
(function wireSupervisorPanel(){
  function updateUI(){
    const unlocked = !!window.popSupervisor?.isUnlocked?.();
    const el = document.getElementById('sup-state');
    if (el) el.textContent = unlocked ? 'Unlocked' : 'Locked';

    // Only allow "Change PIN" when unlocked
    const reset = document.getElementById('sup-reset-btn');
    if (reset) reset.disabled = !unlocked;

    // Keep toolbar disabled state correct too
    window.popSupervisor?.updateToolbarDisabledState?.();
  }

  function wire(){
    const u = document.getElementById('sup-unlock-btn');
    const l = document.getElementById('sup-lock-btn');
    const r = document.getElementById('sup-reset-btn');
    if (!u || !l || !r) return;

    u.addEventListener('click', () => {
      window.popSupervisor?.unlock?.();
      updateUI();
    });

    l.addEventListener('click', () => {
      window.popSupervisor?.lock?.('Supervisor locked.');
      updateUI();
    });

    r.addEventListener('click', () => {
      window.popSupervisor?.resetPin?.();
      updateUI();
    });

    updateUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();


// ---------- Piece status mode selector (toolbar) ----------
window.currentStatusMode = 'none';  // "none", "clear", "yellow", "pink", "blue", "green"
window.__lastModeSwitchAt = Date.now();
function setStatusMode(mode) {
  const valid = ['none', 'clear', 'yellow', 'pink', 'blue', 'green'];
  if (!valid.includes(mode)) mode = 'none';
  
console.log('[SUP] isUnlocked?', !!window.popSupervisor?.isUnlocked?.(), 'requested mode:', mode);

    // 🔒 Supervisor lock: block marking modes unless unlocked
  if (mode !== 'none' && !window.popSupervisor?.isUnlocked?.()) {
    setStatus('Supervisor lock: press Ctrl+Shift+L to unlock.');
    mode = 'none';
  }

  window.currentStatusMode = mode;

  // Update toolbar button styles
  const buttons = document.querySelectorAll('.status-btn[data-status]');
  buttons.forEach(btn => {
    const btnMode = btn.getAttribute('data-status') || 'none';
    btn.classList.toggle('active', btnMode === mode);
  });

  // Optional: status text
  const labelMap = {
    none:   'Normal (click & fetch)',
    clear:  'Clear mode: tap a piece to remove status',
    yellow: 'Marking: Not located',
    pink:   'Marking: Rigged',
    blue:   'Marking: Erected',
    green:  'Marking: 100% complete'
  };
  setStatus(`Mode: ${labelMap[mode] || 'Normal'}`);
  console.log('[MODE] currentStatusMode =', mode);
}

// Init toolbar once DOM is ready
(function initStatusToolbar(){
  function wire() {
    const buttons = document.querySelectorAll('.status-btn[data-status]');
    if (!buttons.length) return; // nothing to do (safety)

    buttons.forEach(btn => {
      btn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation(); 
  // ✅ prevents the tap from falling through to a hotspot on mobile
  const mode = btn.getAttribute('data-status') || 'none';
  setStatusMode(mode);
});

    });

    // Default to Normal on load
    setStatusMode('none');
        window.popSupervisor?.updateToolbarDisabledState?.();

  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
    window.popSupervisor?.updateToolbarDisabledState?.();

})();

// ---------- Type selector ----------
(() => {
  const TYPE_LABELS = {
    residential: 'Residential',
    institutional: 'Institutional',
    commercial: 'Commercial',
    industrial: 'Industrial',
    special: 'Special'
  };

  function initTypeSelector() {
    const sel = document.getElementById('type-select');
    if (!sel) return;

    window.state = window.state || {};
    const state = window.state; // ✅ FIX: real variable

    const saved = localStorage.getItem('pop.type');
    if (saved && TYPE_LABELS[saved]) sel.value = saved;

    state.type = sel.value;
    setStatus(`Type set: ${TYPE_LABELS[state.type] || '(none)'}`);

    sel.addEventListener('change', () => {
      state.type = sel.value;
      localStorage.setItem('pop.type', state.type);
      setStatus(`Type set: ${TYPE_LABELS[state.type] || '(none)'}`);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTypeSelector);
  } else {
    initTypeSelector();
  }
})();

// ---------- Type-aware Access Code (no jobs.json) ----------
(() => {
  async function tryIndex(base) {
    try {
      const r = await fetch(`jobs/${base}/index/assets-index.json`, { cache: 'no-store' });
      return r.ok;
    } catch {
      return false;
    }
  }

  async function pickBase() {
    const cand = [];

    // If there is already an image loaded from a job, keep that as a fallback.
    const imgSrc = document.getElementById('image')?.src || '';
    const m = imgSrc.match(/\/jobs\/(.+?)\/(?:images|index)\b/);
    if (m) cand.push(m[1]); // e.g. "industrial/24-36N"

    const typeEl = document.getElementById('type-select');
    const inputEl = document.getElementById('job-input');
    const type = typeEl?.value || '';
    const code = (inputEl?.value || '').trim();

    if (code) {
      if (type) {
        // STRICT: if a type is chosen, only look under that type.
        // e.g. "industrial/24-36N"
        cand.push(`${type}/${code}`);
      } else {
        // No type selected: treat the code as a full base path,
        // e.g. "industrial/24-36N" or "test-job".
        cand.push(code);
      }
    }

    const seen = new Set();
    for (const base of cand) {
      if (!base || seen.has(base)) continue;
      seen.add(base);
      if (await tryIndex(base)) return base;
    }
    return '';
  }

  window.applyAccessCode = async function applyAccessCode() {
    const base = await pickBase();
    if (!base) {
      setStatus('Index not found. Check type and access code (jobs/<type>/<code>/index/assets-index.json).');
      if (els.step1Next) els.step1Next.disabled = true;
      return false;
    }
    window.currentJob = {
      id: base,
      label: base,
      indexUrl: `jobs/${base}/index/assets-index.json`,
      imagesDir: `jobs/${base}/images/`,
      thumbsDir: `jobs/${base}/thumbs/`,
    };
    setStatus(`Access code set: ${base}`);
    if (els.step1Next) els.step1Next.disabled = false;
    return true;
  };
})();

// ---------- Step-1 harness (Access → load → Step 2) ----------
(() => {
  const input = els.jobInput;
  const next = els.step1Next;
  if (!input || !next) return;

  const enable = () => { next.disabled = !input.value.trim(); };
  input.addEventListener('input', enable);
  enable();

  async function go() {
    try {
      const ok = await (window.applyAccessCode?.() ?? false);
      if (!ok) return;
      await (window.loadIndexForCurrentJob?.());
      document.getElementById('step-1')?.classList.remove('active');
      document.getElementById('step-2')?.classList.add('active');
      document.getElementById('category-select')?.focus();
    } catch (e) {
      console.warn('[BOOT] init failed', e);
      setStatus('Failed to prepare job.');
    }
  }

  next.addEventListener('click', (e) => { e.preventDefault(); go(); });
  input.addEventListener('keyup', (e) => { if (e.key === 'Enter') go(); });
})();

// ===== JUMP (uses window.currentIndex built by loadIndexForCurrentJob) =====
function __normTag(s) {
  return String(s || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

window.jumpToLabel = async function (raw) {
  const q = String(raw || '').trim();
  if (!q) {
    setStatus?.('Type a tag (e.g., 133B)');
    return;
  }

  const idx = window.currentIndex || {};
  const catSel = els.categorySelect;
  const sheetSel = els.sheetSelect;
  const want = __normTag(q);

  const searchCat = (key) => {
    const arr = idx[key] || [];
    for (let i = 0; i < arr.length; i++) {
      const it = arr[i];
      const label = it.label || it.name || it.path || '';
      if (__normTag(label) === want) return { key, i, item: it };
    }
    return null;
  };

  let found = searchCat(catSel?.value);
  if (!found) {
    for (const k of Object.keys(idx)) {
      if ((found = searchCat(k))) break;
    }
  }
  if (!found) {
    setStatus?.(`Not found: ${q}`);
    return;
  }

  if (catSel && catSel.value !== found.key) {
    catSel.value = found.key;
    catSel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0)); // let #sheet-select rebuild
  }

  if (sheetSel) {
    const targetPath = found.item.path;
    let optIndex = -1;
    for (let i = 0; i < sheetSel.options.length; i++) {
      if (sheetSel.options[i].value === targetPath) {
        optIndex = i;
        break;
      }
    }
    if (optIndex < 0) optIndex = Math.min(found.i, sheetSel.options.length - 1);
    sheetSel.selectedIndex = Math.max(0, optIndex);
    sheetSel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  setStatus?.(`Jumped to ${found.key} → ${found.item.label || q}`);
  console.debug('[JUMP] Jumped', found);
};

// ---- Wire inline Jump button & Enter key ----
(function wireJump() {
  const read = () =>
    (document.getElementById('jump-input')?.value || els.sheetSelect?.value || '').trim();

  document.getElementById('jump-btn')?.addEventListener('click', () => {
    window.jumpToLabel(read());
  });

  document.getElementById('jump-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      window.jumpToLabel(read());
    }
  });
})();

// ====== MAPPING OVERLAY (single engine for erection sheets + member details) ======

let mapCurrentSheet = '';
let mapRects = [];

// In-memory status store: { "<job>|<sheet>|<label>": "yellow" | "pink" | "blue" | "green" }
window.pieceStatus = window.pieceStatus || {};

/**
 * Get the main sheet image element (viewer).
 */
function mapGetImageEl() {
  return document.getElementById('sheet-image') || document.getElementById('image');
}

/**
 * Get or create the overlay layer that sits on top of the image.
 */
function mapGetLayer() {
  const wrapper = document.getElementById('image-wrapper') || document.getElementById('viewer-wrapper');
  if (!wrapper) return null;

  // wrapper must be positioning context
  if (getComputedStyle(wrapper).position === 'static') {
    wrapper.style.position = 'relative';
  }

  let layer = document.getElementById('map-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'map-layer';
    wrapper.appendChild(layer);
  }

  // FORCE correct overlay behavior every time
  layer.style.position = 'absolute';
  layer.style.left = '0';
  layer.style.top = '0';
  layer.style.right = '0';
  layer.style.bottom = '0';
  layer.style.zIndex = '9999';
  layer.style.pointerEvents = 'none'; // layer ignores clicks; boxes handle clicks

  return layer;
}


/**
 * Remove all hotspot boxes.
 */
function mapClear() {
  const layer = mapGetLayer();
  if (!layer) return;
  while (layer.firstChild) layer.removeChild(layer.firstChild);
}

function statusKeyFor(label) {
  const jobId = window.currentJob?.id || 'job';
  const sheet = mapCurrentSheet || window.currentSheetLabel || 'sheet';
  const tag = String(label || '').trim().toUpperCase();
  return `${jobId}|${sheet}|${tag}`;
}

// ===== VIEW HISTORY (Back should walk Erection -> Member -> Clip -> ...) =====
// Back should ONLY undo click-and-fetch drilldowns
window.drillStack = window.drillStack || [];

function pushDrillState() {
  const st = captureViewState();
  if (!st.imgSrc) return; // must have an image showing
  const top = window.drillStack[window.drillStack.length - 1];
  if (top && top.imgSrc === st.imgSrc && top.sheetLabel === st.sheetLabel) return;
  window.drillStack.push(st);
  if (window.drillStack.length > 40) window.drillStack.shift();
}


function captureViewState() {
  const img = mapGetImageEl();
  return {
    stepId: document.querySelector('.step.active')?.id || 'step-4',
    imgSrc: img?.getAttribute('src') || '',
    sheetLabel: window.currentSheetLabel || mapCurrentSheet || '',
    mapCurrentSheet: mapCurrentSheet || '',
    mapRects: Array.isArray(mapRects) ? mapRects.slice() : [],
    // keep UI selection context so we don't fall back to Step 1
    category: els.categorySelect?.value || '',
    sheetPath: els.sheetSelect?.value || '',
    pos: window._pos || 0
  };
}

function restoreViewState(st) {
  setTimeout(renderMapNow, 0);
  if (!st) return;

  // Stay in viewer step (never kick to Step 1)
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  document.getElementById('step-4')?.classList.add('active');

  // Restore image FIRST (no dropdown rebuild events)
  const img = mapGetImageEl();
  if (img && st.imgSrc) {
    img.src = st.imgSrc;
  }

  // Restore mapping state in-memory
  window.currentSheetLabel = st.sheetLabel || '';
  mapCurrentSheet = st.mapCurrentSheet || st.sheetLabel || '';
  mapRects = Array.isArray(st.mapRects) ? st.mapRects : [];

  // Restore UI values WITHOUT dispatching change (dispatch is what breaks Back)
  if (els.categorySelect && typeof st.category === 'string') {
    els.categorySelect.value = st.category;
  }
  if (els.sheetSelect && typeof st.sheetPath === 'string') {
    els.sheetSelect.value = st.sheetPath;
  }
  if (typeof st.pos === 'number') {
    window._pos = st.pos;
  }

  // Paint boxes after image loads (or immediately if already loaded)
  if (img && (!img.naturalWidth || !img.naturalHeight)) {
    img.addEventListener('load', () => {
      renderMapNow();
    }, { once: true });
  } else {
    renderMapNow();
  }

  // IMPORTANT: DO NOT call _show() here.
  // _show() triggers setCurrentSheetLabel() which triggers loadMapForSheet()
  // and that’s why you’re getting spam 404s and bouncing.
}
 

/**
 * Draw all rects for the current sheet as .map-hit boxes.
 * Assumes rects are in *pixel* coordinates relative to the original image.
 */
function openFromHotspotRect(rect) {
  const job = window.currentJob;
  if (!job?.id) return;

  const img = mapGetImageEl();
  if (!img) return;


// ✅ history: remember where we were before drilling down
 pushDrillState();     // <-- only push in the whole app

  const label = String(rect.label || rect.tag || '').trim();
  const fetchPath = rect.fetch ? String(rect.fetch).replace(/^\.\/+/, '') : '';
  const mapPath   = rect.map   ? String(rect.map).replace(/^\.\/+/, '')   : '';

  const jobRoot = `jobs/${job.id}/`;
  const imgUrl = fetchPath ? (fetchPath.startsWith('jobs/') ? fetchPath : jobRoot + fetchPath) : '';
const mapUrl = mapPath ? (mapPath.startsWith('jobs/') ? mapPath : jobRoot + mapPath) : '';


  // show member image
  if (imgUrl) {
    img.src = imgUrl;
    img.onerror = () => console.warn('IMAGE LOAD FAILED:', img.src);
  } else {
    console.warn('[HOTSPOT] No rect.fetch for', label, rect);
  }

  // load member map (second-level)
  if (mapUrl) {
    fetch(mapUrl, { cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => {
        mapRects = Array.isArray(data) ? data : (data.rects || []);
        mapCurrentSheet = label || window.currentSheetLabel || '';
        window.currentSheetLabel = mapCurrentSheet;
        setStatus(`Map loaded for ${mapCurrentSheet} (${mapRects.length} hotspots) via ${mapPath}`);
        renderMapNow();
      })
      .catch(err => {
        console.warn('[HOTSPOT] Member map load failed:', mapUrl, err);
        mapRects = [];
        mapClear();
      });
  } else {
    mapRects = [];
    mapClear();
  }

  setStatus(`Showing: ${label || '(member)'}`);
}

function renderMapNow() {
    // ---- Supabase batch load (once per sheet) ----
  if (window.supabaseClient) {
    const jobCode = "industrial/24-36N"; // keep hard-coded for now
    const sheet = __normLabel(window.currentSheetLabel || window.mapCurrentSheet || "");
    const key = `${jobCode}::${sheet}`;

    if (sheet && window.__sheetStatusKey !== key) {
      window.__sheetStatusKey = key;

      sbLoadSheetStatuses(jobCode, sheet)
        .then(map => {
          window.__sheetStatusMap = map || {};
          console.log("[SUPABASE] sheet statuses loaded", sheet, Object.keys(window.__sheetStatusMap).length);

          // re-render once statuses arrive (so colors apply)
          renderMapNow();
        })
        .catch(e => {
          console.warn("[SUPABASE] batch load failed", e);
          window.__sheetStatusMap = {};
        });

      // stop this render; we will re-render after statuses load
      return;
    }
  }

  const img = mapGetImageEl();
  const layer = mapGetLayer();
  if (!img || !layer) return;

  mapClear();

  const naturalW = img.naturalWidth;
  const naturalH = img.naturalHeight;
  if (!naturalW || !naturalH) {
    // Image not fully loaded yet; try again after load.
    img.addEventListener('load', renderMapNow, { once: true });
    return;
  }

  if (!Array.isArray(mapRects) || mapRects.length === 0) {
    console.log('[MAP] No rects to render for', mapCurrentSheet);
    return;
  }

  mapRects.forEach(rect => {
    const x = Number(rect.x) || 0;
    const y = Number(rect.y) || 0;
    const w = Number(rect.w) || 0;
    const h = Number(rect.h) || 0;

    if (w <= 0 || h <= 0) return;

    const leftPct = (x / naturalW) * 100;
    const topPct = (y / naturalH) * 100;
    const widthPct = (w / naturalW) * 100;
    const heightPct = (h / naturalH) * 100;

    const hit = document.createElement('div');
    hit.className = 'map-hit';
    hit.style.position = 'absolute';
    hit.style.pointerEvents = 'auto';
    hit.style.zIndex = '10000';
    hit.style.left = leftPct + '%';
    hit.style.top = topPct + '%';
    hit.style.width = widthPct + '%';
    hit.style.height = heightPct + '%';

    const label = rect.label || rect.tag || '';
    if (label) {
      hit.dataset.label = label;
      hit.title = label;
     const norm = __normLabel(hit.dataset.label || '');
const saved = (window.__sheetStatusMap && window.__sheetStatusMap[norm]) || 'none';
// apply Supabase-loaded status classes on redraw
hit.classList.remove('status-yellow','status-pink','status-blue','status-green');

const clsMap = {
  yellow: 'status-yellow',
  pink:   'status-pink',
  blue:   'status-blue',
  green:  'status-green'
};

if (saved && saved !== 'none' && clsMap[saved]) {
  hit.classList.add(clsMap[saved]);
}

    }
      // apply saved status color for this piece (persisted)

    
// Click → either mark status (if in a marking mode) or jump (normal mode)
hit.addEventListener('click', (ev) => {
  ev.stopPropagation();

  // ✅ Mobile safety: ignore stray tap right after switching modes (prevents auto-clear)
  if (Date.now() - (window.__lastModeSwitchAt || 0) < 450) return;

  const hitEl = ev.currentTarget; // lock to this specific hotspot

  const raw = hitEl.dataset.label || '';
  const core = __normLabel(raw);

  const mode = window.currentStatusMode || 'none';
  const sheetKey = mapCurrentSheet || window.currentSheetLabel || '';

  // MARKING / CLEAR MODE
  if (mode !== 'none') {
    if (!window.popSupervisor?.isUnlocked?.()) {
      setStatus('Supervisor lock: press Ctrl+Shift+L to unlock.');
      return;
    }

    // remove all status classes first
    hitEl.classList.remove(
      'status-clear',
      'status-yellow',
      'status-pink',
      'status-blue',
      'status-green'
    );

    if (mode === 'clear') {
      // ERASER MODE (single piece)
      setSavedStatus(sheetKey, core, 'none');
      setStatus(`Cleared ${core}`);
    } else {
      const clsMap = {
        clear:  'status-clear',
        yellow: 'status-yellow',
        pink:   'status-pink',
        blue:   'status-blue',
        green:  'status-green'
      };

      if (clsMap[mode]) hitEl.classList.add(clsMap[mode]);
      setSavedStatus(sheetKey, core, mode);
    }

    return; // never navigate while marking or clearing
  }

  // NORMAL MODE: click & fetch
  if (rect.fetch || rect.map) {
    openFromHotspotRect(rect);
    return;
  }

  // fallback: jump behavior
  window._returnToSheet = window.currentSheetLabel;
  if (typeof window.jumpToLabel === 'function') {
    window.jumpToLabel(core || raw);
  }
});

  layer.appendChild(hit);
}); // end forEach

 
  console.log('[MAP] Rendered', mapRects.length, 'boxes for', mapCurrentSheet);
}
window.renderMapNow = renderMapNow;

/**
 * Load jobs/<currentJob.id>/maps/<label>.json
 * and normalize rects.
 */
async function loadMapForSheet(label) {
  const job = window.currentJob;
  if (!job || !job.id) {
    console.warn('[MAP] No job set; cannot load map for', label);
    mapRects = [];
    mapClear();
    return;
  }

  const sheetLabel = String(label || '').trim();
  if (!sheetLabel) {
    mapRects = [];
    mapClear();
    return;
  }

  const url = `jobs/${job.id}/maps/${sheetLabel}.json`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      console.warn('[MAP] No map file for', sheetLabel, url, res.status);
      setStatus(`No map found for ${sheetLabel} (tried: ${sheetLabel})`);
      mapRects = [];
      mapClear();
      return;
    }

    const data = await res.json();
    const rects = Array.isArray(data) ? data : (data.rects || []);
    mapRects = rects || [];
    mapCurrentSheet = sheetLabel;

    setStatus(`Map loaded for ${sheetLabel} (${mapRects.length} hotspots) via ${sheetLabel}.json`);
    console.log('[MAP] Loaded', mapRects.length, 'rect(s) for', sheetLabel, 'from', url);

    renderMapNow();
  } catch (err) {
    console.error('[MAP] Error loading map for', sheetLabel, err);
    setStatus(`Map error for ${sheetLabel}`);
    mapRects = [];
    mapClear();
  }
}

/**
 * ✅ FIX: Called whenever the viewer changes images.
 * If item.map exists (member detail), load that map file.
 * Else, load the standard erection sheet map: maps/<label>.json
 */
window.setCurrentSheetLabel = async function (label, item) {
  mapCurrentSheet = String(label || '').trim();
  window.currentSheetLabel = mapCurrentSheet;

  const job = window.currentJob;
  if (!job || !job.id) {
    mapRects = [];
    mapClear();
    return;
  }

  // If a specific map path exists on the item, use it.
  const mapPath = item && typeof item === 'object' ? item.map : '';
  if (mapPath) {
    // mapPath is relative to the job folder, e.g. "maps/members/125B.json"
    const clean = String(mapPath).replace(/^\.\/+/, '').replace(/\\/g, '/');
    const url = clean.startsWith('jobs/')
      ? clean
      : `jobs/${job.id}/${clean}`;

    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        console.warn('[MAP] Member map missing:', url, res.status);
        mapRects = [];
        mapClear();
        return;
      }
      const data = await res.json();
      const rects = Array.isArray(data) ? data : (data.rects || []);
      mapRects = rects || [];
      setStatus(`Map loaded for ${mapCurrentSheet} (${mapRects.length} hotspots) via ${mapPath}`);
      console.log('[MAP] Loaded member map', mapCurrentSheet, 'from', url);
      renderMapNow();
      return;
    } catch (err) {
      console.warn('[MAP] Member map load error:', err);
      mapRects = [];
      mapClear();
      return;
    }
  }

  // Otherwise: standard sheet map
  if (!mapCurrentSheet) {
    mapRects = [];
    mapClear();
    return;
  }
  await loadMapForSheet(mapCurrentSheet);
};

// Keep overlay roughly in sync on resize
window.addEventListener('resize', () => {
  renderMapNow();
});

// ---- DEMO: hide instructions ----
document.getElementById('demo-hide')?.addEventListener('click', () => {
  const box = document.getElementById('demo-instructions');
  if (box) box.style.display = 'none';
});

// ===== In-app Zoom Controls (scales image + map together) =====
(function initPopZoom(){
  let z = 1;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function applyZoom(){
    z = clamp(z, 0.6, 3.0); // 60% to 300%
    document.documentElement.style.setProperty('--popZoom', String(z));
    const resetBtn = document.getElementById('zoom-reset');
    if (resetBtn) resetBtn.textContent = Math.round(z * 100) + '%';

    if (typeof window.renderMapNow === 'function') window.renderMapNow();
  }

  window.setPopZoom = (val) => { z = Number(val) || 1; applyZoom(); };

  window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('zoom-in')?.addEventListener('click', () => { z *= 1.15; applyZoom(); });
    document.getElementById('zoom-out')?.addEventListener('click', () => { z /= 1.15; applyZoom(); });
    document.getElementById('zoom-reset')?.addEventListener('click', () => { z = 1; applyZoom(); });
    applyZoom();
  });
})();


// ===============================
// UNDO BUTTON WIRING
// ===============================
document.addEventListener('DOMContentLoaded', () => {
  const undoBtn = document.getElementById('undo-btn');
  if (!undoBtn) return;

  undoBtn.addEventListener('click', (e) => {
    e.preventDefault();
    window.undoLastStatus?.();
  });
   // ===============================
// Office Logistics — Daily Log SAVE
// ===============================
document.getElementById('office-daily-log-save')?.addEventListener('click', async () => {
  try {
    const sb = window.supabaseClient;
    if (!sb) {
      alert("Supabase not ready");
      return;
    }

    const jobCode = window.currentJob?.id || '';
    if (!jobCode) {
      alert("No job loaded");
      return;
    }

    const text = document.getElementById('office-daily-log').value || '';
    const today = new Date().toISOString().slice(0, 10);

    const { error } = await sb
      .from('daily_logs')
      .upsert({
        job_code: jobCode,
        log_date: today,
        appers: text,
        updated_at: new Date().toISOString()
      }, { onConflict: 'job_code,log_date' });

    if (error) throw error;

    document.getElementById('office-daily-log-meta').textContent =
      "Saved at " + new Date().toLocaleTimeString();

  } catch (err) {
    console.error(err);
    alert("Save failed — see console");
  }
});
// ===============================
// Office Logistics — Daily Log open/close
// ===============================
document.getElementById('office-open-dailylog-btn')?.addEventListener('click', () => {
  document.getElementById('office-dailylog-panel').style.display = 'block';
});

document.getElementById('office-daily-log-close')?.addEventListener('click', () => {
  document.getElementById('office-dailylog-panel').style.display = 'none';
});


});
// ===============================
// Inventory Mode (DEMO ONLY)
// ===============================
window.inventoryMode = false;

document.addEventListener("DOMContentLoaded", () => {
  const invBox = document.getElementById("inventory-mode");
  if (!invBox) return;

  invBox.addEventListener("change", () => {
    window.inventoryMode = invBox.checked;

    if (typeof setStatus === "function") {
      setStatus(window.inventoryMode
        ? "Inventory mode ON — click a piece to toggle checkmark."
        : "Inventory mode OFF.");
    }
  });
});
// ===============================
// Offload Inventory — open page
// ===============================
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('open-inventory');
  if (!btn) return;

  btn.addEventListener('click', () => {
    // hide all steps
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    // show inventory step
    document.getElementById('step-inventory')?.classList.add('active');

    if (typeof setStatus === 'function') setStatus('Offload Inventory');
  });
});

// ===============================
// Step Navigation FIX (Back/Next)
// ===============================
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('button[data-go]').forEach(btn => {
    btn.addEventListener('click', () => {
      const n = parseInt(btn.getAttribute('data-go'), 10);
      if (!n) return;

      document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
      document.getElementById(`step-${n}`)?.classList.add('active');
    });
  });
});

// ===============================
// Offload Inventory — populate list
// ===============================
function isErectionSheetLabel(label) {
  const s = String(label || '').trim().toUpperCase();
  return /^E[-_ ]?\d+$/.test(s);   // matches E0, E1, E-3, etc.
}

function getOffloadSourceItems() {
  // use the big Inventory/All bucket if present
  if (window.groups?.Inventory) return window.groups.Inventory;
  if (window.groups?.All) return window.groups.All;

  // fallback to any global list
  if (window.allItems) return window.allItems;
  if (window.currentItems) return window.currentItems;

  return [];
}
function populateInventoryList() {
  const container = document.getElementById('inv-list');
  if (!container) return;

  container.innerHTML = '';

  const items = window.currentIndex?.Inventory || [];
  items.forEach(it => {
  const label = it.label || it.name || '(unknown)';

  const row = document.createElement('div');

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'inv-cb';
  cb.dataset.label = label;

  const text = document.createElement('span');
  text.textContent = label;

  row.appendChild(cb);
  row.appendChild(text);
  container.appendChild(row);
});
}

// run when opening inventory page
document.getElementById('open-inventory')?.addEventListener('click', () => {
  setTimeout(populateInventoryList, 50);
});

// ===============================
// Offload Inventory — Step 2 button (delegated click)
// ===============================
document.addEventListener('click', (ev) => {
  const btn = ev.target?.closest?.('#open-inventory-step2');
  if (!btn) return;

  ev.preventDefault();

  // show inventory page
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  document.getElementById('step-inventory')?.classList.add('active');
  setTimeout(populateInventoryList, 50);

  if (typeof setStatus === 'function') setStatus('Offload Inventory');
});