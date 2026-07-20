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
const output = value('--out') ? path.resolve(value('--out')) : '';
const waitMs = Number(value('--wait', '800'));

if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`Invalid port: ${port}`);

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl && !item.url.startsWith('devtools://'));
if (!target) throw new Error(`No WorkBuddy page target found on port ${port}.`);

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
      const { resolve, reject } = this.pending.get(payload.id);
      this.pending.delete(payload.id);
      if (payload.error) reject(new Error(payload.error.message));
      else resolve(payload.result);
    });
  }
  send(method, params = {}) {
    const id = ++this.sequence;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  close() { this.socket.close(); }
}

const cdp = new Cdp(target.webSocketDebuggerUrl);
await cdp.open();
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');

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
      return rect.width > 2 && rect.height > 2 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const elements = [...document.querySelectorAll('button,a,input,textarea,[role],[aria-label],[class]')]
      .filter(visible)
      .slice(0, 1600)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          tag: node.tagName.toLowerCase(), id: node.id || '', class: typeof node.className === 'string' ? node.className : '',
          role: node.getAttribute('role') || '', aria: node.getAttribute('aria-label') || '',
          text: (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 140),
          rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
        };
      });
    return JSON.stringify({ title: document.title, url: location.href, viewport: [innerWidth, innerHeight, devicePixelRatio], elements }, null, 2);
  })()`);
  if (output) { await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, result, 'utf8'); }
  else console.log(result);
} else if (action === 'computed') {
  if (!selector) throw new Error('--selector is required for computed.');
  console.log(await evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return JSON.stringify({ found: false }, null, 2);
    const style = getComputedStyle(node); const before = getComputedStyle(node, '::before'); const rect = node.getBoundingClientRect();
    return JSON.stringify({ found: true, rect: [rect.x, rect.y, rect.width, rect.height], display: style.display,
      position: style.position, opacity: style.opacity, filter: style.filter, transform: style.transform,
      backgroundImage: style.backgroundImage.slice(0, 180), beforeBackgroundImage: before.backgroundImage.slice(0, 180),
      beforePosition: before.backgroundPosition, beforeSize: before.backgroundSize }, null, 2);
  })()`));
} else if (action === 'click') {
  console.log(await evaluate(`(() => {
    const selector = ${JSON.stringify(selector)}; const text = ${JSON.stringify(textQuery)};
    let node = selector ? document.querySelector(selector) : null;
    if (!node && text) node = [...document.querySelectorAll('button,a,[role="button"],[role="menuitem"],li,div')]
      .find((item) => (item.innerText || item.textContent || '').replace(/\\s+/g, ' ').trim() === text);
    if (!node) return JSON.stringify({ clicked: false }); node.click(); return JSON.stringify({ clicked: true, tag: node.tagName, class: node.className });
  })()`));
  await new Promise((resolve) => setTimeout(resolve, waitMs));
} else if (action === 'screenshot') {
  if (!output) throw new Error('--out is required for screenshot.');
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, Buffer.from(result.data, 'base64'));
  console.log(output);
} else {
  throw new Error(`Unsupported action: ${action}`);
}

cdp.close();
