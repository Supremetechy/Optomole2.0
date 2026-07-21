/**
 * IdleScene (idle-progress) — the playable incremental surface.
 *
 * Idle games are number/menu driven, so the interactive surface is crisp,
 * accessible DOM (like the HUD) layered over an ambient PixiJS backdrop of
 * rising "insight motes" (which also keeps the canvas alive for fade
 * transitions). The scene:
 *   - runs the Economy tick every frame (passive Insight production),
 *   - renders the gather button + generator cards + upgrade cards, refreshing
 *     live numbers and buy-affordability each frame,
 *   - bridges Economy -> StateStore so the shared HUD shows lifetime Insight,
 *     tier, concepts unlocked, and the milestone checklist,
 *   - completes milestones through the QuestEngine and reports full mastery.
 *
 * It owns its DOM and tears it down on exit(), so replay/scene-swap stays clean.
 */
import { fmt } from '../economy.js';

const PIXI = window.PIXI;

export class IdleScene {
  constructor(ctx, { economy, milestones, title, onComplete }) {
    this.ctx = ctx;
    this.economy = economy;
    this.milestones = milestones;
    this.title = title;
    this.onComplete = onComplete;

    this.container = new PIXI.Container();
    this._motes = [];
    this._t = 0;
    this._bridgeAcc = 0;
    this._completed = false;
    this._pulse = 0;
    this.genCards = [];
    this.upCards = [];
  }

  enter(ctx) {
    const size = ctx.runtime.size();
    this._spawnMotes(size);

    // Milestones -> shared quest log (scoped to this "lab" room for the HUD).
    for (const m of this.milestones) {
      ctx.quests.register('lab', { id: m.id, label: m.label, kind: 'progress', reward: { xp: 0 } });
    }
    ctx.state.set({
      currentRoom: { id: 'lab', title: this.title, index: 0, count: 1, summary: 'Invest Insight into concepts; each one you unlock produces more. Reach every milestone to fully master the material.' },
      hint: 'Click STUDY (or press E) to earn Insight, then buy concepts to automate it.',
    });
    ctx.state.logEvent('Entered the Mastery Lab');

    injectStyles();
    this._mountDom();
    this._bridgeState();
  }

  // ---- Ambient backdrop -----------------------------------------------------

  _spawnMotes({ width, height }) {
    for (let i = 0; i < 46; i++) {
      const m = new PIXI.Sprite(this.ctx.assets.get('particle'));
      m.anchor.set(0.5);
      m.tint = i % 3 === 0 ? 0x34d399 : i % 3 === 1 ? 0x67e8f9 : 0xa78bfa;
      m.x = Math.random() * width;
      m.y = Math.random() * height;
      m.scale.set(0.2 + Math.random() * 0.5);
      m._sp = 8 + Math.random() * 22;
      m._drift = (Math.random() - 0.5) * 12;
      m._base = 0.1 + Math.random() * 0.25;
      m.alpha = m._base;
      this.container.addChild(m);
      this._motes.push(m);
    }
  }

  // ---- DOM surface ----------------------------------------------------------

