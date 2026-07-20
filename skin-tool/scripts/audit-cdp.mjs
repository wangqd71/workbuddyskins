import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const value = (name, fallback = '') => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const port = Number(value('--port', '9345'));
const action = value('--action', 'snapshot');
const selector = value('--selector');
const textQuery = value('--text');
const mode = value('--mode');
const output = value('--output') ? path.resolve(value('--output')) : '';
const waitMs = Number(value('--wait', '900'));

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.sequence = 0;
    this.pending = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const payload = JSON.parse(event.data);
      if (!payload.id || !this.pending.has(payload.id)) return;
      const pending = this.pending.get(payload.id);
      this.pending.delete(payload.id);
      clearTimeout(pending.timer);
      if (payload.error) pending.reject(new Error(payload.error.message));
      else pending.resolve(payload.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() { this.socket.close(); }
}

const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) });
const targets = await response.json();
const target = targets.find((item) => item.type === 'page' && /WorkBuddy/i.test(`${item.title} ${item.url}`));
if (!target?.webSocketDebuggerUrl) throw new Error('WorkBuddy renderer target not found.');
const socketUrl = new URL(target.webSocketDebuggerUrl);
if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(socketUrl.hostname) || socketUrl.port !== String(port)) {
  throw new Error('Refusing non-loopback CDP socket.');
}

const cdp = new Cdp(target.webSocketDebuggerUrl);
await cdp.open();
const evaluate = async (expression) => {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed.');
  return result.result.value;
};

