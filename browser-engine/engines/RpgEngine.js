/**
 * RpgEngine — lightweight progression layer.
 *
 * Wraps the StateStore's xp/currency/level and derives progression readouts
 * (level, xp-to-next, completion %). Kept intentionally small: the key-lock
 * template is about procedures, not deep RPG systems, but this is the seam
 * where skill trees / stat growth plug in for richer genres.
 */
const XP_PER_LEVEL = 200;

export class RpgEngine {
  constructor(state) {
    this.state = state;
  }

  grant({ xp = 0, currency = 0 } = {}) {
    if (xp) this.state.addXp(xp);
    if (currency) this.state.addCurrency(currency);
  }

  progression() {
    const xp = this.state.get('xp');
    const level = this.state.get('level');
    const intoLevel = xp % XP_PER_LEVEL;
    return {
      level,
      xp,
      currency: this.state.get('currency'),
      xpIntoLevel: intoLevel,
      xpForLevel: XP_PER_LEVEL,
      pctToNext: Math.round((intoLevel / XP_PER_LEVEL) * 100),
    };
  }

  /** Overall experience completion, 0..1, from cleared rooms. */
  completion(totalRooms) {
    if (!totalRooms) return 0;
    return Math.min(1, this.state.get('clearedRooms').length / totalRooms);
  }
}