  _mountDom() {
    const root = document.createElement('div');
    root.className = 'oi-root';
    root.innerHTML = `
      <div class="oi-panel">
        <div class="oi-head">
          <p class="oi-k">Insight</p>
          <div class="oi-bal"><b id="oi-bal">0</b></div>
          <p class="oi-rate"><span id="oi-rate">+0 / sec</span> · <span id="oi-click">+1 / study</span></p>
          <button id="oi-gather" class="oi-gather">STUDY <em id="oi-gainlabel">+1</em></button>
        </div>
        <div class="oi-sect">
          <p class="oi-k">Concepts <span class="oi-sub" id="oi-gensub"></span></p>
          <div class="oi-list" id="oi-gens"></div>
        </div>
        <div class="oi-sect">
          <p class="oi-k">Upgrades</p>
          <div class="oi-list" id="oi-ups"></div>
        </div>
      </div>`;
    document.body.appendChild(root);
    this.dom = root;
    const $ = (id) => root.querySelector(id);

    this.balEl = $('#oi-bal');
    this.rateEl = $('#oi-rate');
    this.clickEl = $('#oi-click');
    this.gainLabel = $('#oi-gainlabel');
    this.genSub = $('#oi-gensub');

    $('#oi-gather').addEventListener('click', () => this._gather());

    // Generator cards
    const gens = $('#oi-gens');
    for (const g of this.economy.generators) {
      const card = document.createElement('div');
      card.className = 'oi-card';
      card.innerHTML = `
        <div class="oi-cardmain">
          <div class="oi-cardtop"><b class="oi-name"></b><span class="oi-owned">×0</span></div>
          <p class="oi-desc"></p>
          <p class="oi-contrib"></p>
        </div>
        <button class="oi-buy"><span class="oi-buylabel">Buy</span><em class="oi-cost"></em></button>`;
      card.querySelector('.oi-name').textContent = g.label;
      const buy = card.querySelector('.oi-buy');
      buy.addEventListener('click', () => this._buyGenerator(g, card));
      gens.appendChild(card);
      this.genCards.push({ g, card, ownedEl: card.querySelector('.oi-owned'), descEl: card.querySelector('.oi-desc'), contribEl: card.querySelector('.oi-contrib'), buy, costEl: card.querySelector('.oi-cost') });
    }

    // Upgrade cards
    const ups = $('#oi-ups');
    for (const u of this.economy.upgrades) {
      const card = document.createElement('div');
      card.className = 'oi-card';
      card.innerHTML = `
        <div class="oi-cardmain">
          <div class="oi-cardtop"><b class="oi-name"></b><span class="oi-tag"></span></div>
          <p class="oi-desc oi-descshown"></p>
        </div>
        <button class="oi-buy"><span class="oi-buylabel">Buy</span><em class="oi-cost"></em></button>`;
      card.querySelector('.oi-name').textContent = u.label;
      card.querySelector('.oi-desc').textContent = u.description;
      card.querySelector('.oi-tag').textContent = u.kind === 'click' ? 'click' : 'global';
      const buy = card.querySelector('.oi-buy');
      buy.addEventListener('click', () => this._buyUpgrade(u, card));
      ups.appendChild(card);
      this.upCards.push({ u, card, buy, costEl: card.querySelector('.oi-cost') });
    }
  }

  _gather() {
    const gain = this.economy.gather();
    this.ctx.audio?.play('pickup');
    this._pulse = 0.18;
    this.ctx.state.set({ hint: `+${fmt(gain)} Insight` });
  }

  _buyGenerator(g, card) {
    const res = this.economy.buyGenerator(g);
    if (!res.ok) {
      this.ctx.audio?.play('failure');
      return;
    }
    this.ctx.audio?.play('unlock');
    if (res.firstUnlock) {
      this.ctx.state.addKey(g.id, { id: g.id, label: g.label, icon: 'objective' });
      card.classList.add('oi-unlocked');
      const desc = card.querySelector('.oi-desc');
      desc.textContent = g.description;
      desc.classList.add('oi-descshown');
      this.ctx.state.logEvent(`Unlocked concept: ${g.label}`);
    }
    if (res.hitMilestone) {
      this.ctx.audio?.play('reward');
      this.ctx.state.logEvent(`${g.label} reached ×${g.owned} — output doubled!`);
    }
  }

  _buyUpgrade(u, card) {
    const res = this.economy.buyUpgrade(u);
    if (!res.ok) {
      this.ctx.audio?.play('failure');
      return;
    }
    this.ctx.audio?.play('reward');
    card.classList.add('oi-bought');
    card.querySelector('.oi-buylabel').textContent = 'Owned';
    this.ctx.state.logEvent(`Upgrade purchased: ${u.label}`);
  }

  // ---- Frame ----------------------------------------------------------------

