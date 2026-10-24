import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyTraffic, pickOption, scoreOption } from '../src/heuristics.mjs';

const opt = (text) => ({ text, x: 0, y: 0 });

test('prefers the consultative answer over a confidentiality guarantee', () => {
  const { pick } = pickOption([
    opt('"Yes, if you ask for complete confidentiality, HR cannot reveal your name to anyone."'),
    opt('"HR will try to keep your name as private as possible, but they may not be able to guarantee you confidentiality."'),
    opt('"You are not allowed to report anything confidentially."'),
  ]);
  assert.match(pick.text, /keep your name as private as possible/);
});

test('picks the causation answer over the "protect only the victim" distractor', () => {
  const { pick } = pickOption([
    opt('Yes, if Shawn engaged in these behaviors because of Molly’s complaint. A'),
    opt('No, anti-retaliation policies protect only the alleged victim and not a witness like Molly. B'),
    opt('No, Molly did not lose her bonus or receive a poor evaluation. C'),
    opt('No, if Shawn was not found to have committed harassment. D'),
  ]);
  assert.match(pick.text, /because of Molly’s complaint/);
});

test('sends the supervisor to HR before interviewing anyone', () => {
  const { pick } = pickOption([
    opt('Interview Sheila and Everett in depth separately to find out what has been going on, and then contact HR if you find evidence A'),
    opt('Meet with Sheila and Everett together to try to work things out B'),
    opt('Contact HR before speaking with Sheila or Everett C'),
  ]);
  assert.match(pick.text, /Contact HR before speaking/);
});

test('refuses to guess when two options score the same', () => {
  const { pick, ranked } = pickOption([
    opt('Ask your supervisor about it.'),
    opt('Raise it with your supervisor first.'),
  ]);
  assert.equal(pick, null);
  assert.equal(ranked[0].score, ranked[1].score);
});

test('treats hedging as a reason to doubt an option', () => {
  assert.ok(scoreOption('I told you so!') < 0);
  assert.ok(scoreOption('There is no problem with it.') < 0);
  assert.ok(scoreOption('You should contact HR for guidance.') > 0);
});

test('classifies traffic-light subjects', () => {
  assert.equal(classifyTraffic('Is a handshake appropriate at work?'), 2); // green
  assert.equal(classifyTraffic('Is a pat on the back appropriate at work?'), 1); // yellow
  assert.equal(classifyTraffic('Is a lingering back massage appropriate?'), 0); // red
});
