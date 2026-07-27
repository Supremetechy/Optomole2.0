/**
 * WorkstationApp — the alternate, "sandboxed" Optomole UI.
 *
 * A single operator workstation: one prompt/console to upload · ingest · paste
 * data, and one dominant viewport where the game is constructed and played. The
 * build internals the classic Console exposes (templates, IRX, preprocessing,
 * worker logs, build queue) are intentionally hidden — the operator gives data
 * and gets a game.
 *
 * Fully self-contained: it shares only api.js + the ingest helpers. Selected at
 * mount via ?ui=workstation (persisted); the classic Console stays the default.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getBuild, getPersonExperiments, getWorldModel, launchExperience, nextExperience } from '../api.js';
import { buildCombinedText, extractFileText, publicGatewayBase, toEmbeddableUrl } from './ingest.js';
import './workstation.css';

const STYLES = [
  { value: '', label: 'Auto — match the content' },
  { value: 'action-adventure-key-lock.v1', label: 'Action Adventure · Key/Lock' },
  { value: 'arcade-collect-avoid.v1', label: 'Arcade · Collect / Avoid' },
  { value: 'quest-rpg-progression.v1', label: 'Quest RPG · Progression' },
  { value: 'board-resource-sim.v1', label: 'Board · Resource Sim' },
  { value: 'memory-palace.v1', label: 'Memory Palace' },
  { value: 'idle-progress.v1', label: 'Idle · Progress' },
  { value: 'runner-gauntlet.v1', label: 'Runner · Gauntlet' },
  { value: 'fps-target-gallery.v1', label: 'FPS · Target Gallery' },
  { value: 'open-world-courier.v1', label: 'Open World · Courier' },
  { value: 'router-failover-defense.v1', label: 'Router · Failover Defense' },
];

// Target engine for the build. The two browser engines (PixiJS default, Phaser)
// build instantly and play inside the viewport. Unity and Unreal are native
// engine builds: they queue to the build worker and produce a downloadable
// project/build instead of an embedded playable (they need the worker running).
const ENGINES = [
  { value: 'pixi', label: 'PixiJS — browser · plays here', target: 'browser', engine: 'pixi', embeds: true },
  { value: 'phaser', label: 'Phaser — browser · arcade', target: 'browser', engine: 'phaser', embeds: true },
  { value: 'unity', label: 'Unity — engine build · download', target: 'unity', embeds: false },
  { value: 'unreal', label: 'Unreal — engine build · download', target: 'unreal', embeds: false },
];

const ENGINE_BY_VALUE = Object.fromEntries(ENGINES.map((e) => [e.value, e]));

/**
 * Which compiler turns the source into an experience.
 *
 * "Structural" is the gateway's deterministic fallback: it derives quests, cast,
 * and regions from the extracted knowledge graph, so a build always reflects the
 * shape of the upload. It cannot write prose, which is why every structural
 * build reads alike. The AI compilers author the experience from the same
 * content and are the only path to text that sounds like the source.
 *
 * `local` runs against an OpenAI-compatible server on this machine (Ollama /
 * LM Studio) and needs no key, so it is the one AI option that costs nothing.
 */
const COMPILERS = [
  { value: '', label: 'Structural — no AI, derived from your content', keyless: true },
  // No default model for `local`: the tag has to match something actually pulled
  // on this machine, so the gateway's LOCAL_AI_MODEL decides unless the operator
  // types one. A hardcoded guess here just produces "model not found" compiles.
  { value: 'local', label: 'Local model — offline (Ollama / LM Studio)', keyless: true, model: '' },
  { value: 'openai', label: 'OpenAI', model: 'gpt-4o-mini' },
  { value: 'claude', label: 'Claude', model: 'claude-3-5-sonnet-latest' },
  { value: 'gemini', label: 'Gemini', model: 'gemini-3.5-flash' },
  { value: 'kimi', label: 'Kimi', model: 'kimi-latest' },
];

const COMPILER_BY_VALUE = Object.fromEntries(COMPILERS.map((c) => [c.value, c]));

