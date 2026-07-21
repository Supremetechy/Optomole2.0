/**
 * QuestEngine — objective tracking, success/failure evaluation, and rewards.
 *
 * Each room contributes objectives (collect key, talk to NPC, avoid hazard,
 * unlock gate). The engine tracks their completion, applies XP/currency/focus
 * rewards through the StateStore, and reports when a room — and the whole
 * experience — is complete.
 */
export class QuestEngine {
  constructor(state, audio) {
    this.state = state;
    this.audio = audio;
    this.objectives = new Map(); // id -> objective
    this.roomObjectives = new Map(); // roomId -> Set(objId)
    this._listeners = new Set();
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    const list = this.list();
    this.state.set({ objectives: list });
    for (const fn of this._listeners) fn(list);
  }

  register(roomId, { id, label, kind = 'collect', reward = {}, optional = false }) {
    const obj = { id, roomId, label, kind, reward, optional, done: false };
    this.objectives.set(id, obj);
    if (!this.roomObjectives.has(roomId)) this.roomObjectives.set(roomId, new Set());
    this.roomObjectives.get(roomId).add(id);
    this._emit();
    return obj;
  }

  complete(id) {
    const obj = this.objectives.get(id);
    if (!obj || obj.done) return false;
    obj.done = true;
    const { xp = 0, currency = 0 } = obj.reward || {};
    if (xp) this.state.addXp(xp);
    if (currency) this.state.addCurrency(currency);
    this.audio?.play('success');
    this.state.logEvent(`✓ ${obj.label}`);
    this._emit();
    return true;
  }

  fail(id, focusPenalty = 8) {
    const obj = this.objectives.get(id);
    this.state.damageFocus(focusPenalty);
    this.audio?.play('failure');
    if (obj) this.state.logEvent(`⚠ ${obj.label}`);
    this._emit();
  }

  isRoomComplete(roomId) {
    const ids = this.roomObjectives.get(roomId);
    if (!ids || ids.size === 0) return true;
    for (const id of ids) {
      const obj = this.objectives.get(id);
      if (obj && !obj.optional && !obj.done) return false;
    }
    return true;
  }

  list() {
    return [...this.objectives.values()].map((o) => ({
      id: o.id,
      roomId: o.roomId,
      label: o.label,
      kind: o.kind,
      done: o.done,
      optional: o.optional,
    }));
  }

  roomList(roomId) {
    return this.list().filter((o) => o.roomId === roomId);
  }
}