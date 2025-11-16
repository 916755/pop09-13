console.log("POP BOOT ✓ script file loaded", Date.now());
'use strict';

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
  get(){ return document.getElementById('sheet-image') || document.getElementById('image'); }
});


function setStatus(msg){ if(els.status) els.status.textContent = msg; console.log('[STATUS]', msg); }
window.setStatus = setStatus;

// ---------- URL resolver ----------
function resolveImageUrl(item, kind='image'){
  const job = window.currentJob || {};
  const jobRoot  = job.id ? `jobs/${job.id}/` : 'jobs/';
  const imagesDir = (job.imagesDir || `${jobRoot}images/`).replace(/^\.\/+/, '');
  const thumbsDir = (job.thumbsDir || `${jobRoot}thumbs/`).replace(/^\.\/+/, '');
  let raw = (kind==='thumb'
    ? (item.thumb || item.thumbnail || item.thumbPath || '')
    : (item.image || item.path || item.file || '')
  ) || '';

  if (/^(https?:)?\/\//i.test(raw) || raw.startsWith('/')) return raw;

  let s = String(raw).replace(/^\.\/+/, '').replace(/\\/g,'/');
  if (job.id && s.startsWith(`jobs/${job.id}/`)) return s;
  if (s.startsWith('images/')) return imagesDir + s.slice(7);
  if (s.startsWith('thumbs/')) return thumbsDir + s.slice(7);
  if (s.startsWith('assets/')) return jobRoot + s;
  if (s.includes('/')) return imagesDir + s;
  return (kind==='thumb' ? thumbsDir : imagesDir) + s;
}
function buildSrc(_jobId, it){ return resolveImageUrl(it,'image'); }

// ---------- Helpers ----------
function makeOptions(list, first='Select...'){
  const o = [`<option value="">${first}</option>`];
  for (const it of list) {
    if (typeof it === 'string') o.push(`<option value="${it}">${it}</option>`);
    else if (it && typeof it === 'object')
      o.push(`<option value="${it.value ?? it.name ?? ''}">${it.label ?? it.name ?? it.value ?? ''}</option>`);
  }
  return o.join('');
}
function naturalByLabel(a, b) {
  const pick = (x) => (x?.label ?? x?.name ?? x?.tag ?? x?.path ?? '').toString();
  return pick(a).localeCompare(pick(b), undefined, { numeric: true, sensitivity: 'base' });
}
function group(items) {
  const out = { All: [] };
  for (const it of items) {
    const rawPath = String(it.path || it.image || it.file || '').replace(/^\.\//, '');
    const segs = rawPath.split('/');
    let cat = '';
    for (const marker of ['images', 'assets']) {
      const idx = segs.findIndex(s => s.toLowerCase() === marker);
      if (idx !== -1 && segs[idx + 1] && segs.length > idx + 2) { cat = segs[idx + 1]; break; }
    }
    if (!cat) {
      const base = (it.label || it.name || segs.at(-1) || '');
      const m = base.match(/^([A-Za-z]+)[-_]/);
      cat = m ? m[1] : 'Misc';
    }
    const norm = {
      name:  it.name  || it.label || segs.at(-1) || 'item',
      label: it.label || it.name  || rawPath,
      path:  it.image || it.path  || it.file     || rawPath,
      thumb: it.thumb || it.thumbnail || it.thumbPath
    };
    (out[cat] ||= []).push(norm);
    out.All.push(norm);
  }
  return out;
}

// ---------- Load index for current job ----------
async function loadIndexForCurrentJob(){
  if (!window.currentJob?.indexUrl){ setStatus('No access code set.'); return; }
  setStatus('Loading index…');
  try {
    console.log('[DEBUG] indexUrl =', window.currentJob.indexUrl);
    const res = await fetch(window.currentJob.indexUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    const arr = Array.isArray(raw) ? raw : Object.values(raw || {}).flat();
    if (!arr.length){ setStatus('No items in index.'); return; }

    const groups = group(arr);
    Object.keys(groups).forEach(k => { groups[k] = (groups[k] || []).slice().sort(naturalByLabel); });
    window.currentIndex = groups;

    // categories
    const cats = Object.keys(groups).sort((a, b) => {
      if (a === 'All' && b !== 'All') return 1;
      if (b === 'All' && a !== 'All') return -1;
      return a.localeCompare(b);
    });
    if (els.categorySelect) {
      els.categorySelect.innerHTML = makeOptions(
        cats.map(c => ({ value: c, label: `${c} (${(groups[c] || []).length})` })), 'Select a category'
      );
      els.categorySelect.value = '';
    }
    if (els.step2Next) els.step2Next.disabled = true;
    if (els.sheetSelect) els.sheetSelect.innerHTML = makeOptions([], 'Select a sheet');

    // state
    window._allItems = arr;
    window._items = [];
    window._pos = 0;

    // viewer show
    window._show = function(i){
      window._pos = Math.max(0, Math.min(i, window._items.length - 1));
      const it = window._items[window._pos];
      const img = els.image;
      if (!img) { console.warn('[SHOW] no #image element'); return; }

      const wrap = document.getElementById('image-wrapper');
      if (wrap && getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';

      let cap = document.getElementById('image-caption');
      if (!cap && wrap) {
        cap = document.createElement('div');
        cap.id = 'image-caption';
        Object.assign(cap.style, {
          position: 'absolute', left: '12px', bottom: '12px',
          padding: '6px 10px', borderRadius: '10px',
          background: 'rgba(0,0,0,0.65)', color: '#fff',
          fontSize: '14px', lineHeight: '1.2', pointerEvents: 'none',
          maxWidth: 'calc(100% - 24px)', whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis'
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
img.addEventListener('dragstart', e => e.preventDefault(), { passive:false });
      img.onerror = () => console.warn('IMAGE LOAD FAILED:', img.src);

      const label = it.label || it.name || it.path || '';
      const cat = els.categorySelect?.value || '';
      if (cap) cap.textContent = `${cat ? cat + ' • ' : ''}${label}  (${window._pos + 1}/${window._items.length})`;
      setStatus(`Showing: ${label} (${window._pos + 1}/${window._items.length})`);
      if (els.sheetSelect) els.sheetSelect.value = it.path;
    };

    // wire once
    if (!window._wired){
      window._wired = true;

      els.categorySelect?.addEventListener('change', () => {
        const cat = els.categorySelect.value;
        const base = window.currentIndex[cat] || [];
        if (els.step2Next) els.step2Next.disabled = !cat;

        const q = (els.filterInput?.value || '').toLowerCase();
        window._items = q
          ? base.filter(it => (`${it.name||''} ${it.label||''} ${it.path||''}`).toLowerCase().includes(q))
          : base;

        if (els.sheetSelect) {
          els.sheetSelect.innerHTML = makeOptions(
            window._items.map(x => ({ value: x.path, label: x.label || x.name || x.path })), 'Select a sheet'
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
          ? base.filter(it => (`${it.name||''} ${it.label||''} ${it.path||''}`).toLowerCase().includes(q))
          : base;

        if (els.sheetSelect) {
          els.sheetSelect.innerHTML = makeOptions(
            window._items.map(x => ({ value: x.path, label: x.label || x.name || x.path })), 'Select a sheet'
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

    setStatus(`Index loaded. ${Object.keys(groups).length} categor${Object.keys(groups).length===1?'y':'ies'} found.`);
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
  const TYPES = ["industrial","commercial","institutional","residential","special"];
  async function tryIndex(base){
    try { const r = await fetch(`jobs/${base}/index/assets-index.json`, {cache:'no-store'}); return r.ok; }
    catch { return false; }
  }
  async function pickBase(){
    const cand = [];
    const imgSrc = document.getElementById('image')?.src || '';
    const m = imgSrc.match(/\/jobs\/(.+?)\/(?:images|index)\b/);
    if (m) cand.push(m[1]);

    const type = document.getElementById('type-select')?.value || '';
    const code = document.getElementById('job-input')?.value || '';
    if (code) {
      if (type) cand.push(`${type}/${code}`);
      cand.push(code);
      TYPES.forEach(t => cand.push(`${t}/${code}`));
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
      setStatus('Index not found. Check /jobs/<type>/<code>/index/assets-index.json');
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
  const next  = els.step1Next;
  if (!input || !next) return;

  const enable = () => { next.disabled = !input.value.trim(); };
  input.addEventListener('input', enable); enable();

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
function __normTag(s){ return String(s||'').replace(/[^0-9A-Za-z]/g,'').toUpperCase(); }

window.jumpToLabel = async function(raw){
  const q = String(raw||'').trim();
  if (!q) { setStatus?.('Type a tag (e.g., 133B)'); return; }

  const idx = window.currentIndex || {};
  const catSel   = els.categorySelect;
  const sheetSel = els.sheetSelect;
  const want = __normTag(q);

  const searchCat = (key)=>{
    const arr = idx[key] || [];
    for (let i=0;i<arr.length;i++){
      const it = arr[i];
      const label = it.label || it.name || it.path || '';
      if (__normTag(label) === want) return { key, i, item: it };
    }
    return null;
  };

  let found = searchCat(catSel?.value);
  if (!found){
    for (const k of Object.keys(idx)){ if ((found = searchCat(k))) break; }
  }
  if (!found){ setStatus?.(`Not found: ${q}`); return; }

  if (catSel && catSel.value !== found.key){
    catSel.value = found.key;
    catSel.dispatchEvent(new Event('change', {bubbles:true}));
    await new Promise(r => setTimeout(r, 0)); // let #sheet-select rebuild
  }

  if (sheetSel){
    const targetPath = found.item.path;
    let optIndex = -1;
    for (let i=0;i<sheetSel.options.length;i++){
      if (sheetSel.options[i].value === targetPath) { optIndex = i; break; }
    }
    if (optIndex < 0) optIndex = Math.min(found.i, sheetSel.options.length - 1);
    sheetSel.selectedIndex = Math.max(0, optIndex);
    sheetSel.dispatchEvent(new Event('change', {bubbles:true}));
  }

  setStatus?.(`Jumped to ${found.key} → ${found.item.label || q}`);
  console.debug('[JUMP] Jumped', found);
};

// ---- Wire inline Jump button & Enter key ----
(function wireJump(){
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

// ====== MAPPING ENGINE (overlay for erection sheets) ======
(() => {
  // --- Local state ---
  let _currentSheetLabel = '';
  let _currentMap = [];           // [{x,y,w,h,label}]
  let _wiredImageLoad = false;
// === BULK IMPORT (CSV or NDJSON) → saves maps/<SHEET>.json and renders ===
async function bulkImportHotspots(pastedText) {
  function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    const header = lines.shift().split(',').map(s=>s.trim());
    const req = ['sheet','target','x','y','w','h'];
    req.forEach(k=>{ if(!header.includes(k)) throw new Error('CSV missing column: '+k); });
    return lines.map((line, idx) => {
      const cols = line.split(','); const row = {};
      header.forEach((h,i)=> row[h]=cols[i]?.trim());
      return row;
    });
  }
  function parseNDJSON(text) {
    return text.trim().split(/\r?\n/).map((line, i)=>{
      try { return JSON.parse(line); } catch(e){ throw new Error('Bad JSON on line '+(i+1)); }
    });
  }
  function toNumber(v){ const n = Number(v); if(!Number.isFinite(n)) throw new Error('Non-numeric: '+v); return n; }

  const looksJSON = pastedText.trim().startsWith('{') || pastedText.trim().startsWith('[') || pastedText.trim().startsWith('{');
  const looksNDJSON = /^[\s]*\{/.test(pastedText.trim()) && pastedText.includes('\n');
  let rows;
  if (looksNDJSON) rows = parseNDJSON(pastedText);
  else rows = parseCSV(pastedText);

  // validate + normalize
  const bySheet = {};
  for (const r of rows) {
    const sheet = String(r.sheet || r.SHEET || r.page || '').trim();
    const target = String(r.target || r.TAG || r.label || '').trim();
    if (!sheet) throw new Error('Row missing "sheet"');
    if (!target) throw new Error(`Row on sheet ${sheet} missing "target"`);
    const x = toNumber(r.x), y = toNumber(r.y), w = toNumber(r.w), h = toNumber(r.h);
    const label = (r.label ?? `${sheet}-${target}`).toString();
    const confidence = r.confidence != null ? Number(r.confidence) : 1.0;
    const rect = { x, y, w, h, label, target, meta:{confidence}};
    (bySheet[sheet] ||= []).push(rect);
  }

  // write per-sheet map files (app-side “virtual write” + re-render)
  // You likely already have a saveMap(sheet, rects) helper; otherwise:
  async function saveMap(sheet, rects){
    // If you have a backend, POST here. For your file-based dev flow, we simulate:
    // 1) expose a download to save maps locally, or
    // 2) if running with a local server that supports PUT (optional), call it.
    // Here we just stash in-memory and re-render.
    window.__maps__ ||= {};
    window.__maps__[sheet] = rects;
    if (typeof console !== 'undefined') console.log(`[IMPORT] ${sheet}: +${rects.length} rects`);
  }

  for (const [sheet, rects] of Object.entries(bySheet)) {
    await saveMap(sheet, rects);
    if (typeof setCurrentSheetLabel === 'function' && typeof renderMapNow === 'function') {
      setCurrentSheetLabel(sheet);
      renderMapNow();
      // --- Guard: clear any tag selection when switching to an erection sheet ---
if (window.state) {
  state.mode = 'erection';
  state.category = 'Erection-E-0-11';  // adjust if you have other folders later
  state.selectedTag = null;
  state.jumpTag = null;
  state.searchTerm = '';
}

    }
  }

  alert(`Imported ${rows.length} hotspots across ${Object.keys(bySheet).length} sheet(s). Low-confidence entries are flagged in meta.confidence.`);
}

  // --- Helpers ---
  const getImageEl = () => document.getElementById('sheet-image') || document.getElementById('image');

  const getMapLayer = () => document.getElementById('map-layer');

  // Guess a sheet like E3 / E-3 from the current item
  function _guessSheetLabelFromItem(it){
    const s = String(it?.label || it?.name || it?.path || '');
    const m = s.match(/\b(E[-\s]?\d+)\b/i);
    if (!m) return '';
    const raw = m[1].toUpperCase().replace(/\s+/g,'');
    // Normalize to no-hyphen form: E3
    return raw.replace(/^E[-\s]?(\d+)/, 'E$1');
  }

  function _scaleForImage() {
    const img = getImageEl();
    if (!img || !img.naturalWidth || !img.naturalHeight) {
      return { kx: 1, ky: 1, left: 0, top: 0 };
    }
    const rect = img.getBoundingClientRect();
    const rw = img.clientWidth || rect.width;
    const rh = img.clientHeight || rect.height;
    const kx = rw / img.naturalWidth;
    const ky = rh / img.naturalHeight;
    return { kx, ky, left: img.offsetLeft, top: img.offsetTop };
  }

  function clearMap(){
    const layer = getMapLayer();
    if (layer) layer.innerHTML = '';
  }

  function __drawRect(r){
    const layer = getMapLayer();
    const img = getImageEl();
    if (!layer || !img) return;

    const { kx, ky, left, top } = _scaleForImage();
    const x = Math.round(left + r.x * kx);
    const y = Math.round(top  + r.y * ky);
    const w = Math.max(1, Math.round(r.w * kx));
    const h = Math.max(1, Math.round(r.h * ky));

    const hit = document.createElement('div');
    hit.className = 'hit';
    Object.assign(hit.style, {
      position: 'absolute',
      left: x + 'px',
      top: y + 'px',
      width: w + 'px',
      height: h + 'px',
      border: '2px dashed rgba(255,255,255,0.8)',
      boxSizing: 'border-box',
      cursor: 'pointer'
    });

    const lab = document.createElement('div');
    lab.className = 'label';
    lab.textContent = r.label || '';
    Object.assign(lab.style, {
      position: 'absolute',
      left: x + 'px',
      top: (y - 4) + 'px',
      background: 'rgba(0,0,0,0.65)',
      color: '#fff',
      fontSize: '12px',
      lineHeight: '1',
      padding: '2px 6px',
      borderRadius: '8px',
      pointerEvents: 'none'
    });

    hit.addEventListener('click', (e) => {
      e.stopPropagation();
      if (r.label) window.jumpToLabel?.(r.label);
    });

    layer.appendChild(hit);
    layer.appendChild(lab);
  }

  function renderMapNow(){
    const img = getImageEl();
    const layer = getMapLayer();
    if (!img || !layer) return;

    clearMap();
    if (!img.complete || !img.naturalWidth) return;

    const wrap = document.getElementById('image-wrapper');
    if (wrap && getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';

    layer.style.position = 'absolute';
    layer.style.inset = '0';
    layer.style.pointerEvents = 'auto';
    layer.style.zIndex = '10000'
    layer.style.touchAction = 'none';

    for (const r of _currentMap) __drawRect(r);
  }
  window.renderMapNow = renderMapNow;

 // Load maps/<SHEET>.json with smart name + schema handling
async function __loadMapForSheet(sheetLabel) {
  _currentMap = [];
  clearMap();
  if (!sheetLabel) return;
  const jobId = window.currentJob?.id;
  if (!jobId) return;

  // --- normalization line (add this right here) ---
  sheetLabel = sheetLabel.replace(/-/g, ""); // normalize: E-3 → E3
  // ------------------------------------------------

  const base = `jobs/${jobId}/maps/`;
  const cand = [];
  const push = (s) => { if (s && !cand.includes(s)) cand.push(s); };

  // Try: as-is, no-hyphen, with-hyphen
  push(sheetLabel);
  push(sheetLabel.replace(/^E[-\s]?\s*(\d+)/, "E$1"));

  // Normalize various schemas to [{x,y,w,h,label}]
  const norm = (data) => {
    if (!data) return [];
    const list = Array.isArray(data)
      ? data
      : (Array.isArray(data.hotspots) ? data.hotspots : []);
    const out = [];
    for (const it of list) {
      if (!it) continue;
      let x, y, w, h, label;
      label = it.label || it.name || "";
      if (Array.isArray(it.rect) && it.rect.length >= 4) {
        [x, y, w, h] = it.rect.map(n => Number(n) || 0);
      } else {
        x = Number(it.x) || 0;
        y = Number(it.y) || 0;
        w = Number(it.w) || 0;
        h = Number(it.h) || 0;
      }
      if (w > 0 && h > 0) out.push({ x, y, w, h, label });
    }
    return out;
  };

  // Try each candidate filename until one loads
  for (const name of cand) {
    const url = `${base}${name}.json`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      const out = norm(data);
      _currentMap = out;
      console.log(`[STATUS] Map loaded for ${sheetLabel} (${out.length} hotspots) via ${name}.json`);
      return;
    } catch (err) {
      // try next candidate
    }
  }

  // Nothing found
  _currentMap = [];
  console.log(`[STATUS] No map found for ${sheetLabel} (tried: ${cand.join(", ")})`);
}

  // Public API
  window.setCurrentSheetLabel = async function setCurrentSheetLabel(label){
    _currentSheetLabel = String(label || '').trim();
    await __loadMapForSheet(_currentSheetLabel);
    renderMapNow();
    window.setStatus?.(`Map loaded for ${_currentSheetLabel} (${_currentMap.length} hotspots)`);
  };

  // Keep overlay in sync with whatever image is showing
  async function _autoSetFromCurrentItem(){
    const it = window._items?.[window._pos];
    const guess = _guessSheetLabelFromItem(it);
    if (guess && guess !== _currentSheetLabel) {
      await window.setCurrentSheetLabel(guess);
    } else {
      if (!guess) { _currentMap = []; clearMap(); }
      else renderMapNow();
    }
  }

  function _ensureImageWires(){
    if (_wiredImageLoad) return;
    _wiredImageLoad = true;

    const img = getImageEl();
    if (img){
      img.addEventListener('load', () => { _autoSetFromCurrentItem(); });
      if (img.complete) setTimeout(renderMapNow, 0);
    }

    window.addEventListener('resize', () => renderMapNow());
    // Keep overlays in step with UI changes if those elements exist
    window.addEventListener('popstate', () => setTimeout(_autoSetFromCurrentItem, 0));
    document.getElementById('category-select')?.addEventListener('change', () => setTimeout(_autoSetFromCurrentItem, 0));
    document.getElementById('sheet-select')?.addEventListener('change',   () => setTimeout(_autoSetFromCurrentItem, 0));
    document.getElementById('filter-input')?.addEventListener('input',    () => setTimeout(_autoSetFromCurrentItem, 0));
  }

  // Hook into your viewer's _show, if present
  const _origShow = window._show;
  window._show = function(i){
    _origShow?.(i);
    _ensureImageWires();
    const img = getImageEl();
    if (img?.complete) _autoSetFromCurrentItem();
  };
  // expose importer so you can call it from console
window.bulkImportHotspots = bulkImportHotspots;

})();