  update(dt) {
    this._t += dt;
    this.economy.tick(dt);

    // Keyboard/interact -> gather.
    if (this.ctx.input.consumeInteract()) this._gather();

    // Ambient motes rise and wrap.
    const size = this.ctx.runtime.size();
    for (const m of this._motes) {
      m.y -= m._sp * dt;
      m.x += m._drift * dt;
      m.alpha = m._base + Math.sin(this._t * 2 + m.x) * 0.06;
      if (m.y < -10) {
        m.y = size.height + 10;
        m.x = Math.random() * size.width;
      }
    }

    this._refreshDom();

    // Bridge to the shared HUD ~10x/sec (cheap, avoids per-frame churn).
    this._bridgeAcc += dt;
    if (this._bridgeAcc >= 0.1) {
      this._bridgeAcc = 0;
      this._bridgeState();
      this._checkMilestones();
    }
  }

  _refreshDom() {
    if (!this.dom) return;
    const e = this.economy;
    this.balEl.textContent = fmt(e.balance);
    this.rateEl.textContent = `+${fmt(e.ratePerSec())} / sec`;
    const cp = e.clickPower();
    this.clickEl.textContent = `+${fmt(cp)} / study`;
    this.gainLabel.textContent = `+${fmt(cp)}`;
    this.genSub.textContent = `${e.ownedGeneratorCount()}/${e.generators.length} unlocked`;

    if (this._pulse > 0) {
      this._pulse = Math.max(0, this._pulse - 0.016);
      const s = 1 + this._pulse * 0.6;
      this.balEl.style.transform = `scale(${s.toFixed(3)})`;
    } else {
      this.balEl.style.transform = 'scale(1)';
    }

    for (const c of this.genCards) {
      c.ownedEl.textContent = `×${c.g.owned}`;
      c.contribEl.textContent = c.g.owned > 0 ? `producing +${fmt(e.generatorRate(c.g))} / sec` : `+${fmt(c.g.baseRate)} / sec each`;
      c.costEl.textContent = fmt(e.generatorCost(c.g));
      c.buy.disabled = !e.canBuyGenerator(c.g);
    }
    for (const c of this.upCards) {
      if (c.u.bought) {
        c.buy.disabled = true;
        c.costEl.textContent = '';
      } else {
        c.costEl.textContent = fmt(c.u.cost);
        c.buy.disabled = !e.canBuyUpgrade(c.u);
      }
    }
  }

  _bridgeState() {
    const e = this.economy;
    const doneTiers = this.milestones.filter((m) => this._milestoneMet(m)).length;
    this.ctx.state.set({
      currency: Math.floor(e.balance),
      xp: Math.floor(e.lifetime),
      level: 1 + doneTiers,
    });
  }

  _milestoneMet(m) {
    const e = this.economy;
    if (m.kind === 'generatorsOwned') return e.ownedGeneratorCount() >= m.target;
    if (m.kind === 'lifetime') return e.lifetime >= m.target;
    if (m.kind === 'upgradesBought') return e.upgrades.filter((u) => u.bought).length >= m.target;
    return false;
  }

  _checkMilestones() {
    let allDone = true;
    for (const m of this.milestones) {
      if (this._milestoneMet(m)) {
        this.ctx.quests.complete(m.id); // no-op if already complete
      } else {
        allDone = false;
      }
    }
    if (allDone && !this._completed) {
      this._completed = true;
      this.ctx.state.set({ hint: 'Fully mastered — every concept and milestone complete!' });
      this.onComplete?.();
    }
  }

  resize() {
    /* DOM panel is responsive via CSS; motes reflow naturally. */
  }

  exit() {
    if (this.dom) {
      this.dom.remove();
      this.dom = null;
    }
  }
}

