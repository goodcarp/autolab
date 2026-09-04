// DOM panels: header, key to items, instrumentation, controls, title block, view title, tooltip, sheet zones.
export class UI {
  constructor(cfg, cb) {
    this.cfg = cfg; this.cb = cb;
    const $ = (s) => document.querySelector(s);
    $('#hdr-left-title').textContent = cfg.hdrLeft.title; $('#hdr-left-sub').textContent = cfg.hdrLeft.sub;
    $('#hdr-right-title').textContent = cfg.hdrRight.title; $('#hdr-right-sub').textContent = cfg.hdrRight.sub;
    $('#tb-title').innerHTML = cfg.title.map(t => `<div>${t}</div>`).join('');
    $('#tb-grid').innerHTML = cfg.titleBlock.map(c => `<div class="tb-cell"><div class="tb-lbl">${c.lbl}</div><div class="tb-val${c.red ? ' red' : ''}">${c.val}</div></div>`).join('');
    for (const cls of ['zone-top', 'zone-bottom']) $('.' + cls).innerHTML = cfg.zonesX.map(z => `<span>${z}</span>`).join('');
    for (const cls of ['zone-left', 'zone-right']) $('.' + cls).innerHTML = cfg.zonesY.map(z => `<span>${z}</span>`).join('');
    // key items: two columns (1-5, 6-10) laid out row-wise in a 2-col grid
    const items = cfg.keyItems; const rows = [];
    for (let i = 0; i < 5; i++) { rows.push(items[i]); rows.push(items[i + 5]); }
    $('#key-grid').innerHTML = rows.map(k => `<div class="key-item" data-part="${k.part}" data-n="${k.n}"><span class="num">${k.n}</span><span>${k.label}</span></div>`).join('');
    this.keyEls = [...document.querySelectorAll('.key-item')];
    for (const el of this.keyEls) {
      el.addEventListener('pointerenter', () => cb.onKeyHover(el.dataset.part));
      el.addEventListener('pointerleave', () => cb.onKeyHover(null));
    }
    $('#instr-grid').innerHTML = cfg.instr.map(r => `<div class="k">${r.k}</div><div class="v" id="instr-${r.id}">—</div>`).join('');
    this.instrEls = Object.fromEntries(cfg.instr.map(r => [r.id, document.getElementById('instr-' + r.id)]));
    $('#view-btns').innerHTML = cfg.views.map(v => `<button class="btn" data-view="${v.id}">${v.label}</button>`).join('');
    $('#motion-btns').innerHTML = cfg.motions.map(m => `<button class="btn" data-motion="${m.id}">${m.label}</button>`).join('');
    this.viewBtns = [...document.querySelectorAll('[data-view]')]; this.motionBtns = [...document.querySelectorAll('[data-motion]')];
    for (const b of this.viewBtns) b.addEventListener('click', () => cb.onView(b.dataset.view));
    for (const b of this.motionBtns) b.addEventListener('click', () => cb.onMotion(b.dataset.motion));
    this.key = $('#key'); this.instr = $('#instr'); this.vt = $('#viewtitle'); this.tt = $('#tooltip');
    // one control dissolves every card away so the drawing can be read on its own
    const cardsBtn = $('#cards-toggle');
    this.setCards = (on) => {
      document.body.classList.toggle('cards-off', !on);
      cardsBtn.title = on ? 'Hide panels (H)' : 'Show panels (H)';
      cardsBtn.setAttribute('aria-label', on ? 'Hide the drawing panels' : 'Show the drawing panels');
      try { localStorage.setItem('r2.cards', on ? '1' : '0'); } catch (e) {}
    };
    let cardsOn = true;
    try { cardsOn = localStorage.getItem('r2.cards') !== '0'; } catch (e) {}
    document.body.classList.add('no-card-anim');
    this.setCards(cardsOn);
    requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('no-card-anim')));
    cardsBtn.addEventListener('click', () => this.setCards(document.body.classList.contains('cards-off')));
    // minimize / maximize the three content boxes (remembered per viewer)
    let saved = {}; try { saved = JSON.parse(localStorage.getItem('r2.min') || '{}'); } catch (e) { saved = {}; }
    for (const id of ['key', 'instr', 'titleblock']) {
      const panel = document.getElementById(id); const btn = panel.querySelector('.panel-min'); if (!btn) continue;
      const apply = (min) => { panel.classList.toggle('min', min); btn.textContent = min ? '+' : '−'; btn.title = min ? 'Maximize' : 'Minimize'; btn.setAttribute('aria-label', (min ? 'Maximize ' : 'Minimize ') + id); };
      apply(!!saved[id]);
      btn.addEventListener('click', () => { const min = !panel.classList.contains('min'); apply(min); if (btn.dataset.noPersist) return; saved[id] = min; try { localStorage.setItem('r2.min', JSON.stringify(saved)); } catch (e) {} });
    }
  }
  setView(view) { for (const b of this.viewBtns) b.classList.toggle('active', b.dataset.view === view); }
  setToggle(id, on) { const b = this.motionBtns.find(x => x.dataset.motion === id); if (b) b.classList.toggle('toggled', !!on); }
  pulse(id) { const b = this.motionBtns.find(x => x.dataset.motion === id); if (b) { b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse'); } }
  showPanels(on) { this.key.classList.toggle('hidden', !on); this.instr.classList.toggle('hidden', !on); }
  showViewTitle(view) {
    const t = this.cfg.viewTitles[view];
    if (!t) { this.vt.classList.remove('show'); return; }
    this.vt.querySelector('.vt-name').textContent = t[0]; this.vt.querySelector('.vt-sub').textContent = t[1]; this.vt.classList.add('show');
  }
  setInstr(vals) { for (const [k, v] of Object.entries(vals)) { const el = this.instrEls[k]; if (el && el.textContent !== v) el.textContent = v; } }
  highlightKey(partName) { const k = partName && partName.startsWith('wheel') ? 'wheelFR' : partName; for (const el of this.keyEls) el.classList.toggle('hot', el.dataset.part === k); }
  tooltip(x, y, name, desc) {
    if (!name) { this.tt.classList.remove('show'); return; }
    this.tt.querySelector('.tt-name').textContent = name; this.tt.querySelector('.tt-desc').textContent = desc || '';
    const stage = document.getElementById('stage').getBoundingClientRect();
    const tw = this.tt.offsetWidth || 330; let lx = x + 22, ly = y - 68; if (lx + tw > stage.width - 8) lx = x - tw - 12; if (ly < 10) ly = y + 24;
    this.tt.style.left = lx + 'px'; this.tt.style.top = ly + 'px'; this.tt.classList.add('show');
  }
}
