# scorm-cdp-driver

[![CI](https://github.com/innotelinc/scorm-cdp-driver/actions/workflows/ci.yml/badge.svg)](https://github.com/innotelinc/scorm-cdp-driver/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)


Advance a SCORM e-learning player running in a Chrome tab you already have open.

It drives the player over the Chrome DevTools Protocol, presses **Next only when
a slide's narration has actually finished**, clears the gates that block
progress (policy links, traffic-light checks, multiple-choice knowledge checks),
and **stops at the attestation** that asks the learner to certify they completed
the course themselves.

Zero dependencies. Node 22+.

## Why scorm-cdp-driver

| Problem | Answer |
| --- | --- |
| Synthetic clicks are ignored by the player. | Real CDP input events at real coordinates, translated through nested iframes. |
| Next is gated on the narration timeline. | The driver waits for the timeline to finish rather than clicking early. |
| Policy links and knowledge checks block progress. | The known gates are cleared, and the attestation is deliberately left to the learner. |

Its place in the stack is [docs/stack.md](docs/stack.md); the canonical
definition of the shared layers is the
[Innotel Platform Stack](https://github.com/innotelinc/innotel-platform-stack).

## Why this shape

Most of the difficulty is not clicking. It is that these players:

- **ignore synthetic clicks.** `element.click()` and hand-dispatched
  `MouseEvent`s do nothing. Every interaction has to be a real CDP input event at
  real coordinates, which means translating coordinates through nested iframes.
- **put the slide in a cross-origin iframe**, often two levels deep
  (`page → scorm-wrapper.html → index_lms.html`), so a script in the top frame
  cannot reach the slide DOM at all.
- **gate Next behind the timeline**, so clicking early skips the narration.

This driver attaches to a browser you control, so it uses your existing signed-in
session rather than replaying a login.

## Requirements

- Chrome (or any Chromium) started with a debugging port:

  ```sh
  chrome --remote-debugging-port=9222
  ```

- The course open in a tab, loaded to the player.

## Usage

```sh
node src/cli.mjs targets        # list debuggable pages
node src/cli.mjs state          # report the current slide
node src/cli.mjs run            # advance until it finishes or needs a human
```

Options:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--endpoint <url>` | `http://127.0.0.1:9222` | CDP endpoint (or `CDP_URL`) |
| `--match <text>` | `litmos` | URL substring of the tab to drive |
| `--frame <regex>` | `cdn\d*\.litmos\.com` | content-frame URL pattern |
| `--seconds <n>` | `0` | stop after n seconds; 0 runs until finished |
| `--tick <ms>` | `2000` | poll interval |
| `--no-answer` | off | never answer checks; stop when one blocks |
| `--log <path>` | none | also append the event log to a file |

Exit codes: `0` finished or timed out, `2` blocked and needs a human, `3` stopped
at the attestation.

## How it decides to advance

Each tick it reads the slide state and:

1. **Resumes** a Resume/Restart dialog left by a reload.
2. **Refuses to certify.** If the slide carries the "I certify that I completed
   this training myself" statement, it stops (exit 3). That sentence is a claim
   about a person, so a driver clicking it would be making a false statement.
   Checked *before* Next, because some players leave Next enabled on that slide.
3. **Advances** only once `timeline.value >= timeline.max`, so narration is never
   skipped.
4. **Nudges playback** when a slide stalls with no audio to wait for.
5. **Clears a blocker**, in this order: a "View Policy" gate, a traffic-light
   check, then a multiple-choice check.

## About the answer heuristics

`src/heuristics.mjs` scores each option's wording and picks the most
consultative one (raise it with HR or a supervisor, "could constitute", "if it
would reasonably offend"), down-weighting absolutes ("definitely", "never",
"free speech", "no problem"). Traffic lights are classified by subject matter:
formal greetings are green, ambiguous personal contact is yellow, lingering or
sexual contact is red.

**These are a best guess, not an answer key.** They were tuned against one
course and will be wrong on some questions. To keep the guesses honest, every
answer is checked against the player's own accessibility feedback (which mirrors
"correct" / "incorrect … the correct answer is …") and the verdict is logged, so
you can see exactly which guesses landed.

Use `--no-answer` if you would rather answer everything yourself and only have
the slides advanced for you.

## Limits

- Selectors target the markup this was built against (the `cs-*` player used by
  Litmos/Storyline exports). Different player builds will need different
  selectors; `state` is the fastest way to check whether they still match.
- Drag-and-drop and map/list exercises are not automated — the driver reports
  `BLOCKED` and hands them back.
- If the tab is closed or navigated away mid-run, the driver stops rather than
  reattaching.

## A word on use

This automates the mechanical part of a course: advancing slides, opening
policies, clearing comprehension checks. It deliberately does not sign, certify,
or attest anything on the learner's behalf, and it cannot make a completion
record truthful. Whether completing a given course this way is acceptable is a
question for the organisation that assigned it — many compliance trainings
require the learner to actually engage with the material, and the record is
usually relied on as evidence that they did.

## License

MIT — see [LICENSE](LICENSE). Copyright © 2026 Innotel Inc. Upstream material,
where a directory carries its own licence, remains under that licence.