if (action === 'snapshot') {
  const result = await evaluate(`(() => {
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 2 && rect.height > 2 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const elements = [...document.querySelectorAll('main,aside,nav,section,header,footer,[role],button,a,input,textarea,img,svg,[contenteditable="true"],[class]')]
      .filter(visible)
      .slice(0, 1600)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const text = (node.innerText || node.getAttribute('aria-label') || node.getAttribute('title') || '').replace(/\\s+/g, ' ').trim().slice(0, 90);
        return {
          tag: node.tagName.toLowerCase(),
          id: node.id || '',
          class: typeof node.className === 'string' ? node.className : '',
          role: node.getAttribute('role') || '',
          text,
          rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
        };
      });
    return JSON.stringify({
      title: document.title,
      hash: location.hash,
      bodyClass: document.body?.className || '',
      viewport: [innerWidth, innerHeight, devicePixelRatio],
      elements,
    }, null, 2);
  })()`);
  if (output) {
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, result, 'utf8');
  } else console.log(result);
} else if (action === 'click') {
  const result = await evaluate(`(() => {
    const selector = ${JSON.stringify(selector)};
    const textQuery = ${JSON.stringify(textQuery)};
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 2 && rect.height > 2 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    let node = selector ? document.querySelector(selector) : null;
    if (!node && textQuery) {
      const candidates = [...document.querySelectorAll('button,a,[role="button"],[role="menuitem"],[role="tab"],li,div')].filter(visible);
      node = candidates.find((item) => (item.innerText || item.textContent || '').replace(/\\s+/g, ' ').trim() === textQuery)
        || candidates.find((item) => (item.innerText || item.textContent || '').replace(/\\s+/g, ' ').trim().includes(textQuery));
    }
    if (!node) return JSON.stringify({ clicked: false, selector, textQuery });
    node.scrollIntoView({ block: 'center', inline: 'center' });
    node.click();
    return JSON.stringify({ clicked: true, tag: node.tagName, id: node.id, class: node.className, text: (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160) });
  })()`);
  console.log(result);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
} else if (action === 'mask-private') {
  const result = await evaluate(`(() => {
    const STYLE_ID = 'workbuddy-audit-privacy-mask';
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = '.conversation-item [class*="_title_"],.conversation-item [class*="_subtitle_"],.conversation-item-title,.conversation-item-subtitle,[class*="conversation-title"],[class*="task-title"]{filter:blur(5px)!important;user-select:none!important}';
    return true;
  })()`);
  console.log(JSON.stringify({ masked: result }));
} else if (action === 'unmask-private') {
  const result = await evaluate(`(() => {
    const style = document.getElementById('workbuddy-audit-privacy-mask');
    if (!style) return false;
    style.remove();
    return true;
  })()`);
  console.log(JSON.stringify({ removed: result }));
} else if (action === 'theme-state') {
  const result = await evaluate(`(() => {
    const entries = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      const rawValue = localStorage.getItem(key);
      if (/theme|appearance|color|dark|light/i.test(key + ' ' + rawValue)) {
        entries.push([key, rawValue?.slice(0, 500)]);
      }
    }
    return JSON.stringify({
      htmlClass: document.documentElement.className,
      bodyClass: document.body?.className,
      skinMode: document.documentElement.dataset.workbuddyColorMode,
      activeAppearance: document.querySelector('.user-menu-theme-option--active')?.textContent?.trim() || '',
      localStorage: entries,
    }, null, 2);
  })()`);
  console.log(result);
} else if (action === 'set-skin-mode') {
  if (!['light', 'dark'].includes(mode)) throw new Error('--mode must be light or dark.');
  const result = await evaluate(`(() => {
    localStorage.setItem('workbuddy-miku-color-mode', ${JSON.stringify(mode)});
    window.__workbuddyMikuSkinState?.apply?.();
    return document.documentElement.dataset.workbuddyColorMode;
  })()`);
  console.log(JSON.stringify({ skinMode: result }));
} else if (action === 'set-running-preview') {
  if (!['true', 'false'].includes(mode)) throw new Error('--mode must be true or false.');
  const result = await evaluate(`(() => {
    const enabled = ${JSON.stringify(mode)} === 'true';
    if (enabled) document.documentElement.dataset.workbuddyTaskRunning = 'true';
    else delete document.documentElement.dataset.workbuddyTaskRunning;
    const node = document.querySelector('.workbuddy-miku-running-character');
    if (!node) return JSON.stringify({ enabled, found: false });
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return JSON.stringify({
      enabled,
      found: true,
      rect: [rect.x, rect.y, rect.width, rect.height],
      opacity: style.opacity,
      visibility: style.visibility,
      display: style.display,
      animationName: style.animationName,
      backgroundSize: style.backgroundSize,
      zIndex: style.zIndex,
    });
  })()`);
  console.log(result);
} else if (action === 'preview-preparing') {
  if (!['true', 'false'].includes(mode)) throw new Error('--mode must be true or false.');
  const result = await evaluate(`(() => {
    document.querySelector('.workbuddy-audit-preparing-preview')?.remove();
    if (${JSON.stringify(mode)} === 'false') return JSON.stringify({ enabled: false });
    const host = document.querySelector('.main-content') || document.body;
    const overlay = document.createElement('div');
    overlay.className = 'workspace-preparing workbuddy-audit-preparing-preview';
    overlay.innerHTML = '<div class="workspace-preparing__content"><div class="workspace-preparing__icon"><img alt="Workspace Robot"></div><h2 class="workspace-preparing__title">正在准备执行<span class="cb-loading-dots">...</span></h2><p class="workspace-preparing__description">Agent 正在接手并进入工作状态。</p><div class="workspace-preparing__progress"><div class="workspace-preparing__progress-track"><div class="workspace-preparing__progress-bar" style="width:42%"></div></div></div></div>';
    host.appendChild(overlay);
    const rect = overlay.getBoundingClientRect();
    return JSON.stringify({ enabled: true, rect: [rect.x, rect.y, rect.width, rect.height] });
  })()`);
  console.log(result);
} else if (action === 'probe-running-detector') {
  const result = await evaluate(`(async () => {
    const chat = document.querySelector('.main-content--chat > .chat-container');
    if (!chat) return JSON.stringify({ found: false });
    delete document.documentElement.dataset.workbuddyTaskRunning;
    const probe = document.createElement('span');
    probe.className = 'avatar-fold-status';
    probe.textContent = '执行中';
    probe.style.cssText = 'position:absolute;left:1px;top:1px;width:20px;height:20px;opacity:.01';
    chat.appendChild(probe);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const activated = document.documentElement.dataset.workbuddyTaskRunning === 'true';
    probe.remove();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const cleared = document.documentElement.dataset.workbuddyTaskRunning !== 'true';
    return JSON.stringify({ found: true, activated, cleared });
  })()`);
  console.log(result);
} else if (action === 'probe-stop-glyph-detector') {
  const result = await evaluate(`(async () => {
    const chat = document.querySelector('.main-content--chat > .chat-container');
    const pathNode = chat && [...chat.querySelectorAll('svg[viewBox="0 0 32 32"] path')]
      .find((node) => (node.getAttribute('d') || '').includes('M16 19.2104'));
    if (!pathNode) return JSON.stringify({ found: false });
    const originalPath = pathNode.getAttribute('d');
    pathNode.setAttribute('d', 'M16 32C24.8366 32 32 24.8366 32 16C32 7.16344 24.8366 0 16 0C7.16344 0 0 7.16344 0 16C0 24.8366 7.16344 32 16 32ZM13 10C11.3431 10 10 11.3431 10 13V19C10 20.6569 11.3431 22 13 22H19C20.6569 22 22 20.6569 22 19V13C22 11.3431 20.6569 10 19 10H13Z');
    await new Promise((resolve) => setTimeout(resolve, 140));
    const activated = document.documentElement.dataset.workbuddyTaskRunning === 'true';
    pathNode.setAttribute('d', originalPath);
    await new Promise((resolve) => setTimeout(resolve, 140));
    const cleared = document.documentElement.dataset.workbuddyTaskRunning !== 'true';
    return JSON.stringify({ found: true, activated, cleared });
  })()`);
  console.log(result);
} else if (action === 'running-signals') {
  const result = await evaluate(`(() => {
    const chat = document.querySelector('.main-content--chat > .chat-container');
    if (!chat) return JSON.stringify({ found: false });
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 2 && rect.height > 2 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const describe = (node) => ({
      tag: node.tagName,
      class: typeof node.className === 'string' ? node.className : '',
      text: (node.textContent || '').trim().slice(0, 120),
      ariaLabel: node.getAttribute('aria-label'),
      title: node.getAttribute('title'),
      ariaBusy: node.getAttribute('aria-busy'),
      dataState: node.getAttribute('data-state'),
      dataStatus: node.getAttribute('data-status'),
      svgPaths: [...node.querySelectorAll('svg path')].map((path) => path.getAttribute('d')).filter(Boolean).slice(0, 4),
      svgHtml: node.querySelector('svg')?.outerHTML.slice(0, 500) || '',
      childTags: [...node.children].map((child) => child.tagName).slice(0, 8),
      visible: visible(node),
    });
    return JSON.stringify({
      found: true,
      rootRunning: document.documentElement.dataset.workbuddyTaskRunning || '',
      statuses: [...chat.querySelectorAll('.avatar-fold-status,[data-status],[data-state],[aria-live]')].map(describe),
      controls: [...chat.querySelectorAll('button,[role="button"]')].map(describe),
      busy: [...chat.querySelectorAll('[aria-busy="true"],[data-state="streaming"],[data-state="generating"],[data-status="running"],[data-status="processing"]')].map(describe),
    }, null, 2);
  })()`);
  console.log(result);
} else if (action === 'computed-style') {
  if (!selector) throw new Error('--selector is required for computed-style.');
  const result = await evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return JSON.stringify({ found: false });
    const style = getComputedStyle(node);
    const beforeStyle = getComputedStyle(node, '::before');
    const rect = node.getBoundingClientRect();
    return JSON.stringify({
      found: true,
      selector: ${JSON.stringify(selector)},
      rect: [rect.x, rect.y, rect.width, rect.height],
      background: style.background.slice(0, 320),
      backgroundImage: style.backgroundImage.slice(0, 320),
      backgroundColor: style.backgroundColor,
      backgroundSize: style.backgroundSize,
      backgroundPosition: style.backgroundPosition,
      color: style.color,
      opacity: style.opacity,
      textShadow: style.textShadow,
      filter: style.filter,
      beforeBackgroundImage: beforeStyle.backgroundImage.slice(0, 160),
      beforeBackgroundSize: beforeStyle.backgroundSize,
      beforeBackgroundPosition: beforeStyle.backgroundPosition,
      beforeAnimationName: beforeStyle.animationName,
      outerHtml: node.outerHTML.slice(0, 1800),
      parentClasses: [node.parentElement, node.parentElement?.parentElement, node.parentElement?.parentElement?.parentElement]
        .filter(Boolean)
        .map((parent) => typeof parent.className === 'string' ? parent.className : ''),
      skinStylePrefix: document.getElementById('workbuddy-miku-skin-style')?.textContent?.slice(0, 500) || '',
      skinStyleLength: document.getElementById('workbuddy-miku-skin-style')?.textContent?.length || 0,
      chatDarkIndex: document.getElementById('workbuddy-miku-skin-style')?.textContent?.indexOf('--wb-miku-chat-dark') ?? -1,
      chatLightIndex: document.getElementById('workbuddy-miku-skin-style')?.textContent?.indexOf('--wb-miku-chat-light') ?? -1,
      rootChatDark: getComputedStyle(document.documentElement).getPropertyValue('--wb-miku-chat-dark').slice(0, 120),
      rootChatLight: getComputedStyle(document.documentElement).getPropertyValue('--wb-miku-chat-light').slice(0, 120),
      runningSpriteLength: getComputedStyle(document.documentElement).getPropertyValue('--wb-miku-running-sprite').length,
      runningSpritePrefix: getComputedStyle(document.documentElement).getPropertyValue('--wb-miku-running-sprite').slice(0, 120),
    }, null, 2);
  })()`);
  console.log(result);
} else if (action === 'screenshot') {
  if (!output) throw new Error('--output is required for screenshot.');
  const capture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, Buffer.from(capture.data, 'base64'));
  console.log(output);
} else {
  throw new Error(`Unknown action: ${action}`);
}

cdp.close();
