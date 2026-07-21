/**
 * StateStore — the single source of truth for a running experience.
 *
 * Holds player progression (xp, currency, level), inventory / collected keys,
 * world flags (unlocked doors, cleared rooms), and the active room id. It is a
 * tiny reactive store: mutate through the helpers, subscribe to be notified.
 *
 * No PixiJS / Matter dependency — this is pure data so scenes, engines, and the
 * HUD can all read and react to the same state.
 */
export class StateStore {
  constructor(initial = {}) {
    this.state = {
      xp: 0,
      currency: 0,
      level: 1,
      focus: 100, // depletes on hazard contact; a soft "health" for training games
      keys: [], // collected key-item ids
      inventory: [], // { id, label, icon }
      flags: {}, // arbitrary boolean/string world flags, e.g. door_1_unlocked
      clearedRooms: [],
      currentRoom: null,
      objectives: [], // mirror of QuestEngine objective state for the HUD
      log: [], // recent human-readable events
      ...initial,
    };
    this._subs = new Set();
  }

  get(key) {
    return key ? this.state[key] : this.state;
  }

  /** Shallow-merge a patch and notify subscribers. */
  set(patch) {
    Object.assign(this.state, patch);
    this._emit();
    return this.state;
  }

  addXp(amount = 0) {
    if (!amount) return;
    this.state.xp += amount;
    // Simple level curve: every 200 xp is a level.
    const nextLevel = 1 + Math.floor(this.state.xp / 200);
    if (nextLevel > this.state.level) this.state.level = nextLevel;
    this._emit();
  }

  addCurrency(amount = 0) {
    if (!amount) return;
    this.state.currency += amount;
    this._emit();
  }

  damageFocus(amount = 0) {
    this.state.focus = Math.max(0, this.state.focus - amount);
    this._emit();
  }

  hasKey(id) {
    return this.state.keys.includes(id);
  }

  addKey(id, item) {
    if (!id || this.state.keys.includes(id)) return false;
    this.state.keys.push(id);
    if (item) this.state.inventory.push(item);
    this._emit();
    return true;
  }

  setFlag(name, value = true) {
    this.state.flags[name] = value;
    this._emit();
  }

  getFlag(name) {
    return this.state.flags[name];
  }

  clearRoom(roomId) {
    if (roomId && !this.state.clearedRooms.includes(roomId)) {
      this.state.clearedRooms.push(roomId);
    }
    this._emit();
  }

  logEvent(message) {
    if (!message) return;
    this.state.log.unshift(message);
    this.state.log = this.state.log.slice(0, 30);
    this._emit();
  }

  subscribe(fn) {
    this._subs.add(fn);
    fn(this.state);
    return () => this._subs.delete(fn);
  }

  _emit() {
    for (const fn of this._subs) {
      try {
        fn(this.state);
      } catch (err) {
        console.error('[StateStore] subscriber error', err);
      }
    }
  }
}