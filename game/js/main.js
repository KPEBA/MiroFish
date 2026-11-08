// Swarm Town — main.js : boot. Creates the engine, wires bus commands, loads UI (optional) and data.
import { bus, emit, on } from './bus.js';
import { createEngine } from './engine.js';
import { t, onLangChange } from './i18n.js';

const container = document.getElementById('game-canvas');
const canvas = document.createElement('canvas');
canvas.id = 'town';
const applyLang = () => { canvas.setAttribute('aria-label', t('canvas.aria')); document.title = t('app.title'); container.setAttribute('aria-label', t('canvas.aria')); };
applyLang(); onLangChange(applyLang);
Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', imageRendering: 'pixelated' });
if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
container.style.overflow = 'hidden';
container.appendChild(canvas);

const engine = createEngine(canvas);

// ---- bus commands -> engine
on('cmd-play', () => engine.play());
on('cmd-pause', () => engine.pause());
on('cmd-speed', d => engine.setSpeed(d && d.speed));
on('cmd-seek', d => d && d.round != null && engine.seek(d.round));
on('cmd-select-agent', d => engine.select(d ? d.agentId : null));
on('cmd-follow-camera', d => engine.followCamera(d ? d.agentId : null));
on('cmd-god-event', d => engine.godEvent(d || {}));
on('cmd-load-data', d => {
  try { if (d && d.data) engine.load(d.data); }
  catch (err) { console.warn('[swarm-town] load failed:', err); }
});

// bus handle usable either as the module namespace style ({emit,on}) or as an EventTarget
const busApi = { bus, emit, on, addEventListener: bus.addEventListener.bind(bus), removeEventListener: bus.removeEventListener.bind(bus), dispatchEvent: bus.dispatchEvent.bind(bus) };
window.swarmTown = { engine, bus: busApi };

async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

async function boot() {
  try {
    const ui = await import('./ui.js');
    if (ui && typeof ui.initUI === 'function') ui.initUI(engine, busApi);
  } catch (err) {
    console.warn('[swarm-town] UI not loaded, running engine only:', err && err.message);
  }
  const params = new URLSearchParams(location.search);
  const sources = [params.get('data'), 'data/town_data.json', 'data/dev_fixture.json'].filter(Boolean);
  for (const src of sources) {
    try {
      const data = await fetchJson(src);
      engine.load(data);
      if (params.get('autoplay') !== '0') engine.play();
      return;
    } catch (err) { console.info('[swarm-town] could not load', src, '-', err.message); }
  }
  console.warn('[swarm-town] no data found');
}
boot();
