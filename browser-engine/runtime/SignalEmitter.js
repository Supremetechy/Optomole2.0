/**
 * SignalEmitter — the return edge of the Experience Engine loop.
 *
 * Every playable experience is a source of observations about the person: what
 * they collected, where they took damage, which rooms they cleared, how long they
 * stayed. This emitter watches the renderer-agnostic StateStore, turns state
 * transitions into discrete signals, batches them, and posts them to the gateway
 * at `${apiBase}/v1/persons/${personId}/signals`.
 *
 * It is pure observation — no engine or scene code changes. State deltas ARE the
 * signal stream, which matches the design principle that experiences emit
 * observations, not answers. Later layers (World Model, Reflection) interpret them.
 */
export class SignalEmitter {
  constructor({ endpoint, personId, experienceId, template, engine, flushMs = 5000 }) {
    this.endpoint = endpoint;
    this.personId = personId;
    this.experienceId = experienceId || null;
    this.template = template || null;
    this.engine = engine || 'pixi';
    this.flushMs = flushMs;
    this.sessionId = makeSessionId();
    this._queue = [];
    this._prev = null;
    this._start = Date.now();
    this._timer = null;
    this._unsub = null;
    this._closed = false;
  }

  /** Subscribe to the StateStore and start batching. */
  attach(state) {
    this.emit('experience_start', {
      personId: this.personId,
      experienceId: this.experienceId,
      template: this.template,
      engine: this.engine,
    });
    // subscribe() invokes immediately with current state → sets the baseline
    // (prev === null) without replaying it as deltas.
    this._unsub = state.subscribe((s) => this._capture(s));
    this._timer = setInterval(() => this.flush(), this.flushMs);

    // Flush on tab-away and teardown. pagehide is the reliable "leaving" signal;
    // visibilitychange covers backgrounding without unload.
    this._onHide = () => {
      if (document.visibilityState === 'hidden') this.flush();
    };
    this._onPageHide = () => this.close();
    document.addEventListener('visibilitychange', this._onHide);
    window.addEventListener('pagehide', this._onPageHide);
  }

  /** Queue one observation. */
  emit(type, data) {
    if (this._closed || !type) return;
    this._queue.push({ type, ts: Date.now(), ...(data ? { data } : {}) });
    if (this._queue.length >= 200) this.flush();
  }

  /** Translate a state snapshot into discrete signals vs. the previous snapshot. */
  _capture(state) {
    const prev = this._prev;
    if (prev) {
      if ((state.xp || 0) > (prev.xp || 0)) this.emit('xp_gain', { amount: (state.xp || 0) - (prev.xp || 0), total: state.xp || 0 });
      if ((state.level || 1) > (prev.level || 1)) this.emit('level_up', { level: state.level });
      const pf = prev.focus ?? 100;
      const cf = state.focus ?? 100;
      if (cf < pf) this.emit('focus_damage', { amount: pf - cf, focus: cf });

      for (const key of state.keys || []) {
        if (!(prev.keys || []).includes(key)) {
          // Carry the human label (from inventory) so the Person Graph can tie
          // this collection to the actual topic/concept, not just an entity id.
          const label = (state.inventory || []).find((item) => item.id === key)?.label;
          this.emit('key_collected', { keyId: key, ...(label ? { label } : {}) });
        }
      }
      for (const room of state.clearedRooms || []) {
        if (!(prev.clearedRooms || []).includes(room)) this.emit('room_cleared', { roomId: room });
      }
      if (state.currentRoom && state.currentRoom !== prev.currentRoom) {
        this.emit('room_enter', { roomId: state.currentRoom });
      }
      for (const message of newLogEntries(prev.log || [], state.log || [])) {
        this.emit('log', { message });
      }
    }
    this._prev = {
      xp: state.xp,
      level: state.level,
      focus: state.focus,
      keys: [...(state.keys || [])],
      clearedRooms: [...(state.clearedRooms || [])],
      currentRoom: state.currentRoom,
      log: [...(state.log || [])],
    };
  }

  /** POST the queued batch (fetch keepalive works during unload). */
  flush() {
    if (!this._queue.length) return;
    const batch = {
      sessionId: this.sessionId,
      experienceId: this.experienceId,
      template: this.template,
      engine: this.engine,
      signals: this._queue.splice(0, this._queue.length),
    };
    try {
      fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(batch),
        keepalive: true,
        mode: 'cors',
        credentials: 'omit',
      }).catch(() => {});
    } catch (_) {
      // Never let telemetry break the game.
    }
  }

  /** Emit a final session summary and flush. Idempotent. */
  close() {
    if (this._closed) return;
    const last = this._prev || {};
    this.emit('session_end', {
      durationMs: Date.now() - this._start,
      xp: last.xp || 0,
      level: last.level || 1,
      roomsCleared: (last.clearedRooms || []).length,
    });
    this._closed = true;
    this.flush();
    if (this._timer) clearInterval(this._timer);
    if (this._unsub) this._unsub();
    if (this._onHide) document.removeEventListener('visibilitychange', this._onHide);
    if (this._onPageHide) window.removeEventListener('pagehide', this._onPageHide);
  }
}

/** New log entries since the previous snapshot. StateStore unshifts (newest first). */
function newLogEntries(prevLog, curLog) {
  if (!prevLog.length) return [];
  const anchor = prevLog[0];
  const idx = curLog.indexOf(anchor);
  if (idx === 0) return [];
  if (idx < 0) return curLog.slice(0, 1); // rotated past the window; best-effort newest
  return curLog.slice(0, idx);
}

function makeSessionId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch (_) { /* fall through */ }
  return `s-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Wire an emitter to a running OptomoleRuntime. Reads personId/apiBase from the
 * manifest `meta` (stamped by the gateway build); falls back to the page origin.
 * Exposes the emitter at `runtime.services.signals` for engines that want to emit
 * richer semantic signals later. Returns the emitter (or null if unusable).
 */
export function attachSignalEmitter(runtime, manifest = {}, meta = {}, engine = 'pixi') {
  try {
    const state = runtime?.services?.state;
    if (!state || typeof state.subscribe !== 'function') return null;

    const personId = String(meta.personId || 'anonymous');
    const base = String(meta.apiBase || (typeof location !== 'undefined' ? location.origin : '')).replace(/\/$/, '');
    if (!base) return null;
    const endpoint = `${base}/v1/persons/${encodeURIComponent(personId)}/signals`;

    const emitter = new SignalEmitter({
      endpoint,
      personId,
      experienceId: meta.experienceId || manifest.experienceId,
      template: manifest.templateId,
      engine,
    });
    emitter.attach(state);
    runtime.services.signals = emitter;
    return emitter;
  } catch (err) {
    console.warn('[SignalEmitter] disabled:', err?.message || err);
    return null;
  }
}
