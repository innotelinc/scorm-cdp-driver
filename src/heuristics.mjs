// Answer heuristics for multiple-choice and traffic-light knowledge checks.
//
// These are deliberately simple: they score an option's wording and pick the
// most "professional / consultative" one. They are a best guess, not a key.
// The course's own feedback (see VERDICT in player.mjs) is used to record
// whether a guess turned out right.

const POSITIVE = [
  [/\bHR\b/i, 5],
  [/supervisor|manager/i, 5],
  [/guidance/i, 3],
  [/talk (to|with)/i, 3],
  [/reasonably offend/i, 5],
  [/can impose discipline/i, 4],
  [/could be considered/i, 3],
  [/consult/i, 3],
  [/could contribute/i, 3],
  [/have to report|should report/i, 2],
  [/because of/i, 3],
  [/^\W*yes,? if/i, 3],
  [/engaged in these behaviors/i, 1],
  [/^\W*yes,? even though/i, 4],
  [/don.t supervise/i, 2],
  [/contact HR before/i, 3],
  [/^\W*yes,? it would be considered/i, 4],
  [/it would be considered discrimination/i, 2],
  [/cannot discriminate against/i, 4],
  [/interfere with .*job performance/i, 4],
  [/^\W*yes,? as it does not seem/i, 3],
  [/^\W*yes,? both/i, 5],
  [/can.t order people|cannot order people/i, 4],
  [/could constitute/i, 4],
  [/against both/i, 3],
  [/may constitute/i, 4],
  [/intentionally and repeatedly/i, 5],
  [/could contribute to an unlawful/i, 4],
  // "we try, but cannot guarantee" beats a promise of absolute confidentiality
  [/as private as possible/i, 4],
];

const NEGATIVE = [
  [/definitely/i, -6],
  [/not allowed/i, -4],
  [/free speech/i, -5],
  [/cannot harass/i, -5],
  [/i told you so/i, -6],
  [/no problem/i, -5],
  [/just sending/i, -4],
  [/don't have to/i, -4],
  [/only if/i, -3],
  [/not sexual/i, -5],
  [/same performance/i, -5],
  [/ignore/i, -4],
  [/never/i, -3],
  [/always/i, -2],
  [/nobody/i, -4],
  [/no big deal/i, -4],
  [/keep it to yourself/i, -6],
  [/don.t want any/i, -6],
  [/just report/i, -3],
  [/can never|cannot reveal|will never/i, -5],
  [/not allowed to report/i, -6],
  [/guarantee/i, -3],
  [/has joked|joked around/i, -4],
  [/protect only/i, -5],
  [/not found to have/i, -4],
  [/did not lose/i, -3],
  [/customers are offended/i, -4],
  [/not a member of a traditional/i, -4],
  [/previously identified as/i, -4],
  [/depends on what state/i, -3],
];

export function scoreOption(text) {
  let score = 0;
  for (const [re, weight] of POSITIVE) if (re.test(text)) score += weight;
  for (const [re, weight] of NEGATIVE) if (re.test(text)) score += weight;
  return score;
}

// Returns the winning option only when it beats the runner-up clearly.
// A tie means the heuristic has no opinion, so the caller should stop.
export function pickOption(options) {
  const ranked = options
    .map((o) => ({ ...o, score: scoreOption(o.text) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const runnerUp = ranked[1];
  if (!best || best.score <= 0) return { pick: null, ranked };

  const decisive = best.score > (runnerUp?.score ?? -Infinity) + 1;
  return { pick: decisive ? best : null, ranked };
}

// Traffic light: 0 = Red (never), 1 = Yellow (sometimes), 2 = Green (always).
export function classifyTraffic(question) {
  if (/handshake|hand shake|high[- ]?five|fist bump/i.test(question)) return 2;
  if (/rub|massage|kiss|caress|hair|thigh|waist|butt|grope|lingering|crawl/i.test(question)) return 0;
  return 1;
}
