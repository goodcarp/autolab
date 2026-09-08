// DOM panels: header, key to items, instrumentation, controls, title block, view title, tooltip, sheet zones.
import { placePartTooltip, partTooltipLeader } from './tooltip-layout.js';
// The same sheet ships at /garage/ and /configure/garage/, including under a site prefix.
export function garageSiteBase(pathname) {
  const match = pathname.match(/^(.*\/)(?:configure\/)?garage(?:\/|$)/);
  if (!match) return '/';
  return match[1].replace(/configure\/$/, '');
}

export function setPressed(button, pressed, className) {
  button.classList.toggle(className, !!pressed);
  button.setAttribute('aria-pressed', String(!!pressed));
}

export class UI {
  constructor(cfg, cb) {
    this.cfg = cfg; this.cb = cb;
    const $ = (s) => document.querySelector(s);
    for (const link of document.querySelectorAll('[data-site-link]')) link.href = garageSiteBase(location.pathname) + link.dataset.siteLink;
    $('#hdr-left-title').textContent = cfg.hdrLeft.title; $('#hdr-left-sub').textContent = cfg.hdrLeft.sub;
    $('#hdr-right-title').textContent = cfg.hdrRight.title; $('#hdr-right-sub').textContent = cfg.hdrRight.sub;
    $('#tb-title').innerHTML = cfg.title.map(t => `<div>${t}</div>`).join('');
    $('#tb-grid').innerHTML = cfg.titleBlock.map(c => `<div class="tb-cell"><div class="tb-lbl">${c.lbl}</div><div class="tb-val${c.red ? ' red' : ''}">${c.val}</div></div>`).join('');
    for (const cls of ['zone-top', 'zone-bottom']) $('.' + cls).innerHTML = cfg.zonesX.map(z => `<span>${z}</span>`).join('');
    for (const cls of ['zone-left', 'zone-right']) $('.' + cls).innerHTML = cfg.zonesY.map(z => `<span>${z}</span>`).join('');
    // key items: two columns (1-5, 6-10) laid out row-wise in a 2-col grid
    const items = cfg.keyItems; const rows = [];
    for (let i = 0; i < 5; i++) { rows.push(items[i]); rows.push(items[i + 5]); }
    const keyMarkup = list => list.map(k => `<button type="button" class="key-item" data-part="${k.part}" data-n="${k.n}"><span class="num">${k.n}</span><span>${k.label}</span></button>`).join('');
    $('#key-grid').innerHTML = keyMarkup(rows);
    $('#compact-key-grid').innerHTML = keyMarkup(items);
    this.keyEls = [...document.querySelectorAll('.key-item')];
    for (const el of this.keyEls) {
      el.addEventListener('pointerenter', () => cb.onKeyHover(el.dataset.part));
      el.addEventListener('pointerleave', () => cb.onKeyHover(this.keyEls.find(row => row === document.activeElement)?.dataset.part || null));
      el.addEventListener('focus', () => cb.onKeyHover(el.dataset.part));
      el.addEventListener('blur', () => cb.onKeyHover(this.keyEls.find(row => row.matches(':hover'))?.dataset.part || null));
      el.addEventListener('click', () => { this.closeSheet(); cb.onKeySelect?.(el.dataset.part); });
    }
    $('#instr-grid').innerHTML = cfg.instr.map(r => `<div class="k">${r.k}</div><div class="v" id="instr-${r.id}">—</div>`).join('');
    this.instrEls = Object.fromEntries(cfg.instr.map(r => [r.id, document.getElementById('instr-' + r.id)]));
    const views = cfg.views.map(v => `<button type="button" class="btn" data-view="${v.id}" aria-pressed="false">${v.label}</button>`).join('');
    const motions = cfg.motions.map(m => `<button type="button" class="btn" data-motion="${m.id}" aria-pressed="false">${m.label}</button>`).join('');
    $('#view-btns').innerHTML = views; $('#compact-view-btns').innerHTML = views;
    $('#motion-btns').innerHTML = motions; $('#compact-motion-btns').innerHTML = motions;
    this.viewBtns = [...document.querySelectorAll('[data-view]')]; this.motionBtns = [...document.querySelectorAll('[data-motion]')];
    // Quick controls stay open so views and motions can be combined or undone.
    for (const b of this.viewBtns) b.addEventListener('click', () => cb.onView(b.dataset.view));
    for (const b of this.motionBtns) b.addEventListener('click', () => cb.onMotion(b.dataset.motion));
    this.tourBtn = document.createElement('button');
    this.tourBtn.id = 'tour-btn'; this.tourBtn.className = 'btn'; this.tourBtn.type = 'button';
    this.tourBtn.textContent = 'TOUR'; this.tourBtn.title = 'Start tour (T)';
    this.tourBtn.setAttribute('aria-pressed', 'false');
    this.tourBtn.addEventListener('click', () => cb.onTour());
    $('#motion-btns').append(this.tourBtn);
    this.compactTourBtn = this.tourBtn.cloneNode(true);
    this.compactTourBtn.id = 'compact-tour-btn';
    this.compactTourBtn.addEventListener('click', () => cb.onTour());
    $('#compact-motion-btns').append(this.compactTourBtn);
    const dialog = $('#compact-sheet');
    const launchers = [...document.querySelectorAll('[data-sheet]')];
    let sheetLauncher = null;
    const clearExpanded = () => { for (const b of launchers) b.setAttribute('aria-expanded', 'false'); };
    this.closeSheet = (restoreFocus = true) => {
      if (!dialog.open) return;
      dialog.close();
      clearExpanded();
      if (restoreFocus) sheetLauncher?.focus();
    };
    for (const launcher of launchers) launcher.addEventListener('click', () => {
      const section = launcher.dataset.sheet;
      if (dialog.open && sheetLauncher === launcher) { this.closeSheet(); return; }
      this.closeSheet(false);
      sheetLauncher = launcher;
      for (const name of ['views', 'parts', 'more']) $('#compact-' + name).hidden = name !== section;
      $('#compact-sheet-title').textContent = launcher.textContent;
      dialog.dataset.section = section;
      const modal = section === 'parts';
      dialog.setAttribute('aria-modal', String(modal));
      launcher.setAttribute('aria-expanded', 'true');
      if (modal) dialog.showModal(); else dialog.show();
      (modal ? $('#compact-sheet-close') : $('#compact-' + section + ' [aria-pressed="true"]') || $('#compact-' + section + ' button')).focus();
    });
    // Native close events are queued: an older panel closing must not clear
    // the next launcher's state after a quick Views → More switch.
    dialog.addEventListener('close', () => { if (!dialog.open) clearExpanded(); });
    dialog.addEventListener('click', e => { if (e.target === dialog) this.closeSheet(); });
    $('#compact-sheet-close').addEventListener('click', () => this.closeSheet());
    document.addEventListener('pointerdown', e => {
      if (dialog.open && dialog.getAttribute('aria-modal') === 'false' && !dialog.contains(e.target) && !e.target.closest?.('[data-sheet]')) this.closeSheet(false);
    }, true);
    document.addEventListener('keydown', e => {
      if (dialog.open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeSheet(); }
    }, true);
    $('#reset-btn').addEventListener('click', () => { this.closeSheet(); cb.onReset(); });
    this.compactMedia = window.matchMedia('(max-width: 980px), (max-height: 520px)');
    this.compactMedia.addEventListener('change', () => { if (!this.compactMedia.matches) this.closeSheet(); });
    this.tourCard = document.createElement('section');
    this.tourCard.id = 'tour-card'; this.tourCard.hidden = true;
    this.tourCard.setAttribute('role', 'status'); this.tourCard.setAttribute('aria-live', 'polite');
    this.tourCard.innerHTML = '<div class="tour-step"></div><div class="tour-title"></div><p class="tour-caption"></p><div class="tour-hint"></div>';
    $('#sheet').append(this.tourCard);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => {
      document.documentElement.style.setProperty('--tour-space', this.tourCard.hidden ? '0px' : `${this.tourCard.offsetHeight + 12}px`);
    }).observe(this.tourCard);
    this.key = $('#key'); this.instr = $('#instr'); this.vt = $('#viewtitle'); this.tt = $('#tooltip');
    // one control dissolves every card away so the drawing can be read on its own
    const cardsBtn = $('#cards-toggle');
    this.setCards = (on, noPersist) => {
      document.body.classList.toggle('cards-off', !on);
      cardsBtn.title = on ? 'Hide panels (H)' : 'Show panels (H)';
      cardsBtn.setAttribute('aria-label', on ? 'Hide the drawing panels' : 'Show the drawing panels');
      cardsBtn.setAttribute('aria-pressed', String(on));
      setPressed($('#compact-cards-btn'), on, 'toggled');
      $('#key').inert = !on || $('#key').classList.contains('hidden');
      $('#instr').inert = !on || $('#instr').classList.contains('hidden'); $('#titleblock').inert = !on;
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
    $('#compact-cards-btn').addEventListener('click', () => this.setCards(document.body.classList.contains('cards-off')));
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
    const compactAgent = document.getElementById('compact-agent-btn');
    compactAgent.textContent = chip.textContent;
    compactAgent.hidden = !!api.framed;
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
    compactAgent.addEventListener('click', () => { this.closeSheet(); toggle(true); document.getElementById('agent-tools-close').focus(); });
    const restoreAgentFocus = () => (this.compactMedia.matches ? document.querySelector('[data-sheet="more"]') : chip).focus();
    document.getElementById('agent-tools-close').addEventListener('click', () => { toggle(false); restoreAgentFocus(); });
    panel.addEventListener('keydown', e => {
      if (e.key === 'Escape') { toggle(false); restoreAgentFocus(); }
    });
    toggle(new URLSearchParams(location.search).get('tools') === '1');
  }
  showTour(step, state) {
    clearTimeout(this.tourTimer);
    this.tourCard.hidden = false;
    document.body.classList.add('tour-active');
    this.tourCard.querySelector('.tour-step').textContent = `STEP ${state.step} OF ${state.of}`;
    this.tourCard.querySelector('.tour-title').textContent = step.title;
    this.tourCard.querySelector('.tour-caption').textContent = step.caption;
    this.tourCard.querySelector('.tour-hint').textContent = 'PRESS ANY KEY OR CLICK TO STOP';
    this.tourBtn.classList.add('toggled'); this.tourBtn.setAttribute('aria-pressed', 'true');
    setPressed(this.compactTourBtn, true, 'toggled');
    this.tourBtn.title = 'Stop tour (T)';
  }
  stopTour(state, reason) {
    clearTimeout(this.tourTimer);
    this.tourBtn.classList.remove('toggled'); this.tourBtn.setAttribute('aria-pressed', 'false');
    setPressed(this.compactTourBtn, false, 'toggled');
    this.tourBtn.title = 'Start tour (T)';
    this.tourCard.querySelector('.tour-step').textContent = `TOUR ${reason === 'complete' ? 'COMPLETE' : 'STOPPED'} · STEP ${state.step} OF ${state.of}`;
    this.tourCard.querySelector('.tour-hint').textContent = reason === 'error' ? 'TOOL CALL FAILED' : '';
    this.tourTimer = setTimeout(() => { this.tourCard.hidden = true; document.body.classList.remove('tour-active'); }, 2000);
  }
  setView(view) { for (const b of this.viewBtns) setPressed(b, b.dataset.view === view, 'active'); }
  setToggle(id, on) { for (const b of this.motionBtns.filter(x => x.dataset.motion === id)) setPressed(b, on, 'toggled'); }
  pulse(id) { const b = this.motionBtns.find(x => x.dataset.motion === id); if (b) { b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse'); } }
  showPanels(on) { this.key.classList.toggle('hidden', !on); this.instr.classList.toggle('hidden', !on); this.key.inert = !on || document.body.classList.contains('cards-off'); this.instr.inert = this.key.inert; }
  selectPart(part) {
    const label = document.getElementById('selected-part');
    label.textContent = part ? `${part.label} · ${part.desc || ''}` : '';
    label.hidden = !part; // a screen-reader status; the visible description is the anchored card
  }
  showViewTitle(view) {
    const t = this.cfg.viewTitles[view];
    if (!t) { this.vt.classList.remove('show'); return; }
    this.vt.querySelector('.vt-name').textContent = t[0]; this.vt.querySelector('.vt-sub').textContent = t[1]; this.vt.classList.add('show');
  }
  setInstr(vals) { for (const [k, v] of Object.entries(vals)) { const el = this.instrEls[k]; if (el && el.textContent !== v) el.textContent = v; } }
  highlightKey(partName) { const k = partName && partName.startsWith('wheel') ? 'wheelFR' : partName; for (const el of this.keyEls) el.classList.toggle('hot', el.dataset.part === k); }
  tooltip(x, y, name, desc, layout) {
    if (!name || !layout?.anchor) {
      this.tt.classList.remove('show'); this.tooltipPointer?.classList.remove('show');
      this.tooltipPlacement = null;
      return;
    }
    // Content, measurement, position and pointer are committed in this one
    // frame. The old part can never flash at the new part's coordinates.
    const title = this.tt.querySelector('.tt-name'), description = this.tt.querySelector('.tt-desc');
    if (title.textContent !== name) title.textContent = name;
    if (description.textContent !== (desc || '')) description.textContent = desc || '';
    const stage = document.getElementById('stage').getBoundingClientRect();
    const compact = stage.width < 640 || stage.height < 360;
    this.tt.classList.toggle('compact', compact);
    const cardWidth = this.tt.offsetWidth, cardHeight = this.tt.offsetHeight;
    const key = JSON.stringify([layout.partId, name, desc, stage.width, stage.height, cardWidth, cardHeight, layout.obstacles]);
    if (this.tooltipPlacement?.key !== key) {
      const card = { ...placePartTooltip({ width: stage.width, height: stage.height, cardWidth, cardHeight,
        pointer: layout.anchor, vehicle: layout.vehicle, obstacles: layout.obstacles }), width: cardWidth, height: cardHeight };
      this.tooltipPlacement = { key, card, side: partTooltipLeader(card, layout.anchor).side };
      this.tt.style.left = card.x + 'px'; this.tt.style.top = card.y + 'px';
    }
    if (!this.tooltipPointer) {
      this.tooltipPointer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.tooltipPointer.id = 'part-pointer'; this.tooltipPointer.setAttribute('aria-hidden', 'true');
      document.getElementById('stage').append(this.tooltipPointer);
    }
    const { anchor, edge, elbow } = partTooltipLeader(this.tooltipPlacement.card, layout.anchor, this.tooltipPlacement.side);
    const f = n => n.toFixed(1);
    this.tooltipPointer.setAttribute('viewBox', `0 0 ${stage.width} ${stage.height}`);
    this.tooltipPointer.innerHTML = `<path d="M ${f(anchor.x)} ${f(anchor.y)} L ${f(elbow.x)} ${f(elbow.y)} L ${f(edge.x)} ${f(edge.y)}"/><circle class="part-pointer__point" cx="${f(anchor.x)}" cy="${f(anchor.y)}" r="2.5"/>`
      + (layout.number == null ? '' : `<circle class="part-pointer__badge" cx="${f(elbow.x)}" cy="${f(elbow.y)}" r="10"/><text x="${f(elbow.x)}" y="${f(elbow.y + 3.5)}">${layout.number}</text>`);
    this.tooltipPointer.classList.add('show'); this.tt.classList.add('show');
  }
}
