/**
 * Hud — a lightweight DOM heads-up display bound to the StateStore.
 *
 * Kept in the DOM (not the Pixi stage) so text stays crisp and accessible and
 * the canvas stays purely the game world. It subscribes to state and re-renders
 * stats, the current room, live objectives, the hint line, and an event log.
 */
export function mountHud(state, mount = document.body) {
  const root = document.createElement('div');
  root.className = 'oe-hud';
  root.innerHTML = `
    <section class="oe-panel oe-tl">
      <p class="oe-kicker">Optomole Runtime</p>
      <h1 id="oe-title">Experience</h1>
      <p class="oe-muted" id="oe-template"></p>
      <div class="oe-stats">
        <div class="oe-stat"><span>XP</span><b id="oe-xp">0</b></div>
        <div class="oe-stat"><span>Level</span><b id="oe-level">1</b></div>
        <div class="oe-stat"><span>Keys</span><b id="oe-keys">0</b></div>
        <div class="oe-stat"><span>Focus</span><b id="oe-focus">100</b></div>
      </div>
      <div class="oe-focusbar"><i id="oe-focusfill"></i></div>
    </section>
    <section class="oe-panel oe-tr">
      <p class="oe-kicker" id="oe-roomtag">Room</p>
      <h2 id="oe-room">—</h2>
      <p class="oe-muted" id="oe-summary"></p>
      <div class="oe-objs" id="oe-objs"></div>
    </section>
    <section class="oe-panel oe-bl">
      <p class="oe-kicker">Log</p>
      <div class="oe-log" id="oe-log"></div>
    </section>
    <div class="oe-hint" id="oe-hint"></div>
  `;
  mount.appendChild(root);
  injectStyles();

  const $ = (id) => root.querySelector(id);

  state.subscribe((s) => {
    $('#oe-title').textContent = s.experience?.title || 'Experience';
    $('#oe-template').textContent = s.experience?.template
      ? `${s.experience.template} · ${s.experience.roomCount || 1} room(s)`
      : '';
    $('#oe-xp').textContent = s.xp;
    $('#oe-level').textContent = s.level;
    $('#oe-keys').textContent = s.keys.length;
    $('#oe-focus').textContent = `${s.focus}`;
    $('#oe-focusfill').style.width = `${s.focus}%`;
    $('#oe-focusfill').style.background = s.focus < 34 ? '#fb7185' : s.focus < 67 ? '#fbbf24' : '#34d399';

    if (s.currentRoom) {
      $('#oe-roomtag').textContent = `Room ${(s.currentRoom.index ?? 0) + 1} / ${s.currentRoom.count ?? 1}`;
      $('#oe-room').textContent = s.currentRoom.title || '—';
      $('#oe-summary').textContent = s.currentRoom.summary || '';
    }

    const objs = (s.objectives || []).filter((o) => !s.currentRoom || o.roomId === s.currentRoom.id);
    $('#oe-objs').innerHTML = objs
      .map(
        (o) =>
          `<div class="oe-obj ${o.done ? 'done' : ''}"><span class="oe-check">${o.done ? '✓' : '○'}</span>${escapeHtml(o.label)}${o.optional ? ' <em>(optional)</em>' : ''}</div>`,
      )
      .join('');

    $('#oe-log').innerHTML = (s.log || []).slice(0, 6).map((l) => `<div>${escapeHtml(l)}</div>`).join('');
    const hint = $('#oe-hint');
    hint.textContent = s.hint || '';
    hint.style.opacity = s.hint ? '1' : '0';
  });

  return root;
}

function escapeHtml(v = '') {
  return String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function injectStyles() {
  if (document.getElementById('oe-hud-styles')) return;
  const style = document.createElement('style');
  style.id = 'oe-hud-styles';
  style.textContent = `
  .oe-hud { position: fixed; inset: 0; pointer-events: none; font-family: Inter, system-ui, -apple-system, sans-serif; z-index: 30; }
  .oe-panel { position: fixed; pointer-events: auto; border: 1px solid rgba(255,255,255,.12); background: rgba(5,12,24,.82); border-radius: 10px; padding: 12px 14px; box-shadow: 0 16px 60px rgba(0,0,0,.4); backdrop-filter: blur(10px); color: #e5f4ff; }
  .oe-tl { top: 14px; left: 14px; width: min(300px, 42vw); }
  .oe-tr { top: 14px; right: 14px; width: min(320px, 44vw); }
  .oe-bl { bottom: 14px; left: 14px; width: min(300px, 42vw); }
  .oe-kicker { margin: 0; color: #67e8f9; font-size: 10px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
  .oe-hud h1 { margin: 4px 0 0; font-size: 18px; line-height: 1.1; }
  .oe-hud h2 { margin: 4px 0 0; font-size: 16px; line-height: 1.15; }
  .oe-muted { margin: 4px 0 0; color: #94a3b8; font-size: 12px; line-height: 1.35; }
  .oe-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 10px; }
  .oe-stat { border: 1px solid rgba(255,255,255,.1); border-radius: 6px; padding: 6px; background: rgba(255,255,255,.04); }
  .oe-stat span { display: block; color: #94a3b8; font-size: 9px; font-weight: 800; text-transform: uppercase; }
  .oe-stat b { display: block; margin-top: 2px; font-size: 16px; color: #fff; }
  .oe-focusbar { margin-top: 8px; height: 5px; border-radius: 999px; background: rgba(255,255,255,.08); overflow: hidden; }
  .oe-focusbar i { display: block; height: 100%; width: 100%; background: #34d399; transition: width .2s ease; }
  .oe-objs { margin-top: 10px; max-height: 34vh; overflow: auto; }
  .oe-obj { font-size: 13px; padding: 5px 0; color: #dbeafe; border-bottom: 1px solid rgba(255,255,255,.05); }
  .oe-obj.done { color: #34d399; text-decoration: line-through; opacity: .8; }
  .oe-obj em { color: #64748b; font-style: normal; font-size: 11px; }
  .oe-check { display: inline-block; width: 16px; font-weight: 900; }
  .oe-log { margin-top: 6px; font-size: 12px; color: #94a3b8; line-height: 1.5; max-height: 100px; overflow: auto; }
  .oe-hint { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); pointer-events: none; background: rgba(3,7,18,.9); border: 1px solid rgba(103,232,249,.35); color: #e5f4ff; padding: 9px 16px; border-radius: 999px; font-size: 13px; max-width: 80vw; text-align: center; transition: opacity .25s ease; z-index: 42; }
  @media (max-width: 860px) {
    .oe-tl, .oe-tr, .oe-bl { position: fixed; width: calc(50vw - 20px); }
    .oe-bl { display: none; }
    .oe-hint { bottom: 92px; }
  }
  @media (prefers-reduced-motion: reduce) { .oe-focusbar i, .oe-hint { transition: none; } }
  `;
  document.head.appendChild(style);
}
