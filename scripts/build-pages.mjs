import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'pages-public');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ['index.html', 'exam.js', 'grading.html', 'grading.js', 'results.html', 'results.js', 'lib.js', 'questions.js', 'rubric.js', 'styles.css']) {
  await cp(path.join(root, 'site', file), path.join(output, file));
}
console.log('Built public exam site only:', output);
