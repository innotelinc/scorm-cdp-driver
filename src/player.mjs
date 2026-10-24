// Page-level operations against a SCORM player running inside nested iframes.
import { frames } from './cdp.mjs';

export const DEFAULT_CONTENT_FRAME = /cdn\d*\.litmos\.com/;
const WRAPPER_FRAME = /scorm-wrapper/;

// The slide lives in the deepest iframe on the CDN origin. The SCORM wrapper
// frame also matches the origin filter, so exclude it and take the last match.
export async function contentFrame(cdp, pattern = DEFAULT_CONTENT_FRAME) {
  const all = await frames(cdp);
  const matches = all.filter((f) => pattern.test(f.url) && !WRAPPER_FRAME.test(f.url));
  return matches[matches.length - 1] ?? null;
}

// Evaluate in the frame's own world. Isolated worlds share the DOM but not the
// page's globals, which is all we need: we only read markup and click nodes.
export async function evaluate(cdp, frameId, expression) {
  const { executionContextId } = await cdp.send('Page.createIsolatedWorld', {
    frameId,
    worldName: 'scorm-driver',
  });
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    contextId: executionContextId,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 300));
  }
  return result.result.value;
}

const RECT_IN_TOP = `JSON.stringify((r => ({x: r.x, y: r.y}))(document.querySelector('iframe').getBoundingClientRect()))`;

// Input events are dispatched in the top-level viewport, so content-frame
// coordinates need the offsets of every iframe between the two.
async function viewportOffset(cdp) {
  const all = await frames(cdp);
  const wrapper = all.find((f) => WRAPPER_FRAME.test(f.url));

  const rectIn = async (frameId) => {
    const expr = RECT_IN_TOP;
    return JSON.parse(await evaluate(cdp, frameId, expr));
  };

  const outer = wrapper ? await rectIn(wrapper.id) : { x: 0, y: 0 };
  const top = JSON.parse(
    (await cdp.send('Runtime.evaluate', { expression: RECT_IN_TOP, returnByValue: true })).result.value,
  );

  return { dx: outer.x + top.x, dy: outer.y + top.y };
}

// The player ignores synthetic clicks (element.click(), dispatched MouseEvent),
// so every interaction has to be a real CDP input event at real coordinates.
export async function clickAt(cdp, x, y) {
  const { dx, dy } = await viewportOffset(cdp);
  const absoluteX = Math.round(x + dx);
  const absoluteY = Math.round(y + dy);

  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', {
      type,
      x: absoluteX,
      y: absoluteY,
      button: 'left',
      buttons: type === 'mousePressed' ? 1 : 0,
      clickCount: type === 'mouseMoved' ? 0 : 1,
      pointerType: 'mouse',
    });
    if (type === 'mousePressed') await new Promise((r) => setTimeout(r, 60));
  }
  return [absoluteX, absoluteY];
}

// --- probes -------------------------------------------------------------

export const PROBE = `(() => {
  const txt = document.body.innerText || '';
  const next = document.querySelector('#next');
  const timeline = document.querySelector('input[type=range]:not(.volume-range)');
  const modals = [...document.querySelectorAll('button')]
    .filter(b => /^(Resume|Restart|Continue)$/i.test((b.innerText || '').trim()))
    .filter(b => b.offsetParent || b.getClientRects().length);
  const audio = [...document.querySelectorAll('audio')].filter(a => a.duration > 0.5);
  return JSON.stringify({
    counter: (txt.match(/(\\d+)\\s+of\\s+(\\d+)/) || [])[0] || null,
    head: (txt.split('\\n')[0] || '').trim(),
    timeline: timeline ? { value: Math.round(+timeline.value), max: Math.round(+timeline.max) } : null,
    nextDisabled: next ? /disabled/.test(next.className) : true,
    audioPlaying: audio.filter(a => !a.paused).length,
    audioAny: audio.length,
    modal: modals.map(b => b.innerText.trim()),
    tail: txt.replace(/\\s+/g, ' ').slice(0, 260),
  });
})()`;

const normalise = `const norm = s => (s || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();`;

export const OPTIONS = `(() => {
  ${normalise}
  return JSON.stringify(
    [...document.querySelectorAll('.slide-object.cursor-hover')]
      .map(e => {
        const r = e.getBoundingClientRect();
        return { text: norm(e.innerText), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      })
      .filter(o => o.text && o.text.length > 1 && !/^Choose the correct/i.test(o.text) && o.y > 90)
  );
})()`;

export const GATE = `(() => {
  ${normalise}
  const hit = [...document.querySelectorAll('.slide-object.cursor-hover')]
    .map(e => {
      const r = e.getBoundingClientRect();
      return { text: norm(e.innerText), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })
    .find(o => /view policy|view the policy|open the full pdf/i.test(o.text) && o.y > 90);
  return hit ? JSON.stringify(hit) : '';
})()`;

export const TRAFFIC = `(() => {
  const lamps = [...document.querySelectorAll('.acc-shadow-el.acc-button')]
    .map(e => {
      const r = e.getBoundingClientRect();
      return { text: (e.innerText || '').trim(), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width) };
    })
    .filter(o => o.w > 20)
    .sort((a, b) => a.y - b.y);
  const txt = (document.querySelector('.slide-container')?.innerText || '').replace(/\\s+/g, ' ');
  const isTraffic = lamps.length === 3 && (/Red Light/i.test(txt) || lamps.some(l => /light/i.test(l.text)));
  return JSON.stringify({ isTraffic, lamps, question: txt.slice(0, 160) });
})()`;

// The player mirrors results into its accessibility layer, which is the only
// reliable way to confirm an answer without depending on the score display.
export const VERDICT = `(() => {
  const t = [...document.querySelectorAll('.acc-shadow-el.acc-text')]
    .map(e => (e.innerText || '').trim()).filter(Boolean).join(' ');
  if (/incorrect/i.test(t)) return 'INCORRECT: ' + t.slice(0, 160);
  if (/correct/i.test(t)) return 'CORRECT';
  return '';
})()`;

// Attestation gate. Never automated: certifying completion is a statement
// about the person, so the driver stops and hands back to the human.
export const CERTIFICATION = `(() => {
  const txt = document.querySelector('.slide-container')?.innerText || '';
  const button = [...document.querySelectorAll('.slide-object.cursor-hover, button')]
    .map(e => (e.innerText || '').trim())
    .find(s => /i certify that i completed/i.test(s));
  return JSON.stringify({ isCertification: /i certify that i completed/i.test(txt) || Boolean(button) });
})()`;

// --- actions ------------------------------------------------------------

export const clickNext = `(() => {
  const b = document.querySelector('#next');
  if (!b) return 'no-next';
  if (/disabled/.test(b.className)) return 'disabled';
  b.click();
  return 'clicked';
})()`;

export const clickPlay = `(() => {
  const b = document.querySelector('#play-pause');
  if (!b) return 'no-play';
  b.click();
  return 'clicked';
})()`;

export const clickModal = (label) => `(() => {
  const b = [...document.querySelectorAll('button')]
    .find(x => x.innerText.trim().toLowerCase() === ${JSON.stringify(label.toLowerCase())}
      && (x.offsetParent || x.getClientRects().length));
  if (!b) return 'gone';
  b.click();
  return 'clicked';
})()`;
