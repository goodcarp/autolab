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
    $('#key-grid').innerHTML = rows.map(k => `<div class="key-item" tabindex="0" role="button" data-part="${k.part}" data-n="${k.n}"><span class="num">${k.n}</span><span>${k.label}</span></div>`).join('');
    this.keyEls = [...document.querySelectorAll('.key-item')];
    for (const el of this.keyEls) {
      el.addEventListener('pointerenter', () => cb.onKeyHover(el.dataset.part));
      el.addEventListener('pointerleave', () => cb.onKeyHover(this.keyEls.find(row => row === document.activeElement)?.dataset.part || null));
      el.addEventListener('focus', () => cb.onKeyHover(el.dataset.part));
      el.addEventListener('blur', () => cb.onKeyHover(this.keyEls.find(row => row.matches(':hover'))?.dataset.part || null));
      el.addEventListener('click', () => cb.onKeyHover(el.dataset.part));
      el.addEventListener('keydown', e => {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!e.repeat) el.click(); }
      });
    }
    $('#instr-grid').innerHTML = cfg.instr.map(r => `<div class="k">${r.k}</div><div class="v" id="instr-${r.id}">—</div>`).join('');
    this.instrEls = Object.fromEntries(cfg.instr.map(r => [r.id, document.getElementById('instr-' + r.id)]));
    $('#view-btns').innerHTML = cfg.views.map(v => `<button class="btn" data-view="${v.id}">${v.label}</button>`).join('');
    $('#motion-btns').innerHTML = cfg.motions.map(m => `<button class="btn" data-motion="${m.id}">${m.label}</button>`).join('');
    this.viewBtns = [...document.querySelectorAll('[data-view]')]; this.motionBtns = [...document.querySelectorAll('[data-motion]')];
    for (const b of this.viewBtns) b.addEventListener('click', () => cb.onView(b.dataset.view));
    for (const b of this.motionBtns) b.addEventListener('click', () => cb.onMotion(b.dataset.motion));
    this.tourBtn = document.createElement('button');
    this.tourBtn.id = 'tour-btn'; this.tourBtn.className = 'btn'; this.tourBtn.type = 'button';
    this.tourBtn.textContent = 'TOUR'; this.tourBtn.title = 'Start tour (T)';
    this.tourBtn.setAttribute('aria-pressed', 'false');
    this.tourBtn.addEventListener('click', () => cb.onTour());
    $('#motion-btns').append(this.tourBtn);
    this.tourCard = document.createElement('section');
    this.tourCard.id = 'tour-card'; this.tourCard.hidden = true;
    this.tourCard.setAttribute('role', 'status'); this.tourCard.setAttribute('aria-live', 'polite');
    this.tourCard.innerHTML = '<div class="tour-step"></div><div class="tour-title"></div><p class="tour-caption"></p><div class="tour-hint"></div>';
    $('#sheet').append(this.tourCard);
    this.key = $('#key'); this.instr = $('#instr'); this.vt = $('#viewtitle'); this.tt = $('#tooltip');
    // one control dissolves every card away so the drawing can be read on its own
    const cardsBtn = $('#cards-toggle');
    this.setCards = (on, noPersist) => {
      document.body.classList.toggle('cards-off', !on);
      cardsBtn.title = on ? 'Hide panels (H)' : 'Show panels (H)';
      cardsBtn.setAttribute('aria-label', on ? 'Hide the drawing panels' : 'Show the drawing panels');
      if (!noPersist) try { localStorage.setItem('r2.cards', on ? '1' : '0'); } catch (e) {}
    };
    // The sheet opens bare; the drawing panels are opt-in (H, the corner toggle, or ?cards=1).
    // Standalone the sheet opens bare and the panels are opt-in; framed inside the configurator it opens
    // with its panels, because there the sheet is the whole point of the view.
    const framed = (() => { try { return !!window.top && window.top !== window; } catch (e) { return true; } })();
    let cardsOn = framed;
    try { const saved = localStorage.getItem('r2.cards'); if (saved !== null) cardsOn = saved === '1'; } catch (e) {}
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
  setAgentTools(api) {
    const chip = document.getElementById('agent-chip');
    chip.textContent = api.registered ? `${api.tools.length} AGENT TOOLS` : 'MANUAL MODE';
    chip.hidden = !!api.framed;   // framed, the host page's chip speaks for the tools
    chip.classList.toggle('registered', api.registered);
    if (this.agentToolsReady) return;
    this.agentToolsReady = true;
    const panel = document.getElementById('agent-tools');
    const list = document.getElementById('agent-tools-list');
    const summaries = {
      start_tour: 'Start the guided vehicle tour.', stop_tour: 'Stop at the current tour step.',
      get_state: 'Read the current scene and camera.', set_view: 'Choose a standard drawing view.',
      set_motion: 'Control drive, lights, panels and assembly.', set_camera: 'Set an absolute camera pose.',
      orbit_camera: 'Orbit or zoom around the current target.', list_parts: 'List the named vehicle components.',
      get_part: 'Inspect one component and its bounds.', frame_part: 'Centre and zoom onto one component.',
      highlight_part: 'Select a component on the drawing.', set_annotations: 'Show or hide the drawing cards.',
      get_specification: 'Read the model’s published figures.', measure: 'Measure between component box centres.',
      list_visible_parts: 'What the camera sees, by component and coverage.', clearance: 'Nearest surface-to-surface gap between two components.',
      frame_point: 'Look at a coordinate in the vehicle frame.',
      reset: 'Restore the opening view and motions.',
    };
    for (const tool of api.tools) {
      const name = document.createElement('dt'), description = document.createElement('dd');
      name.textContent = tool.name;
      description.textContent = summaries[tool.name];
      list.append(name, description);
    }
    const toggle = open => { panel.hidden = !open; chip.setAttribute('aria-expanded', String(open)); };
    chip.addEventListener('click', () => toggle(panel.hidden));
    document.getElementById('agent-tools-close').addEventListener('click', () => { toggle(false); chip.focus(); });
    panel.addEventListener('keydown', e => {
      if (e.key === 'Escape') { toggle(false); chip.focus(); }
    });
    toggle(new URLSearchParams(location.search).get('tools') === '1');
  }
  showTour(step, state) {
    clearTimeout(this.tourTimer);
    this.tourCard.hidden = false;
    this.tourCard.querySelector('.tour-step').textContent = `STEP ${state.step} OF ${state.of}`;
    this.tourCard.querySelector('.tour-title').textContent = step.title;
    this.tourCard.querySelector('.tour-caption').textContent = step.caption;
    this.tourCard.querySelector('.tour-hint').textContent = 'PRESS ANY KEY OR CLICK TO STOP';
    this.tourBtn.classList.add('toggled'); this.tourBtn.setAttribute('aria-pressed', 'true');
    this.tourBtn.title = 'Stop tour (T)';
  }
  stopTour(state, reason) {
    clearTimeout(this.tourTimer);
    this.tourBtn.classList.remove('toggled'); this.tourBtn.setAttribute('aria-pressed', 'false');
    this.tourBtn.title = 'Start tour (T)';
    this.tourCard.querySelector('.tour-step').textContent = `TOUR ${reason === 'complete' ? 'COMPLETE' : 'STOPPED'} · STEP ${state.step} OF ${state.of}`;
    this.tourCard.querySelector('.tour-hint').textContent = reason === 'error' ? 'TOOL CALL FAILED' : '';
    this.tourTimer = setTimeout(() => { this.tourCard.hidden = true; }, 2000);
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