/**
 * The engine-agnostic DSL runtime (the RuntimeCore + Phaser/Pixi adapter
 * prototype in /Phaser), which plays a compiled bundle from pure data.
 *
 * It runs as its own Vite dev server rather than being served by the gateway,
 * so it is addressed by origin and may simply not be up — every link to it is
 * therefore an explicit, optional action rather than something the viewport
 * depends on. Override with VITE_OPTOMOLE_DSL_URL.
 */
const DSL_RUNTIME_BASE = (import.meta.env.VITE_OPTOMOLE_DSL_URL || 'http://localhost:5173').replace(/\/$/, '');

/** Point the DSL runtime at this build's bundle. `page` picks the adapter. */
function dslRuntimeUrl(bundleUrl, page = '/') {
  if (!bundleUrl) return '';
  return `${DSL_RUNTIME_BASE}${page}?bundle=${encodeURIComponent(bundleUrl)}`;
}

const ACCEPT = '.pdf,.txt,.md,.markdown,.html,.htm,.json,.csv,.vtt,.srt,.epub,.mp3,.wav,.m4a,.aac,.ogg,text/*,application/pdf,application/json,audio/*';

function switchToConsole() {
  try { localStorage.setItem('optomole.ui', 'console'); } catch (_) { /* ignore */ }
  const url = new URL(window.location.href);
  url.searchParams.set('ui', 'console');
  window.location.assign(url.toString());
}

function withId(item) {
  return { id: `src-${Date.now()}-${Math.random().toString(16).slice(2)}`, ...item };
}

function deriveTitle(sources, draft) {
  const fromSource = sources.find((s) => s.title && s.origin !== 'pasted-text')?.title;
  if (fromSource) return fromSource.replace(/\.[a-z0-9]+$/i, '');
  const words = String(draft || '').trim().split(/\s+/).filter(Boolean).slice(0, 7).join(' ');
  return words || 'Untitled Session';
}

/**
 * A stable per-user id persisted in localStorage. This is the personId the whole
 * loop keys on — the build stamps it into the manifest, the game's signals report
 * under it, and the World Model / experiments accrue against it. One browser
 * profile = one person (no auth in this slice).
 */
