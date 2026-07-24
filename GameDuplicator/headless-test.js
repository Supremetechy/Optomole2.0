const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const projectRoot = path.resolve(__dirname);
const htmlPath = path.join(projectRoot, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const virtualConsole = new VirtualConsole();
const captured = [];

virtualConsole.on('log', (msg) => captured.push({ type: 'log', msg: String(msg) }));
virtualConsole.on('error', (msg) => captured.push({ type: 'error', msg: String(msg) }));
virtualConsole.on('warn', (msg) => captured.push({ type: 'warn', msg: String(msg) }));
virtualConsole.on('info', (msg) => captured.push({ type: 'info', msg: String(msg) }));

(async function run() {
  try {
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      resources: 'usable',
      virtualConsole,
      pretendToBeVisual: true,
      url: 'http://localhost'
    });

    const { window } = dom;

    // Lightweight mocks for browser APIs used in page scripts
    if (!window.AudioContext && !window.webkitAudioContext) {
      window.AudioContext = function() { this.createOscillator = () => ({ connect() {}, start() {}, stop() {} }); this.createGain = () => ({ connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }); };
      window.webkitAudioContext = window.AudioContext;
    }

    if (!window.HTMLCanvasElement) {
      window.HTMLCanvasElement = function(){};
    }
    if (!window.HTMLCanvasElement.prototype.getContext) {
      window.HTMLCanvasElement.prototype.getContext = function() {
        return {
          fillRect() {}, clearRect() {}, fillText() {}, measureText() { return { width: 0 }; }, beginPath() {}, arc() {}, stroke() {}, moveTo() {}, lineTo() {}, closePath() {}, createLinearGradient() { return {}; }
        };
      };
    }

    // Give scripts time to execute (external resources are mostly CSS, inline scripts run immediately)
    await new Promise(resolve => setTimeout(resolve, 800));

    function safeGet(id) { return window.document.getElementById(id); }

    const ids = [
      { btn: 'nftMarketplaceBtn', modal: 'nftMarketplaceModal' },
      { btn: 'assetStoreBtn', modal: 'assetStoreModal' },
      { btn: 'settingsBtn', modal: 'settingsModal' }
    ];

    captured.push({ type: 'info', msg: 'Starting synthetic clicks' });

    for (const pair of ids) {
      const el = safeGet(pair.btn);
      captured.push({ type: 'info', msg: `${pair.btn} present: ${!!el}` });
      try {
        if (el && typeof el.click === 'function') {
          el.click();
          captured.push({ type: 'info', msg: `Clicked ${pair.btn}` });
        } else if (el) {
          // fallback: dispatch event
          const ev = new window.MouseEvent('click', { bubbles: true, cancelable: true });
          el.dispatchEvent(ev);
          captured.push({ type: 'info', msg: `Dispatched click on ${pair.btn}` });
        }
      } catch (e) {
        captured.push({ type: 'error', msg: `Error clicking ${pair.btn}: ${e && e.stack ? e.stack : e}` });
      }

      // Small pause to allow any handler to run
      await new Promise(resolve => setTimeout(resolve, 200));

      const modal = safeGet(pair.modal);
      if (modal) {
        const isHidden = modal.classList ? modal.classList.contains('hidden') : null;
        captured.push({ type: 'info', msg: `${pair.modal} exists: true, hidden: ${isHidden}` });
      } else {
        captured.push({ type: 'warn', msg: `${pair.modal} not found in DOM` });
      }
    }

    // Flush virtualConsole messages captured
    captured.push({ type: 'info', msg: 'Flushing virtual console entries' });
    // Print results
    console.log('\n--- HEADLESS TEST OUTPUT ---');
    captured.forEach(e => console.log(`[${e.type}] ${e.msg}`));
    console.log('--- END OUTPUT ---\n');

    // Also dump virtualConsole events
    process.exit(0);
  } catch (err) {
    console.error('Test script error:', err && err.stack ? err.stack : err);
    process.exit(2);
  }
})();
