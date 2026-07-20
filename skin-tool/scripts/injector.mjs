import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback = '') => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const port = Number(value('--port', '9345'));
const cssPath = path.resolve(value('--css'));
const heroPath = path.resolve(value('--hero'));
const chatDarkPath = path.resolve(value('--chat-dark'));
const chatLightPath = path.resolve(value('--chat-light'));
const homeDarkPath = path.resolve(value('--home-dark'));
const homeLightPath = path.resolve(value('--home-light'));
const runningSpritePath = path.resolve(value('--running-sprite'));
const runningStaticPath = path.resolve(value('--running-static'));
const screenshotPath = value('--screenshot') ? path.resolve(value('--screenshot')) : '';
const watch = flag('--watch');
const remove = flag('--remove');
const verify = flag('--verify');

if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`Invalid port: ${port}`);
if ((!remove || verify) && (!value('--css') || !value('--hero') || !value('--chat-dark') || !value('--chat-light') || !value('--home-dark') || !value('--home-light') || !value('--running-sprite'))) {
  throw new Error('--css, --hero, --chat-dark, --chat-light, --home-dark, --home-light and --running-sprite are required.');
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const log = (message) => console.log(`[${new Date().toISOString()}] ${message}`);

function assertLoopbackWebSocket(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname) || url.port !== `${port}`) {
    throw new Error(`Refusing non-loopback CDP socket: ${rawUrl}`);
  }
  if (!/^\/devtools\/page\/[A-Za-z0-9._-]+$/.test(url.pathname)) {
    throw new Error(`Unexpected CDP target path: ${url.pathname}`);
  }
  return rawUrl;
}

class CdpConnection {
  constructor(url) {
    this.socket = new WebSocket(assertLoopbackWebSocket(url));
    this.sequence = 0;
    this.pending = new Map();
    this.closed = false;
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const payload = JSON.parse(event.data);
      if (!payload.id || !this.pending.has(payload.id)) return;
      const { resolve, reject, timer } = this.pending.get(payload.id);
      this.pending.delete(payload.id);
      clearTimeout(timer);
      if (payload.error) reject(new Error(payload.error.message));
      else resolve(payload.result);
    });
    this.socket.addEventListener('close', () => {
      this.closed = true;
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error('CDP socket closed.'));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error('CDP socket is closed.'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (!this.closed) this.socket.close();
  }
}