function getPersonId() {
  try {
    let id = localStorage.getItem('optomole.personId');
    if (!id) {
      id = `user-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem('optomole.personId', id);
    }
    return id;
  } catch (_) {
    return 'anonymous';
  }
}

/** Remembered compiler choice. The API key is deliberately NOT persisted. */
function storedCompiler() {
  try {
    const value = localStorage.getItem('optomole.compiler') || '';
    return COMPILER_BY_VALUE[value] ? value : '';
  } catch (_) {
    return '';
  }
}

export default function WorkstationApp() {
  const [sources, setSources] = useState([]);
  const [draft, setDraft] = useState('');
  const [objective, setObjective] = useState('');
  const [style, setStyle] = useState('');
  const [engine, setEngine] = useState('pixi');
  // Compiler selection. Keys are held in memory for the session only — the same
  // posture as the classic Console, which sends a key per request and never
  // writes it to storage.
  const [compiler, setCompiler] = useState(storedCompiler);
  const [aiModel, setAiModel] = useState(() => COMPILER_BY_VALUE[storedCompiler()]?.model || '');
  const [aiKeys, setAiKeys] = useState({ openai: '', claude: '', gemini: '', kimi: '' });
  const [phase, setPhase] = useState('idle'); // idle · reading · constructing · ready · queued · download · error
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [embedUrl, setEmbedUrl] = useState('');
  const [rawUrl, setRawUrl] = useState('');
  // The DSL projection of the same build, for the engine-agnostic runtime.
  const [bundleUrl, setBundleUrl] = useState('');
  const [dragging, setDragging] = useState(false);
  // Engine (Unity/Unreal) build tracking: these queue to the worker and finish
  // with a downloadable artifact instead of an embedded playable.
  const [engineBuild, setEngineBuild] = useState(null); // { id, label, status }
  const [downloadUrl, setDownloadUrl] = useState('');
  const fileInputRef = useRef(null);

  // Per-user identity + the World Model built from this person's play signals.
  const personId = useMemo(getPersonId, []);
  const [model, setModel] = useState(null);
  const [experiments, setExperiments] = useState([]);
  const [modelBusy, setModelBusy] = useState(false);

  const busy = phase === 'reading' || phase === 'constructing';
  const hasData = sources.length > 0 || draft.trim().length > 0;
  const activeCompiler = COMPILER_BY_VALUE[compiler] || COMPILERS[0];
  // A hosted provider with no key would 400 on the gateway; block the button
  // instead, so the failure is a disabled control rather than a failed build.
  const needsKey = !!compiler && !activeCompiler.keyless && !aiKeys[compiler]?.trim();

  function selectCompiler(value) {
    setCompiler(value);
    setAiModel(COMPILER_BY_VALUE[value]?.model || '');
    try { localStorage.setItem('optomole.compiler', value); } catch (_) { /* ignore */ }
  }

  /**
   * The `ai` block the gateway's compiler reads. Absent when no AI compiler is
   * selected, which is what routes the request to the deterministic fallback.
   */
  function aiOptions() {
    if (!compiler) return undefined;
    return {
      provider: compiler,
      model: aiModel || activeCompiler.model,
      ...(activeCompiler.keyless ? {} : { apiKeys: { [compiler]: aiKeys[compiler].trim() } }),
    };
  }

  const refreshModel = useCallback(async () => {
    setModelBusy(true);
    try {
      const [wm, ex] = await Promise.all([getWorldModel(personId), getPersonExperiments(personId)]);
      setModel(wm);
      setExperiments(ex.experiments || []);
    } catch (_) {
      /* model panel just stays as-is on a transient error */
    } finally {
      setModelBusy(false);
    }
  }, [personId]);

  useEffect(() => { refreshModel(); }, [refreshModel]);

  // Live update: the embedded game postMessages when a play session ends. Refresh
  // the identity model after a short beat so the signals + auto-reflection have
  // landed on the gateway. Ignores messages for other people / other pages.
  useEffect(() => {
    function onMessage(event) {
      const d = event.data;
      if (!d || d.source !== 'optomole' || d.type !== 'session_end') return;
      if (d.personId && d.personId !== personId) return;
      window.setTimeout(() => refreshModel(), 1200);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [personId, refreshModel]);

  const readFiles = useCallback(async (fileList) => {
    const files = [...(fileList || [])];
    if (!files.length) return;
    setPhase('reading');
    setError('');
    setStatus(`Reading ${files.length} file${files.length > 1 ? 's' : ''}…`);
    try {
      const extracted = await Promise.all(files.map(extractFileText));
      setSources((current) => [...extracted.map(withId), ...current]);
      setStatus('');
      setPhase((p) => (p === 'reading' ? 'idle' : p));
    } catch (caught) {
      setError(caught.message || 'Could not read one of the files.');
      setPhase('error');
    }
  }, []);

  function onDrop(event) {
    event.preventDefault();
    setDragging(false);
    readFiles(event.dataTransfer?.files);
  }

  function addPaste() {
    const value = draft.trim();
    if (!value) return;
    setSources((current) => [withId({ title: 'Pasted note', sourceType: 'course', text: value, origin: 'pasted-text' }), ...current]);
    setDraft('');
  }

  function removeSource(id) {
    setSources((current) => current.filter((s) => s.id !== id));
  }

  async function construct() {
    const combined = buildCombinedText(sources, draft);
    if (!combined.trim()) {
      setError('Add data first — drop a file, or paste text into the console.');
      return;
    }
    const selected = ENGINE_BY_VALUE[engine] || ENGINES[0];
    setPhase('constructing');
    setError('');
    setEmbedUrl('');
    setRawUrl('');
    setBundleUrl('');
    setEngineBuild(null);
    setDownloadUrl('');
    setStatus('Normalizing ingested content on the gateway…');
    try {
      const title = deriveTitle(sources, draft);
      const payload = {
        source: {
          sourceType: sources[0]?.sourceType || 'course',
          title,
          text: combined,
          metadata: {
            submittedFrom: 'optomole-workstation',
            ...(objective.trim() ? { goals: objective.trim() } : {}),
          },
        },
        options: {
          title,
          personId, // signals from this game attribute to this person → the loop
          ...(objective.trim() ? { goals: objective.trim() } : {}),
          ...(style ? { genre: style } : {}),
          ...(selected.engine ? { engine: selected.engine } : {}),
          ai: aiOptions(),
          publicGatewayUrl: publicGatewayBase(),
        },
        target: selected.target,
      };
      setStatus(selected.embeds
        ? `Constructing world, levels, and objectives from your data${compiler ? ` with ${activeCompiler.label.split(' ')[0]}` : ''}…`
        : `Compiling and queuing the ${selected.label.split(' ')[0]} engine build…`);
      const data = await launchExperience(payload);
      const build = data?.build;
      if (!build || build.status === 'failed') {
        throw new Error(build?.error || 'The engine did not return a build.');
      }

      if (selected.embeds) {
        if (!build.launchUrl) throw new Error('The engine did not return a playable build.');
        setRawUrl(build.launchUrl);
        setBundleUrl(build.bundleUrl || '');
        setEmbedUrl(toEmbeddableUrl(build.launchUrl));
        setStatus('');
        setPhase('ready');
        refreshModel();
        return;
      }

      // Unity / Unreal: native engine build. It either already completed (worker
      // returned an artifact) or is queued — poll for the download.
      const dl = build.downloadUrl || build.artifactUrl || '';
      setEngineBuild({ id: build.id, label: selected.label.split(' ')[0], status: build.status });
      setDownloadUrl(dl);
      setStatus('');
      setPhase(build.status === 'succeeded' && dl ? 'download' : 'queued');
    } catch (caught) {
      setError(caught.message || 'Construction failed.');
      setPhase('error');
    }
  }

  function reset() {
    setEmbedUrl('');
    setRawUrl('');
    setBundleUrl('');
    setEngineBuild(null);
    setDownloadUrl('');
    setPhase('idle');
    setStatus('');
    setError('');
  }

  /**
   * Build the experience the World Model wants next (explore/exploit directive),
   * steered by its recommendation rather than the STYLE dropdown. Content still
   * comes from the person's ingested data; the model only chooses the shape.
   */
  async function buildModelPick() {
    const combined = buildCombinedText(sources, draft);
    if (!combined.trim()) {
      setError('Add data first — the model chooses the game shape, your content fills it.');
      return;
    }
    setPhase('constructing');
    setError('');
    setEmbedUrl('');
    setRawUrl('');
    setBundleUrl('');
    setEngineBuild(null);
    setDownloadUrl('');
    setStatus(`Model directive: ${model?.recommendation?.hypothesis || 'building the next experiment…'}`);
    try {
      const title = deriveTitle(sources, draft);
      const data = await nextExperience(personId, {
        source: {
          sourceType: sources[0]?.sourceType || 'course',
          title,
          text: combined,
          metadata: { submittedFrom: 'optomole-workstation', ...(objective.trim() ? { goals: objective.trim() } : {}) },
        },
        options: {
          title,
          ...(objective.trim() ? { goals: objective.trim() } : {}),
          ai: aiOptions(),
          publicGatewayUrl: publicGatewayBase(),
        },
        target: 'browser',
      });
      const build = data?.build;
      if (!build?.launchUrl || build.status === 'failed') {
        throw new Error(build?.error || 'The model could not produce a playable experience.');
      }
      setRawUrl(build.launchUrl);
      setBundleUrl(build.bundleUrl || '');
      setEmbedUrl(toEmbeddableUrl(build.launchUrl));
      setStatus('');
      setPhase('ready');
      refreshModel();
    } catch (caught) {
      setError(caught.message || 'Model pick failed.');
      setPhase('error');
    }
  }

  // Poll a queued Unity/Unreal build until the worker finishes it (or it fails).
  // Without a running build worker it stays 'queued' — the viewport says so.
  useEffect(() => {
    if (phase !== 'queued' || !engineBuild?.id) return undefined;
    let alive = true;
    const timer = window.setInterval(async () => {
      try {
        const data = await getBuild(engineBuild.id);
        const build = data?.build;
        if (!alive || !build) return;
        setEngineBuild((prev) => (prev ? { ...prev, status: build.status } : prev));
        if (build.status === 'succeeded') {
          setDownloadUrl(build.downloadUrl || build.artifactUrl || '');
          setPhase('download');
        } else if (build.status === 'failed') {
          setError(build.error || 'Engine build failed.');
          setPhase('error');
        }
      } catch (_) { /* transient; keep polling */ }
    }, 3000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [phase, engineBuild?.id]);

  const systemState = useMemo(() => {
    if (phase === 'error') return { label: 'FAULT', tone: 'bad' };
    if (busy) return { label: 'WORKING', tone: 'live' };
    if (phase === 'queued') return { label: 'QUEUED', tone: 'live' };
    if (phase === 'ready') return { label: 'RUNNING', tone: 'good' };
    if (phase === 'download') return { label: 'BUILD READY', tone: 'good' };
    return { label: 'ONLINE', tone: 'idle' };
  }, [phase, busy]);

  return (
    <div className="ws-root">
      <header className="ws-topbar">
        <div className="ws-brand">
          <span className="ws-logo">◉</span>
          <div>
            <b>OPTOMOLE</b>
            <span className="ws-sub">WORKSTATION</span>
          </div>
        </div>
        <div className="ws-topbar-right">
          <span className={`ws-led ws-led-${systemState.tone}`} />
          <span className="ws-state">{systemState.label}</span>
          <button type="button" className="ws-ghost" onClick={switchToConsole}>Console UI ↗</button>
        </div>
      </header>

      <main className="ws-desk">
        <div className="ws-leftcol">
        {/* INPUT TERMINAL ------------------------------------------------ */}
        <section className="ws-panel ws-console">
          <div className="ws-panel-head">
            <span className="ws-dot" /> INPUT TERMINAL
          </div>

          <label
            className={`ws-drop ${dragging ? 'is-drag' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPT}
              hidden
              onChange={(e) => { readFiles(e.target.files); e.target.value = ''; }}
            />
            <b>{phase === 'reading' ? 'Reading…' : 'Drop files or click to upload'}</b>
            <span>PDF · text · markdown · HTML · CSV · JSON · transcripts · audio</span>
          </label>

          <textarea
            className="ws-textarea"
            placeholder="…or paste your source content here — notes, a procedure, a transcript, a task list."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="ws-paste-row">
            <button type="button" className="ws-ghost sm" onClick={addPaste} disabled={!draft.trim()}>
              + Add paste as source
            </button>
          </div>

          <input
            className="ws-line-input"
            placeholder="Optional: what should the player learn or achieve?"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
          />

          <div className="ws-style-row">
            <label>STYLE</label>
            <select value={style} onChange={(e) => setStyle(e.target.value)}>
              {STYLES.map((s) => <option key={s.value || 'auto'} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          <div className="ws-style-row">
            <label>ENGINE</label>
            <select value={engine} onChange={(e) => setEngine(e.target.value)}>
              {ENGINES.map((en) => <option key={en.value} value={en.value}>{en.label}</option>)}
            </select>
          </div>

          <div className="ws-style-row">
            <label>COMPILER</label>
            <select value={compiler} onChange={(e) => selectCompiler(e.target.value)}>
              {COMPILERS.map((c) => <option key={c.value || 'structural'} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          {compiler && (
            <div className="ws-compiler-detail">
              <input
                className="ws-line-input"
                placeholder="Model"
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
              />
              {activeCompiler.keyless ? (
                <p className="ws-hint sm">
                  Runs offline against your local model server. Nothing leaves this machine.
                </p>
              ) : (
                <>
                  <input
                    className="ws-line-input"
                    type="password"
                    placeholder={`${compiler} API key — used for this build only`}
                    value={aiKeys[compiler] || ''}
                    onChange={(e) => setAiKeys((current) => ({ ...current, [compiler]: e.target.value }))}
                  />
                  <p className="ws-hint sm">
                    Sent to the local gateway per request and never stored by this page.
                  </p>
                </>
              )}
            </div>
          )}

          {sources.length > 0 && (
            <div className="ws-sources">
              {sources.map((s) => (
                <span key={s.id} className="ws-chip" title={s.title}>
                  {s.title.length > 22 ? `${s.title.slice(0, 21)}…` : s.title}
                  <button type="button" onClick={() => removeSource(s.id)} aria-label="Remove">×</button>
                </span>
              ))}
            </div>
          )}

          <button type="button" className="ws-construct" onClick={construct} disabled={busy || !hasData || needsKey}>
            {phase === 'constructing' ? 'CONSTRUCTING…' : ENGINE_BY_VALUE[engine]?.embeds === false ? 'BUILD PROJECT' : 'CONSTRUCT GAME'}
          </button>
          {needsKey && <p className="ws-hint sm">Add a {compiler} API key, or switch the compiler to Structural or Local.</p>}

          {error && <p className="ws-error">{error}</p>}
        </section>

        {/* IDENTITY MODEL ------------------------------------------------ */}
        <section className="ws-panel ws-identity">
          <div className="ws-panel-head">
            <span className="ws-dot" /> IDENTITY MODEL
            <div className="ws-view-actions">
              <span className="ws-pid" title={`This browser's person id: ${personId}`}>{personId}</span>
              <button type="button" className="ws-ghost sm" onClick={refreshModel} disabled={modelBusy} aria-label="Refresh model">↻</button>
            </div>
          </div>
          <div className="ws-identity-body">
            {model && (model.basis?.signalCount || 0) > 0 ? (
              <>
                {model.recommendation && (
                  <div className="ws-directive">
                    <div className="ws-directive-head">
                      <span className={`ws-badge ws-badge-${model.recommendation.mode}`}>{model.recommendation.mode}</span>
                      <b>{model.recommendation.genre}</b>
                    </div>
                    <p className="ws-hyp">“{model.recommendation.hypothesis}”</p>
                    <button type="button" className="ws-ghost pick" onClick={buildModelPick} disabled={busy || !hasData || needsKey}>
                      Build the model’s pick →
                    </button>
                    {!hasData && <span className="ws-note">add data first</span>}
                  </div>
                )}
                {model.becoming?.length > 0 && (
                  <div className="ws-block">
                    <label>BECOMING</label>
                    <div className="ws-sources">
                      {model.becoming.map((b, i) => <span key={i} className="ws-chip ws-chip-emergent">{b.label}</span>)}
                    </div>
                  </div>
                )}
                {model.predictions?.genrePreference?.length > 0 && (
                  <div className="ws-block">
                    <label>PREFERENCES</label>
                    {model.predictions.genrePreference.slice(0, 4).map((p) => (
                      <div key={p.value} className="ws-bar-row">
                        <span className="ws-bar-label">{p.value}</span>
                        <div className="ws-bar"><div style={{ width: `${Math.round(p.probability * 100)}%` }} /></div>
                      </div>
                    ))}
                  </div>
                )}
                {model.uncertaintySet?.length > 0 && (
                  <div className="ws-block">
                    <label>EXPLORING NEXT</label>
                    <div className="ws-sources">
                      {model.uncertaintySet.slice(0, 4).map((u, i) => <span key={i} className="ws-chip ws-chip-unknown">{u.target}</span>)}
                    </div>
                  </div>
                )}
                {experiments.length > 0 && (
                  <div className="ws-block">
                    <label>EXPERIMENTS</label>
                    {/*
                      Keyed by buildId, not experienceId: experienceId is a slug of
                      the session title, so every experiment run on the same content
                      (or on untitled content) collides. buildId is per build.
                    */}
                    {experiments.slice(0, 4).map((e) => (
                      <div key={e.buildId || e.experienceId} className="ws-exp-row">
                        <span className={`ws-status-dot ws-st-${e.status}`} />
                        <span className="ws-exp-genre">{e.genre}</span>
                        <span className="ws-exp-status">{e.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="ws-block">
                <p className="ws-hint">
                  {modelBusy
                    ? 'Reading the model…'
                    : 'No signals yet. Build a game and play it — the model of who you are, what you prefer, and what to try next appears here.'}
                </p>
                {model?.recommendation && hasData && (
                  <button type="button" className="ws-ghost pick" onClick={buildModelPick} disabled={busy || needsKey}>
                    Let the model pick your first game →
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
        </div>

        {/* CONSTRUCTION VIEWPORT ---------------------------------------- */}
        <section className="ws-panel ws-viewport">
          <div className="ws-panel-head">
            <span className="ws-dot" /> CONSTRUCTION VIEWPORT
            {(phase === 'ready' || phase === 'queued' || phase === 'download') && (
              <div className="ws-view-actions">
                {phase === 'ready' && rawUrl && <a href={rawUrl} target="_blank" rel="noreferrer" className="ws-ghost sm">Full screen ↗</a>}
                {phase === 'ready' && bundleUrl && (
                  <a
                    href={dslRuntimeUrl(bundleUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="ws-ghost sm"
                    title={`Play this same build as pure data in the engine-agnostic RuntimeCore at ${DSL_RUNTIME_BASE}. Requires that dev server to be running.`}
                  >
                    DSL runtime ↗
                  </a>
                )}
                {phase === 'download' && downloadUrl && <a href={downloadUrl} target="_blank" rel="noreferrer" className="ws-ghost sm">Download ↓</a>}
                <button type="button" className="ws-ghost sm" onClick={reset}>New build</button>
              </div>
            )}
          </div>

          <div className="ws-screen">
            {phase === 'ready' && embedUrl ? (
              <iframe
                key={embedUrl}
                className="ws-game"
                src={embedUrl}
                title="Constructed game"
                allow="fullscreen; autoplay; gamepad"
              />
            ) : phase === 'queued' ? (
              <div className="ws-screen-idle is-busy">
                <div className="ws-scan" />
                <div className="ws-spinner" />
                <p className="ws-big">{String(engineBuild?.label || 'ENGINE').toUpperCase()} BUILD · {String(engineBuild?.status || 'queued').toUpperCase()}</p>
                <p className="ws-status">Job {engineBuild?.id}</p>
                <p className="ws-hint">
                  Queued to the {engineBuild?.label} build worker — it will appear here as a download when the worker
                  finishes. Requires the engine build worker to be running.
                </p>
              </div>
            ) : phase === 'download' ? (
              <div className="ws-screen-idle">
                <div className="ws-scan" />
                <p className="ws-big">✓ {String(engineBuild?.label || 'ENGINE').toUpperCase()} BUILD READY</p>
                {downloadUrl ? (
                  <a className="ws-construct ws-download" href={downloadUrl} target="_blank" rel="noreferrer">DOWNLOAD BUILD ↓</a>
                ) : (
                  <p className="ws-hint">Build completed, but the worker returned no download URL.</p>
                )}
                <p className="ws-hint">Native {engineBuild?.label} engine build — not playable in-browser.</p>
              </div>
            ) : (
              <div className={`ws-screen-idle ${busy ? 'is-busy' : ''}`}>
                <div className="ws-scan" />
                {busy ? (
                  <>
                    <div className="ws-spinner" />
                    <p className="ws-status">{status || 'Working…'}</p>
                    <p className="ws-hint">Building world · levels · objectives from your data</p>
                  </>
                ) : phase === 'error' ? (
                  <>
                    <p className="ws-big">⚠ CONSTRUCTION FAULT</p>
                    <p className="ws-hint">{error || 'Check the input and try again.'}</p>
                  </>
                ) : (
                  <>
                    <p className="ws-big">AWAITING DATA</p>
                    <p className="ws-hint">Upload, ingest, or paste your material, then press CONSTRUCT GAME.</p>
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
