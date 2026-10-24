// Minimal Chrome DevTools Protocol client.
// Talks to a Chrome you already started with --remote-debugging-port.

export async function findTarget(endpoint, match = '') {
  const res = await fetch(`${endpoint}/json/list`);
  const pages = (await res.json()).filter((t) => t.type === 'page');
  return pages.find((t) => t.url.includes(match)) ?? (match ? null : pages[0]);
}

export async function listTargets(endpoint) {
  const res = await fetch(`${endpoint}/json/list`);
  return (await res.json()).filter((t) => t.type === 'page');
}

export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error(`cannot connect to ${wsUrl}`));
  });

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  };

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  return { send, close: () => ws.close() };
}

// Flatten Page.getFrameTree into a list of frames.
export async function frames(cdp) {
  const { frameTree } = await cdp.send('Page.getFrameTree');
  const out = [];
  (function walk(node) {
    out.push(node.frame);
    (node.childFrames ?? []).forEach(walk);
  })(frameTree);
  return out;
}
