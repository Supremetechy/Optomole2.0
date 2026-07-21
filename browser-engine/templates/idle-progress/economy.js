/**
 * economy.js (idle-progress) — the pure incremental-game model.
 *
 * No PixiJS / DOM here: this is the resource loop that the IdleScene renders and
 * the template bridges into the shared StateStore/QuestEngine. It owns the three
 * things an idle game is made of:
 *
 *   generators : each buyable unit adds passive Insight/sec (owned count scales
 *                cost up and rate up; owning-count milestones multiply output)
 *   upgrades   : one-time purchases that multiply all output (global) or the
 *                manual-gather click power (click)
 *   tick loop  : balance += rate * dt every frame; lifetime tracks total earned
 *
 * The loop: gather/produce Insight -> buy generators & upgrades -> produce faster.
 */

/** Compact idle-style number formatting: 1234 -> "1.23K", 5e6 -> "5.00M". */
export function fmt(n) {
  n = Number(n) || 0;
  if (n < 1000) return String(Math.floor(n));
  const units = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
  const tier = Math.floor(Math.log10(n) / 3);
  const scaled = n / Math.pow(1000, tier);
  const suffix = units[tier] || `e${tier * 3}`;
  return `${scaled.toFixed(scaled < 10 ? 2 : scaled < 100 ? 1 : 0)}${suffix}`;
}

// Owned-count thresholds that each grant a ×2 output milestone for a generator.
const OWN_MILESTONES = [10, 25, 50, 100];

export class Economy {
  constructor({ generators = [], upgrades = [], clickPower = 1 } = {}) {
    this.generators = generators.map((g) => ({ owned: 0, ...g }));
    this.upgrades = upgrades.map((u) => ({ bought: false, ...u }));
    this.baseClickPower = clickPower;
    this.balance = 0; // spendable Insight
    this.lifetime = 0; // total Insight ever earned (progression)
    this.clicks = 0;
  }

  // ---- Derived values -------------------------------------------------------

  /** Product of every purchased global-multiplier upgrade. */
  globalMult() {
    let m = 1;
    for (const u of this.upgrades) if (u.bought && u.kind === 'global') m *= u.mult;
    return m;
  }

  clickPower() {
    let m = 1;
    for (const u of this.upgrades) if (u.bought && u.kind === 'click') m *= u.mult;
    return this.baseClickPower * m * this.globalMult();
  }

  /** ×2 for each owned-count milestone this generator has passed. */
  milestoneMult(g) {
    let m = 1;
    for (const t of OWN_MILESTONES) if (g.owned >= t) m *= 2;
    return m;
  }

  generatorRate(g) {
    return g.baseRate * g.owned * this.milestoneMult(g) * this.globalMult();
  }

  /** Next-unit cost, growing exponentially with units owned. */
  generatorCost(g) {
    return Math.ceil(g.baseCost * Math.pow(g.costGrowth, g.owned));
  }

  ratePerSec() {
    let r = 0;
    for (const g of this.generators) r += this.generatorRate(g);
    return r;
  }

  // ---- Actions --------------------------------------------------------------

  gather() {
    const gain = this.clickPower();
    this.balance += gain;
    this.lifetime += gain;
    this.clicks++;
    return gain;
  }

  canBuyGenerator(g) {
    return this.balance >= this.generatorCost(g);
  }

  /** Buy one unit. Returns { ok, firstUnlock } so the scene can react. */
  buyGenerator(g) {
    const cost = this.generatorCost(g);
    if (this.balance < cost) return { ok: false };
    this.balance -= cost;
    const firstUnlock = g.owned === 0;
    g.owned += 1;
    return { ok: true, firstUnlock, hitMilestone: OWN_MILESTONES.includes(g.owned) };
  }

  canBuyUpgrade(u) {
    return !u.bought && this.balance >= u.cost;
  }

  buyUpgrade(u) {
    if (u.bought || this.balance < u.cost) return { ok: false };
    this.balance -= u.cost;
    u.bought = true;
    return { ok: true };
  }

  /** Advance passive production by dt seconds. */
  tick(dt) {
    const gain = this.ratePerSec() * dt;
    if (gain > 0) {
      this.balance += gain;
      this.lifetime += gain;
    }
    return gain;
  }

  // ---- Progress readouts ----------------------------------------------------

  ownedGeneratorCount() {
    return this.generators.filter((g) => g.owned > 0).length;
  }

  allGeneratorsUnlocked() {
    return this.generators.length > 0 && this.generators.every((g) => g.owned > 0);
  }

  allUpgradesBought() {
    return this.upgrades.length === 0 || this.upgrades.every((u) => u.bought);
  }
}
