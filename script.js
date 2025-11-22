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
      setStatus(`Showing: ${label} (${window._pos + 1}/${window._items.length})`);setCurrentSheetLabel(label);
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


// ====== MAPPING OVERLAY (single engine for erection sheets) ======

let mapCurrentSheet = '';
let mapRects = [];

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
  let layer = document.getElementById('map-layer');
  if (!layer) {
    const wrapper = document.getElementById('image-wrapper') || document.getElementById('viewer-wrapper');
    if (!wrapper) return null;
    layer = document.createElement('div');
    layer.id = 'map-layer';
    wrapper.appendChild(layer);
  }
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

/**
 * Draw all rects for the current sheet as .map-hit boxes.
 * Assumes rects are in *pixel* coordinates relative to the original image.
 */
function renderMapNow() {
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

    const leftPct   = (x / naturalW) * 100;
    const topPct    = (y / naturalH) * 100;
    const widthPct  = (w / naturalW) * 100;
    const heightPct = (h / naturalH) * 100;

    const hit = document.createElement('div');
    hit.className = 'map-hit';
    hit.style.position = 'absolute';
    hit.style.left   = leftPct + '%';
    hit.style.top    = topPct + '%';
    hit.style.width  = widthPct + '%';
    hit.style.height = heightPct + '%';

    const label = rect.label || rect.tag || '';
    if (label) {
      hit.dataset.label = label;
      hit.title = label;
    }

    // Click → jump to that tag/sheet
    hit.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const raw = ev.currentTarget.dataset.label || '';
      const upper = String(raw).trim().toUpperCase();

      // If label looks like "E3-133B", strip sheet part → "133B"
      const core = upper.split('-').slice(-1)[0];

      console.log('[MAP] Click hotspot →', raw, 'core', core);

      if (typeof window.jumpToLabel === 'function') {
        window.jumpToLabel(core || raw);
      }
    });

    layer.appendChild(hit);
  });

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
    // Accept either [{...}] or { rects: [...] }
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
 * Called whenever the viewer changes sheets.
 * Your _show() function already calls setCurrentSheetLabel(label).
 */
window.setCurrentSheetLabel = async function(label) {
  mapCurrentSheet = String(label || '').trim();
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
