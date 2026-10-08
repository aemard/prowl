// Prints one prd.json story so a Ralph iteration never has to read the whole file, and records
// the result. Usage:
//   node scripts/ralph/story.mjs              the next eligible story (lowest priority, not
//                                             passing, every dependency passing)
//   node scripts/ralph/story.mjs US-037       that story
//   node scripts/ralph/story.mjs pass US-037 "one-line notes"
//   node scripts/ralph/story.mjs fail US-037 "why a criterion is not met"
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve(import.meta.dirname, '../../prd.json');
const prd = JSON.parse(readFileSync(file, 'utf8'));
const stories = prd.userStories;
const byId = (id) => stories.find((s) => s.id === id) ?? fail(`No story ${id}`);
function fail(message) {
  console.error(message);
  process.exit(1);
}

const [command, id, notes] = process.argv.slice(2);
if (command === 'pass' || command === 'fail') {
  if (!notes) fail('Notes are required');
  Object.assign(byId(id), { passes: command === 'pass', notes });
  writeFileSync(file, `${JSON.stringify(prd, null, 2)}\n`);
  console.log(`${id} passes: ${command === 'pass'} (run pnpm lint:fix to reformat prd.json)`);
} else {
  const passing = new Set(stories.filter((s) => s.passes).map((s) => s.id));
  const story = command
    ? byId(command)
    : stories
        .filter((s) => !s.passes && s.dependsOn.every((d) => passing.has(d)))
        .sort((a, b) => a.priority - b.priority)[0];
  if (!story) fail('No eligible story: every story passes or waits on a dependency.');
  console.log(JSON.stringify(story, null, 2));
}