async function loadPayload() {
  const css = await fs.readFile(cssPath, 'utf8');
  const toDataUri = async (filePath) => {
    const data = await fs.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
    return `data:${mime};base64,${data.toString('base64')}`;
  };
  const [heroUri, chatDarkUri, chatLightUri, homeDarkUri, homeLightUri, runningSpriteUri, runningStaticUri] = await Promise.all([
    toDataUri(heroPath),
    toDataUri(chatDarkPath),
    toDataUri(chatLightPath),
    toDataUri(homeDarkPath),
    toDataUri(homeLightPath),
    toDataUri(runningSpritePath),
    toDataUri(runningStaticPath),
  ]);
  const themedCss = `html[data-workbuddy-skin="miku-v1"] {
  --wb-miku-hero: url(${JSON.stringify(heroUri)});
  --wb-miku-chat-dark: url(${JSON.stringify(chatDarkUri)});
  --wb-miku-chat-light: url(${JSON.stringify(chatLightUri)});
  --wb-miku-home-dark: url(${JSON.stringify(homeDarkUri)});
  --wb-miku-home-light: url(${JSON.stringify(homeLightUri)});
  --wb-miku-running-sprite: url(${JSON.stringify(runningSpriteUri)});
  --wb-miku-running-static: url(${JSON.stringify(runningStaticUri)});
}\n${css}`;
  return `(() => {
    const STYLE_ID = 'workbuddy-miku-skin-style';
    const LAYER_ID = 'workbuddy-miku-skin-layer';
    const MODE_KEY = 'workbuddy-miku-color-mode';
    const oldState = window.__workbuddyMikuSkinState;
    if (oldState?.observer) oldState.observer.disconnect();
    if (oldState?.modeHandler) document.removeEventListener('click', oldState.modeHandler, true);
    const applyDocument = (targetDocument, addLayer = false) => {
      const root = targetDocument?.documentElement;
      if (!root) return;
      root.dataset.workbuddySkin = 'miku-v1';
      const lightMode = root.classList.contains('light') ||
        root.classList.contains('cb-light') ||
        root.classList.contains('vscode-light') ||
        targetDocument.body?.classList.contains('light') ||
        targetDocument.body?.classList.contains('cb-light') ||
        targetDocument.body?.classList.contains('vscode-light');
      let preferredMode = '';
      try { preferredMode = targetDocument.defaultView?.localStorage?.getItem(MODE_KEY) || ''; } catch (_) { /* unavailable storage */ }
      root.dataset.workbuddyColorMode = ['light', 'dark'].includes(preferredMode)
        ? preferredMode
        : (lightMode ? 'light' : 'dark');
      let style = targetDocument.getElementById(STYLE_ID);
      if (!style) {
        style = targetDocument.createElement('style');
        style.id = STYLE_ID;
        (targetDocument.head || root).appendChild(style);
      }
      if (style.textContent !== ${JSON.stringify(themedCss)}) style.textContent = ${JSON.stringify(themedCss)};
      const chat = targetDocument.querySelector('.main-content--chat > .chat-container');
      const visible = (node) => {
        const rect = node?.getBoundingClientRect?.();
        const computed = node ? targetDocument.defaultView?.getComputedStyle?.(node) : null;
        return !!rect && rect.width > 2 && rect.height > 2 && computed?.display !== 'none' && computed?.visibility !== 'hidden';
      };
      const runningStatus = chat && [...chat.querySelectorAll('.avatar-fold-status,[data-status],[data-state],[aria-live]')]
        .some((node) => visible(node) && /执行中|运行中|生成中|思考中|处理中|进行中|working|running|generating|thinking|processing/i.test(node.textContent || ''));
      const stopControl = chat && [...chat.querySelectorAll('button,[role="button"]')]
        .some((node) => {
          if (!visible(node)) return false;
          const label = [node.textContent, node.getAttribute('aria-label'), node.getAttribute('title')].filter(Boolean).join(' ');
          return /停止|终止|停止生成|停止任务|stop generating|stop task|terminate/i.test(label);
        });
      const stopGlyph = chat && [...chat.querySelectorAll('svg[viewBox="0 0 32 32"] path')]
        .some((pathNode) => visible(pathNode.closest('svg')) && (pathNode.getAttribute('d') || '').includes('M13 10C11.3431'));
      const busySignal = chat?.querySelector('[aria-busy="true"],[data-state="streaming"],[data-state="generating"],[data-status="running"],[data-status="processing"]');
      const taskRunning = !!chat && (!!runningStatus || !!stopControl || !!stopGlyph || (busySignal && visible(busySignal)));
      if (taskRunning) root.dataset.workbuddyTaskRunning = 'true';
      else delete root.dataset.workbuddyTaskRunning;
      for (const stale of targetDocument.querySelectorAll('.workbuddy-miku-running-character')) {
        if (!chat || stale.parentElement !== chat) stale.remove();
      }
      if (chat && !chat.querySelector(':scope > .workbuddy-miku-running-character')) {
        const runningCharacter = targetDocument.createElement('div');
        runningCharacter.className = 'workbuddy-miku-running-character';
        runningCharacter.setAttribute('aria-hidden', 'true');
        chat.prepend(runningCharacter);
      }
      if (!addLayer || !targetDocument.body) return;
      let layer = targetDocument.getElementById(LAYER_ID);
      if (!layer) {
        layer = targetDocument.createElement('div');
        layer.id = LAYER_ID;
        layer.className = 'workbuddy-miku-skin-layer';
        layer.setAttribute('aria-hidden', 'true');
        const badge = targetDocument.createElement('div');
        badge.className = 'workbuddy-miku-skin-badge';
        badge.textContent = 'MIKU MODE // 01';
        layer.appendChild(badge);
        for (let index = 0; index < 18; index += 1) {
          const particle = targetDocument.createElement('i');
          particle.className = 'workbuddy-miku-particle';
          particle.style.left = (9 + ((index * 47) % 87)) + '%';
          particle.style.top = (8 + ((index * 31) % 84)) + '%';
          particle.style.animationDelay = (-index * 0.63) + 's';
          particle.style.animationDuration = (6.5 + (index % 5) * 0.8) + 's';
          layer.appendChild(particle);
        }
        targetDocument.body.appendChild(layer);
      }
    };
    const applyFrames = () => {
      for (const frame of document.querySelectorAll('iframe')) {
        if (!frame.dataset.workbuddyMikuLoadBound) {
          frame.dataset.workbuddyMikuLoadBound = '1';
          frame.addEventListener('load', () => {
            try { applyDocument(frame.contentDocument, false); } catch (_) { /* cross-origin frame */ }
          });
        }
        try { applyDocument(frame.contentDocument, false); } catch (_) { /* cross-origin frame */ }
      }
    };
    const apply = () => {
      applyDocument(document, window.top === window);
      applyFrames();
    };
    const modeHandler = (event) => {
      if (!event.isTrusted) return;
      const option = event.target?.closest?.('.user-menu-theme-option');
      if (!option) return;
      const label = (option.textContent || '').trim();
      const mode = label.includes('浅色') ? 'light' : (label.includes('深色') ? 'dark' : '');
      if (!mode) return;
      try { localStorage.setItem(MODE_KEY, mode); } catch (_) { /* unavailable storage */ }
      setTimeout(apply, 0);
    };
    document.addEventListener('click', modeHandler, true);
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'd', 'aria-busy', 'aria-label', 'title', 'data-state', 'data-status'],
    });
    window.__workbuddyMikuSkinState = { observer, apply, modeHandler };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
    apply();
  })()`;
}