function injectStyles() {
  if (document.getElementById('oi-idle-styles')) return;
  const style = document.createElement('style');
  style.id = 'oi-idle-styles';
  style.textContent = `
  .oi-root { position: fixed; inset: 0; z-index: 25; display: flex; justify-content: center; align-items: flex-start; pointer-events: none; padding: 84px 16px 96px; font-family: Inter, system-ui, -apple-system, sans-serif; }
  .oi-panel { pointer-events: auto; width: min(560px, 94vw); max-height: calc(100vh - 180px); overflow-y: auto; border: 1px solid rgba(103,232,249,.25); background: rgba(5,12,24,.92); border-radius: 14px; padding: 18px; box-shadow: 0 24px 90px rgba(0,0,0,.55); backdrop-filter: blur(12px); color: #e5f4ff; }
  .oi-k { margin: 0 0 8px; color: #67e8f9; font-size: 10px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
  .oi-sub { color: #64748b; font-weight: 700; letter-spacing: 0; text-transform: none; }
  .oi-head { text-align: center; padding-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,.08); }
  .oi-bal { line-height: 1; }
  .oi-bal b { font-size: 44px; font-weight: 900; color: #fff; display: inline-block; transform-origin: center; transition: transform .05s ease-out; }
  .oi-rate { margin: 8px 0 14px; color: #94a3b8; font-size: 13px; font-weight: 600; }
  .oi-gather { pointer-events: auto; width: 100%; padding: 15px; border: 0; border-radius: 10px; font-size: 16px; font-weight: 900; letter-spacing: .04em; color: #03131d; background: linear-gradient(90deg, #67e8f9, #34d399); cursor: pointer; transition: transform .06s ease, filter .1s ease; }
  .oi-gather:hover { filter: brightness(1.08); }
  .oi-gather:active { transform: translateY(1px) scale(.99); }
  .oi-gather em { font-style: normal; opacity: .8; margin-left: 6px; }
  .oi-sect { margin-top: 16px; }
  .oi-list { display: flex; flex-direction: column; gap: 8px; }
  .oi-card { display: flex; align-items: stretch; gap: 10px; border: 1px solid rgba(255,255,255,.1); border-radius: 10px; background: rgba(255,255,255,.03); padding: 10px 12px; }
  .oi-card.oi-unlocked { border-color: rgba(52,211,153,.35); }
  .oi-card.oi-bought { opacity: .6; border-color: rgba(52,211,153,.4); }
  .oi-cardmain { flex: 1; min-width: 0; }
  .oi-cardtop { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .oi-name { font-size: 14px; color: #fff; }
  .oi-owned { font-size: 12px; font-weight: 800; color: #67e8f9; }
  .oi-tag { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; color: #a78bfa; border: 1px solid rgba(167,139,250,.4); border-radius: 999px; padding: 2px 7px; }
  .oi-desc { margin: 4px 0 0; color: #64748b; font-size: 12px; line-height: 1.4; display: none; }
  .oi-desc.oi-descshown { display: block; color: #94a3b8; }
  .oi-contrib { margin: 5px 0 0; color: #34d399; font-size: 12px; font-weight: 700; }
  .oi-buy { align-self: center; min-width: 92px; padding: 9px 10px; border: 0; border-radius: 8px; background: #1e293b; color: #e5f4ff; font-weight: 800; font-size: 12px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 2px; transition: background .1s ease; }
  .oi-buy:not(:disabled):hover { background: #334155; }
  .oi-buy:not(:disabled) { background: #0e7490; }
  .oi-buy:disabled { opacity: .45; cursor: not-allowed; }
  .oi-buy em { font-style: normal; font-size: 13px; font-weight: 900; color: #67e8f9; }
  .oi-buy:disabled em { color: #cbd5e1; }
  @media (max-width: 860px) {
    .oi-root { padding-top: 150px; align-items: flex-start; }
    .oi-panel { max-height: calc(100vh - 230px); }
  }
  @media (prefers-reduced-motion: reduce) { .oi-bal b, .oi-gather { transition: none; } }
  `;
  document.head.appendChild(style);
}
