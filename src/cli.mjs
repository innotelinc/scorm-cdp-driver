#!/usr/bin/env node
// CLI entry point.
//
//   scorm-drive targets              list debuggable pages
//   scorm-drive state                report the current slide
//   scorm-drive run                  advance the course
import { appendFileSync, writeFileSync } from 'node:fs';
import { connect, findTarget, listTargets } from './cdp.mjs';
import { contentFrame, evaluate, PROBE, DEFAULT_CONTENT_FRAME } from './player.mjs';
import { runDriver, EXIT } from './driver.mjs';

const USAGE = `scorm-drive — advance a SCORM player through an existing Chrome session

Usage
  scorm-drive <targets|state|run> [options]

Options
  --endpoint <url>    CDP endpoint            (default: http://127.0.0.1:9222)
  --match <text>      URL substring of the tab to drive (default: litmos)
  --frame <regex>     content-frame URL pattern (default: ${DEFAULT_CONTENT_FRAME.source})
  --seconds <n>       stop after n seconds; 0 = run until it finishes (default: 0)
  --tick <ms>         poll interval           (default: 2000)
  --no-answer         never answer checks; stop when one blocks
  --log <path>        also append the event log to a file
  -h, --help
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '-h' || token === '--help') {
      args.help = true;
    } else if (token === '--no-answer') {
      args.answer = false;
    } else if (token.startsWith('--')) {
      const key = token.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = value;
        i += 1;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function makeLogger(path) {
  if (!path) return (line) => console.log(`[${new Date().toISOString()}] ${line}`);
  writeFileSync(path, '');
  return (line) => {
    const record = `[${new Date().toISOString()}] ${line}`;
    appendFileSync(path, `${record}\n`);
    console.log(record);
  };
}

// A missing endpoint is the most common first-run failure, so report it plainly
// instead of surfacing "fetch failed".
async function probeEndpoint(endpoint) {
  try {
    const res = await fetch(`${endpoint}/json/version`);
    return await res.json();
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return EXIT.DONE;
  }

  const command = args._[0] ?? 'run';
  const endpoint = args.endpoint ?? process.env.CDP_URL ?? 'http://127.0.0.1:9222';
  const match = args.match ?? 'litmos';
  const framePattern = args.frame ? new RegExp(args.frame) : DEFAULT_CONTENT_FRAME;

  const browser = await probeEndpoint(endpoint);
  if (!browser) {
    console.error(`cannot reach a Chrome DevTools endpoint at ${endpoint}`);
    console.error('\nStart a browser with a debugging port first, for example:');
    console.error('  chrome --remote-debugging-port=9222');
    return EXIT.BLOCKED;
  }
  console.log(`browser: ${browser.Browser}`);

  if (command === 'targets') {
    const pages = await listTargets(endpoint);
    if (!pages.length) console.log('no page targets');
    for (const page of pages) console.log(`${page.id}\n  ${page.title}\n  ${page.url}`);
    return EXIT.DONE;
  }

  const target = await findTarget(endpoint, match);
  if (!target) {
    console.error(`no page matching "${match}" at ${endpoint}`);
    console.error('start Chrome with --remote-debugging-port=9222 and open the course.');
    return EXIT.BLOCKED;
  }

  const cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  if (command === 'state') {
    const frame = await contentFrame(cdp, framePattern);
    if (!frame) {
      console.error('no content frame found — is the course player loaded?');
      return EXIT.BLOCKED;
    }
    console.log(JSON.stringify(JSON.parse(await evaluate(cdp, frame.id, PROBE)), null, 2));
    cdp.close();
    return EXIT.DONE;
  }

  if (command !== 'run') {
    console.error(`unknown command "${command}"\n`);
    console.log(USAGE);
    return EXIT.BLOCKED;
  }

  console.log(`driving: ${target.title}\n         ${target.url}`);
  const result = await runDriver(cdp, {
    framePattern,
    tick: Number(args.tick ?? 2000),
    seconds: Number(args.seconds ?? 0),
    autoAnswer: args.answer !== false,
    log: makeLogger(args.log),
  });
  cdp.close();

  if (result.code === EXIT.ATTESTATION) {
    console.log('\nLeft for you: certify completion in the player, then finish the last slide.');
  } else if (result.code === EXIT.BLOCKED) {
    console.log('\nStopped where it needs a human. Re-run once you have cleared it.');
  }
  return result.code;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