const removePayload = `(() => {
  window.__workbuddyMikuSkinState?.observer?.disconnect();
  if (window.__workbuddyMikuSkinState?.modeHandler) {
    document.removeEventListener('click', window.__workbuddyMikuSkinState.modeHandler, true);
  }
  delete window.__workbuddyMikuSkinState;
  try { localStorage.removeItem('workbuddy-miku-color-mode'); } catch (_) { /* unavailable storage */ }
  const removeDocument = (targetDocument) => {
    targetDocument?.getElementById('workbuddy-miku-skin-style')?.remove();
    targetDocument?.getElementById('workbuddy-miku-skin-layer')?.remove();
    for (const character of targetDocument?.querySelectorAll?.('.workbuddy-miku-running-character') || []) character.remove();
    if (targetDocument?.documentElement?.dataset.workbuddySkin === 'miku-v1') {
      delete targetDocument.documentElement.dataset.workbuddySkin;
    }
    delete targetDocument?.documentElement?.dataset.workbuddyColorMode;
    delete targetDocument?.documentElement?.dataset.workbuddyTaskRunning;
  };
  removeDocument(document);
  for (const frame of document.querySelectorAll('iframe')) {
    try { removeDocument(frame.contentDocument); } catch (_) { /* cross-origin frame */ }
  }
  return true;
})()`;

async function getTargets() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error(`CDP target list returned ${response.status}.`);
  const targets = await response.json();
  return targets.filter((target) => target.type === 'page' &&
    /WorkBuddy/i.test(`${target.title || ''} ${target.url || ''}`) && target.webSocketDebuggerUrl);
}

async function injectTarget(target, payload) {
  const connection = new CdpConnection(target.webSocketDebuggerUrl);
  await connection.open();
  if (remove) {
    await connection.send('Runtime.evaluate', { expression: removePayload, awaitPromise: false });
    connection.close();
    return null;
  }
  await connection.send('Page.addScriptToEvaluateOnNewDocument', { source: payload });
  await connection.send('Runtime.evaluate', { expression: payload, awaitPromise: false });
  return connection;
}

async function verifyTarget(target, payload) {
  const connection = await injectTarget(target, payload);
  const result = await connection.send('Runtime.evaluate', {
    expression: `JSON.stringify({
      marker: document.documentElement?.dataset.workbuddySkin,
      style: !!document.getElementById('workbuddy-miku-skin-style'),
      layer: !!document.getElementById('workbuddy-miku-skin-layer'),
      sidebar: !!document.querySelector('.conversation-list'),
      home: !!document.querySelector('.wb-home-page'),
      composer: !!document.querySelector('.wb-home-composer'),
    })`,
    returnByValue: true,
  });
  const details = JSON.parse(result.result.value);
  const passed = details.marker === 'miku-v1' && details.style && details.layer && details.sidebar;
  if (!passed) throw new Error(`Skin verification failed: ${JSON.stringify(details)}`);
  if (screenshotPath) {
    const capture = await connection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
    await fs.writeFile(screenshotPath, Buffer.from(capture.data, 'base64'));
  }
  connection.close();
  log(`PASS ${JSON.stringify(details)}`);
}

const payload = remove && !verify ? '' : await loadPayload();

if (verify) {
  const targets = await getTargets();
  if (!targets.length) throw new Error('WorkBuddy renderer target not found.');
  await verifyTarget(targets[0], payload);
  process.exit(0);
}

if (remove) {
  const targets = await getTargets().catch(() => []);
  for (const target of targets) await injectTarget(target, '');
  log(`Removed skin from ${targets.length} renderer target(s).`);
  process.exit(0);
}

const connections = new Map();

async function scan() {
  const targets = await getTargets();
  const currentIds = new Set(targets.map((target) => target.id));
  for (const [id, connection] of connections) {
    if (!currentIds.has(id) || connection.closed) {
      connection.close();
      connections.delete(id);
    }
  }
  for (const target of targets) {
    if (connections.has(target.id)) continue;
    try {
      const connection = await injectTarget(target, payload);
      connections.set(target.id, connection);
      log(`Injected Miku skin into target ${target.id}.`);
    } catch (error) {
      log(`Target ${target.id} injection failed: ${error.message}`);
    }
  }
  return targets.length;
}

const initialTargets = await scan();
if (!initialTargets) throw new Error('WorkBuddy renderer target not found.');
if (!watch) {
  for (const connection of connections.values()) connection.close();
  process.exit(0);
}

const shutdown = () => {
  for (const connection of connections.values()) connection.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

while (true) {
  await sleep(900);
  try {
    await scan();
  } catch (error) {
    log(`CDP scan failed: ${error.message}`);
  }
}
