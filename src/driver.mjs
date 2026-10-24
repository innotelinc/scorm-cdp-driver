// The advance loop. Presses NEXT only once a slide's narration has finished,
// clears the gates that block progress, and stops on anything that is a
// statement about the person rather than about the course.
import {
  CERTIFICATION,
  GATE,
  OPTIONS,
  PROBE,
  TRAFFIC,
  VERDICT,
  clickAt,
  clickModal,
  clickNext,
  clickPlay,
  contentFrame,
  evaluate,
} from './player.mjs';
import { classifyTraffic, pickOption } from './heuristics.mjs';

export const EXIT = {
  DONE: 0,
  BLOCKED: 2,
  ATTESTATION: 3,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runDriver(cdp, options = {}) {
  const {
    framePattern,
    tick = 2000,
    seconds = 0,
    autoAnswer = true,
    log = () => {},
  } = options;

  const deadline = seconds > 0 ? Date.now() + seconds * 1000 : 0;
  let sameSlideTicks = 0;
  let lastCounter;
  let blockedSignature = '';
  let blockedStrikes = 0;

  if (deadline === 0) log('running with no time limit — Ctrl+C to stop');

  while (true) {
    if (deadline && Date.now() > deadline) {
      log('stopped: time budget reached');
      return { code: EXIT.DONE, reason: 'time-budget' };
    }

    try {
      const frame = await contentFrame(cdp, framePattern);
      if (!frame) {
        log('no content frame yet (module transition?) — waiting');
        await sleep(tick);
        continue;
      }

      const state = JSON.parse(await evaluate(cdp, frame.id, PROBE));

      if (state.counter !== lastCounter) {
        lastCounter = state.counter;
        sameSlideTicks = 0;
        log(`SLIDE ${state.counter ?? '?'} | ${state.head}`);
      } else {
        sameSlideTicks += 1;
      }

      // 1. Resume / Restart dialog after a reload.
      if (state.modal.length) {
        const choice = state.modal.includes('Resume') ? 'Resume' : state.modal[0];
        const result = await evaluate(cdp, frame.id, clickModal(choice));
        log(`MODAL ${state.modal.join('/')} -> ${choice} (${result})`);
        await sleep(1200);
        continue;
      }

      const narrationFinished =
        state.timeline && state.timeline.value >= state.timeline.max - 150;

      // 2. Attestation gate. Checked before NEXT because some players leave the
      //    button enabled here, so nagging it would just spin forever.
      if (narrationFinished) {
        const certification = JSON.parse(await evaluate(cdp, frame.id, CERTIFICATION));
        if (certification.isCertification) {
          log('STOPPED at attestation: "I certify that I completed this training myself."');
          log('That statement is about a person, not a course — it is not clickable by a driver.');
          return { code: EXIT.ATTESTATION, reason: 'attestation' };
        }
      }

      // 3. Narration finished and the player offers the next slide.
      if (narrationFinished && !state.nextDisabled) {
        const result = await evaluate(cdp, frame.id, clickNext);
        log(`NEXT ${state.counter ?? '?'} (${result})`);
        blockedSignature = '';
        await sleep(1500);
        continue;
      }

      // 4. Playback stalled mid-slide with no audio to wait for: nudge it.
      if (
        state.timeline &&
        !narrationFinished &&
        state.audioAny === 0 &&
        state.audioPlaying === 0 &&
        sameSlideTicks >= 3
      ) {
        await evaluate(cdp, frame.id, clickPlay);
        log(`PLAY nudge ${state.counter ?? '?'} ${state.timeline.value}/${state.timeline.max}`);
      }

      // 5. Blocked on an interaction that NEXT is gated behind.
      if (narrationFinished && state.nextDisabled && sameSlideTicks >= 2) {
        const signature = `${state.counter}${state.tail}`;
        if (signature !== blockedSignature) {
          // First sighting: wait one tick, in case the player is mid-transition.
          blockedSignature = signature;
          blockedStrikes = 1;
          log(`NEEDS_INPUT ${state.counter ?? '?'} | ${state.head}`);
        } else {
          blockedStrikes += 1;
        }

        if (blockedStrikes >= 2) {
          const outcome = await clearBlocker(cdp, frame, state, { autoAnswer, log });
          if (outcome === 'handled') {
            blockedStrikes = 0;
            await sleep(2500);
            continue;
          }
          log(`BLOCKED ${state.counter ?? '?'} | ${state.head} — needs a human`);
          return { code: EXIT.BLOCKED, reason: 'blocked' };
        }
      } else {
        blockedStrikes = 0;
      }
    } catch (error) {
      const message = String(error?.message ?? error);
      log(`ERR ${message.slice(0, 160)}`);
      if (/Target closed|Session closed|not attached/i.test(message)) {
        log('target went away — the tab was probably closed or navigated');
        return { code: EXIT.BLOCKED, reason: 'target-closed' };
      }
    }

    await sleep(tick);
  }
}

// Tries, in order: the "View Policy" gate, a traffic-light check, then a
// multiple-choice check. Returns 'handled' if it did something.
async function clearBlocker(cdp, frame, state, { autoAnswer, log }) {
  const where = state.counter ?? '?';

  try {
    const gate = await evaluate(cdp, frame.id, GATE);
    if (gate) {
      const target = JSON.parse(gate);
      const at = await clickAt(cdp, target.x, target.y);
      log(`GATE ${where} -> "${target.text.slice(0, 40)}" @${at.join(',')}`);
      return 'handled';
    }

    const traffic = JSON.parse(await evaluate(cdp, frame.id, TRAFFIC));
    if (traffic.isTraffic) {
      const index = classifyTraffic(traffic.question);
      const lamp = traffic.lamps[index];
      const at = await clickAt(cdp, lamp.x, lamp.y);
      log(
        `TRAFFIC ${where} -> ${['Red', 'Yellow', 'Green'][index]} @${at.join(',')} | ${traffic.question.slice(0, 60)}`,
      );
      return 'handled';
    }

    if (!autoAnswer) return 'unhandled';

    const options = JSON.parse(await evaluate(cdp, frame.id, OPTIONS));
    if (options.length < 3) return 'unhandled';

    const { pick, ranked } = pickOption(options);
    if (!pick) {
      log(`UNDECIDED ${where} ranked=${ranked.map((r) => `${r.score}:${r.text.slice(0, 40)}`).join(' | ')}`);
      return 'unhandled';
    }

    const at = await clickAt(cdp, pick.x, pick.y);
    log(`ANSWER ${where} score=${pick.score} -> "${pick.text.slice(0, 70)}" @${at.join(',')}`);

    await new Promise((r) => setTimeout(r, 1200));
    const verdict = await evaluate(cdp, frame.id, VERDICT);
    if (verdict) log(`VERDICT ${where} ${verdict}`);

    return 'handled';
  } catch (error) {
    log(`ANSWER_ERR ${String(error?.message ?? error).slice(0, 120)}`);
    return 'unhandled';
  }
}
