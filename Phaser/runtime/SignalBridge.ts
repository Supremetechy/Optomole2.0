import { RuntimeCore, RuntimeNotification } from "./RuntimeCore";

/**
 * SignalBridge — the return edge of the loop for DSL-driven experiences.
 *
 * Mirrors browser-engine/runtime/SignalEmitter.js: batches observations and
 * POSTs them to `${apiBase}/v1/persons/${personId}/signals` in the same batch
 * shape ({ sessionId, experienceId, template, engine, signals: [{type, ts,
 * data}] }), so SignalStore/PersonGraph ingest them with zero server changes.
 *
 * Pure observation: subscribes to RuntimeCore notifications, never mutates
 * runtime state, and never lets telemetry break the game.
 */

export interface SignalBridgeConfig {
  apiBase: string;
  personId: string;
  experienceId?: string;
  template?: string;
  engine?: string;
  flushMs?: number;
}

interface Signal {
  type: string;
  ts: number;
  data?: Record<string, unknown>;
}

export class SignalBridge {
  private endpoint: string;
  private cfg: Required<Omit<SignalBridgeConfig, "apiBase">> & { apiBase: string };
  private sessionId: string;
  private queue: Signal[] = [];
  private start = Date.now();
  private timer: number | null = null;
  private unsubscribe: (() => void) | null = null;
  private closed = false;
  private sessionEnded = false;
  private scenesCompleted = 0;
  private onHide = () => {
    if (document.visibilityState === "hidden") this.flush();
  };
  private onPageHide = () => this.close();

  constructor(config: SignalBridgeConfig) {
    this.cfg = {
      apiBase: config.apiBase.replace(/\/$/, ""),
      personId: config.personId,
      experienceId: config.experienceId ?? "sky_run",
      template: config.template ?? "gameplay-dsl",
      engine: config.engine ?? "dsl-phaser",
      flushMs: config.flushMs ?? 5000,
    };
    this.endpoint = `${this.cfg.apiBase}/v1/persons/${encodeURIComponent(this.cfg.personId)}/signals`;
    this.sessionId = makeSessionId();
  }

  attach(core: RuntimeCore): this {
    this.emit("experience_start", {
      personId: this.cfg.personId,
      experienceId: this.cfg.experienceId,
      template: this.cfg.template,
      engine: this.cfg.engine,
    });
    this.unsubscribe = core.subscribe(n => this.onNotification(n));
    this.timer = window.setInterval(() => this.flush(), this.cfg.flushMs);
    document.addEventListener("visibilitychange", this.onHide);
    window.addEventListener("pagehide", this.onPageHide);
    return this;
  }

  private onNotification(n: RuntimeNotification): void {
    if (n.kind === "transition") {
      this.emit("state_change", { entityId: n.entityId, from: n.from, to: n.to });
      return;
    }
    const event = n.event;
    switch (event.type) {
      case "OnSceneEnter":
        this.emit("scene_enter", { sceneId: event.payload?.sceneId });
        break;
      case "OnSceneComplete":
        this.scenesCompleted += 1;
        this.emit("scene_complete", { sceneId: event.payload?.sceneId });
        this.endSession("completed");
        break;
      case "OnCollision":
        this.emit("collision", {
          a: event.sourceEntityId,
          b: event.targetEntityId,
          normalY: event.payload?.normalY,
        });
        break;
      // OnInput is filtered by the core (too noisy); others pass as-is.
      default:
        this.emit(event.type.replace(/^On/, "").toLowerCase(), event.payload);
    }
  }

  emit(type: string, data?: Record<string, unknown>): void {
    if (this.closed || !type) return;
    this.queue.push({ type, ts: Date.now(), ...(data ? { data } : {}) });
    if (this.queue.length >= 200) this.flush();
  }

  flush(): void {
    if (!this.queue.length) return;
    const batch = {
      sessionId: this.sessionId,
      experienceId: this.cfg.experienceId,
      template: this.cfg.template,
      engine: this.cfg.engine,
      signals: this.queue.splice(0, this.queue.length),
    };
    try {
      fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(batch),
        keepalive: true,
        mode: "cors",
        credentials: "omit",
      }).catch(() => {});
    } catch {
      // Never let telemetry break the game.
    }
  }

  private endSession(reason: string): void {
    if (this.sessionEnded) {
      this.flush();
      return;
    }
    this.sessionEnded = true;
    this.emit("session_end", {
      durationMs: Date.now() - this.start,
      scenesCompleted: this.scenesCompleted,
      reason,
    });
    this.flush();
  }

  close(): void {
    if (this.closed) return;
    this.endSession("teardown");
    this.closed = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.unsubscribe?.();
    document.removeEventListener("visibilitychange", this.onHide);
    window.removeEventListener("pagehide", this.onPageHide);
  }
}

/**
 * Attach a SignalBridge from URL params. Opt-in: no personId → no telemetry.
 * `?personId=...&apiBase=http://localhost:4000&experienceId=...`
 */
export function attachSignalBridgeFromUrl(core: RuntimeCore, engine: string): SignalBridge | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const personId = params.get("personId");
    if (!personId) return null;
    const apiBase = params.get("apiBase") || window.location.origin;
    return new SignalBridge({
      apiBase,
      personId,
      experienceId: params.get("experienceId") || undefined,
      engine,
    }).attach(core);
  } catch (err) {
    console.warn("[SignalBridge] disabled:", err);
    return null;
  }
}

function makeSignalId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}

function makeSessionId(): string {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return makeSignalId();
}
