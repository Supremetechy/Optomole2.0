/**
 * board.js (board-resource-sim) — the pure turn/resource model.
 *
 * No PixiJS / DOM here: this owns the board state (token position, laps, which
 * concept spaces have been collected) and the three resources the sim juggles:
 *
 *   knowledge : the score — gained from concept + event spaces
 *   coins     : a soft currency — gained on concepts / laps, drained by hazards
 *   energy    : refuels each lap at START, drained by hazard landings (0..100)
 *
 * The BoardScene walks the token and asks the model to `resolve()` each space it
 * passes or lands on; the model mutates resources and returns an effect
 * descriptor the scene turns into feedback + HUD updates.
 *
 *   roll d6 -> step across spaces -> resolve(pass|land) -> resource change / event
 */
export class BoardModel {
  constructor({ spaces = [] } = {}) {
    this.spaces = spaces; // [{ id, type, label, description, knowledge, coins, energy }]
    this.pos = 0; // index into spaces (0 is START)
    this.laps = 0;
    this.turns = 0;
    this.knowledge = 0;
    this.coins = 0;
    this.energy = 100;
    this.collected = new Set();
  }

  get conceptCount() {
    return this.spaces.filter((s) => s.type === 'concept').length;
  }

  /** Roll a six-sided die. (Browser runtime — Math.random is available here.) */
  rollDie() {
    this.turns += 1;
    return 1 + Math.floor(Math.random() * 6);
  }

  /**
   * Apply a space's effect. `isLanding` distinguishes the final square (where
   * hazards/events fire) from squares merely passed over (only concepts + START
   * resolve on a pass, so a lap always makes progress). Returns an effect
   * descriptor or null when the space does nothing this time.
   */
  resolve(space, isLanding) {
    if (space.type === 'start') {
      this.coins += 20;
      this.energy = Math.min(100, this.energy + 25);
      this.laps += 1;
      return { kind: 'start', text: `Lap ${this.laps} complete — +20 coins, energy refueled.` };
    }

    if (space.type === 'concept') {
      if (this.collected.has(space.id)) return null;
      this.collected.add(space.id);
      this.knowledge += space.knowledge;
      this.coins += space.coins;
      return { kind: 'concept', collected: true, knowledge: space.knowledge, text: `Learned: ${space.label} (+${space.knowledge} Knowledge)` };
    }

    if (!isLanding) return null; // hazard/event only fire on the landing square

    if (space.type === 'hazard') {
      const e = Math.min(this.energy, space.energy);
      const c = Math.min(this.coins, space.coins);
      this.energy -= e;
      this.coins -= c;
      return { kind: 'hazard', text: `${space.label}: −${e} energy${c ? `, −${c} coins` : ''}` };
    }

    if (space.type === 'event') {
      this.knowledge += space.knowledge;
      return { kind: 'event', text: `${space.label} (+${space.knowledge} Knowledge)` };
    }

    return null;
  }

  allConceptsCollected() {
    return this.conceptCount > 0 && this.collected.size >= this.conceptCount;
  }
}
