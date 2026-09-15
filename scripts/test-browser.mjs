import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { parseDocument } from '../site/lib.js';

// Uses an installed Chrome and CDP pipes. No package downloads, HTTP server, or user profile.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(tmpdir(), 'uxui-browser-check-'));
const downloads = path.join(scratch, 'downloads');
await mkdir(downloads);
const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${path.join(scratch, 'profile')}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
let sequence = 0;
let buffer = '';
const pending = new Map();
const listeners = new Set();
const errors = [];
let diagnostic = '';
chrome.stderr.on('data', data => { diagnostic = (diagnostic + data.toString()).slice(-5000); });
chrome.on('error', error => { for (const item of pending.values()) item.reject(error); });
chrome.on('exit', code => { for (const item of pending.values()) item.reject(new Error(`Chrome exited ${code}: ${diagnostic}`)); });
chrome.stdio[4].on('data', data => {
  buffer += data.toString();
  let delimiter;
  while ((delimiter = buffer.indexOf('\0')) >= 0) {
    const raw = buffer.slice(0, delimiter); buffer = buffer.slice(delimiter + 1);
    if (!raw) continue;
    const message = JSON.parse(raw);
    if (message.id) {
      const item = pending.get(message.id);
      if (!item) continue;
      pending.delete(message.id); clearTimeout(item.timer);
      if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
    } else {
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      for (const listener of listeners) listener(message);
    }
  }
});
function command(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
}
function event(method, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { listeners.delete(listener); reject(new Error(`Event timed out: ${method}`)); }, 15000);
    function listener(message) {
      if (message.method === method && predicate(message.params)) { clearTimeout(timer); listeners.delete(listener); resolve(message.params); }
    }
    listeners.add(listener);
  });
}
let session;
async function evaluate(expression) {
  const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, session);
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
}
async function ready(selector) {
  await evaluate(`new Promise((resolve,reject)=>{const start=Date.now(); const check=()=>{if(document.querySelector(${JSON.stringify(selector)}))return resolve(true);if(Date.now()-start>5000)return reject(new Error('Missing element: '+${JSON.stringify(selector)}));setTimeout(check,25)};check()})`);
}
async function navigate(filename, selector) {
  await command('Page.navigate', { url: pathToFileURL(path.join(root, 'offline', filename)).href }, session);
  await ready(selector);
}
async function setFile(selector, filename) {
  const { root: node } = await command('DOM.getDocument', {}, session);
  const { nodeId } = await command('DOM.querySelector', { nodeId: node.nodeId, selector }, session);
  await command('DOM.setFileInputFiles', { nodeId, files: [filename] }, session);
}
async function downloadBy(expression) {
  const completed = event('Browser.downloadProgress', p => p.state === 'completed');
  await evaluate(expression);
  const info = await completed;
  const files = await readdir(downloads);
  return { info, files };
}

try {
  await command('Browser.getVersion');
  await command('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await command('Target.attachToTarget', { targetId, flatten: true }));
  await command('Page.enable', {}, session);
  await command('Runtime.enable', {}, session);
  await command('DOM.enable', {}, session);
  await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, session);

  await navigate('시험지.html', '#q1-answer');
  await evaluate(`document.querySelector('.action-panel .button').click()`);
  assert.equal(await evaluate('document.activeElement.id'), 'manager-name');
  console.log('PASS: empty exam download validates and focuses name');

  await evaluate(`(() => { const input=document.querySelector('#manager-name'); input.value='브라우저 테스트';input.dispatchEvent(new Event('input',{bubbles:true})); for(let i=1;i<=5;i++){const field=document.querySelector('#q'+i+'-answer'); field.value='실제 응시자가 아닌 기능 검증용 답변 '+i+' <img src=x onerror=alert(1)>';field.dispatchEvent(new Event('input',{bubbles:true}))} })()`);
  const downloaded = await downloadBy(`document.querySelector('.action-panel .button').click()`);
  const answerName = downloaded.files.find(name => name.endsWith('.json'));
  assert.ok(answerName);
  const answerFile = path.join(downloads, answerName);
  const submission = parseDocument(await readFile(answerFile, 'utf8'));
  assert.equal(submission.managerName, '브라우저 테스트');
  console.log('PASS: actual exam JSON download and schema validation');

  await command('Page.reload', {}, session);
  await ready('#q1-answer');
  assert.equal(await evaluate(`document.querySelector('#manager-name').value`), submission.managerName);
  assert.equal(await evaluate(`document.querySelector('#q5-answer').value`), submission.answers.q5);
  console.log('PASS: offline draft survives reload');

  await command('Emulation.setDeviceMetricsOverride', { width: 400, height: 850, deviceScaleFactor: 1, mobile: true }, session);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
  console.log('PASS: exam fits 400px without horizontal overflow');
  await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, session);
  const screenshot = await command('Page.captureScreenshot', { format: 'png' }, session);
  await writeFile(path.join(scratch, 'exam-preview.png'), Buffer.from(screenshot.data, 'base64'));

  await navigate('채점작업실.html', '#document-file');
  await setFile('#document-file', answerFile);
  await ready('#feedback-q1');
  assert.equal(await evaluate(`document.querySelector('#manager-name').textContent`), submission.managerName);
  assert.equal(await evaluate(`document.querySelectorAll('#questions img').length`), 0);
  assert.equal(await evaluate(`document.querySelectorAll('.model-answer').length`), 5);
  assert.match(await evaluate(`document.querySelector('.model-answer').textContent`), /문구 일치 여부가 아니라/);
  assert.match(await evaluate(`document.querySelector('.model-answer .answer-text').textContent`), /프로덕트 디자이너/);
  await evaluate(`document.querySelector('#download-result-html').click()`);
  assert.match(await evaluate(`document.querySelector('#export-status').textContent`), /확인|점수/);
  console.log('PASS: imported answers render safely; incomplete result blocked');

  const draftDownload = await downloadBy(`document.querySelector('#download-draft').click()`);
  assert.ok(draftDownload.files.some(name => name.includes('_채점초안_') && name.endsWith('.json')));
  await evaluate(`(() => { for(let i=1;i<=5;i++){document.querySelector('input[name="score-q'+i+'"][value="2"]').click();const field=document.querySelector('#feedback-q'+i);field.value='검증용 문항 피드백 '+i;field.dispatchEvent(new Event('input',{bubbles:true}))}for(const id of ['strengths','improvements','next-action','reviewer-name']){const field=document.querySelector('#'+id);field.value='검증용 '+id;field.dispatchEvent(new Event('input',{bubbles:true}))} })()`);
  const jsonDownload = await downloadBy(`document.querySelector('#download-result-json').click()`);
  const resultName = jsonDownload.files.find(name => name.includes('_결과_') && name.endsWith('.json'));
  const resultFile = path.join(downloads, resultName);
  const result = parseDocument(await readFile(resultFile, 'utf8'));
  assert.equal(result.grade.questions.q5.score, 2);
  const htmlDownload = await downloadBy(`document.querySelector('#download-result-html').click()`);
  const resultHtmlName = htmlDownload.files.find(name => name.endsWith('.html'));
  assert.ok(resultHtmlName?.includes('_결과_'));
  console.log('PASS: draft, final JSON and independent HTML download');

  await command('Emulation.setDeviceMetricsOverride', { width: 400, height: 850, deviceScaleFactor: 1, mobile: true }, session);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
  console.log('PASS: grading fits 400px without horizontal overflow');

  await navigate('결과확인.html', '#result-file');
  await setFile('#result-file', resultFile);
  await ready('#question-results .question-card');
  assert.equal(await evaluate(`document.querySelector('#total-score').textContent`), '10 / 10점');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
  await setFile('#result-file', answerFile);
  await evaluate(`new Promise(resolve => {const check=()=>{if(document.querySelector('#file-status').textContent.includes('최종 결과'))resolve(true);else setTimeout(check,25)};check()})`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#result-content')).display`), 'none');
  console.log('PASS: viewer displays results and rejects submission files');

  await command('Page.navigate', { url: pathToFileURL(path.join(downloads, resultHtmlName)).href }, session);
  await ready('main h1');
  assert.equal(await evaluate('document.querySelectorAll(".question").length'), 5);
  assert.equal(await evaluate('document.querySelectorAll("script,img").length'), 0);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
  console.log('PASS: shared result HTML opens offline, safely and responsively');
  await navigate('시험지.html', '#q1-answer');
  await evaluate(`Storage.prototype.setItem = () => { throw new Error('storage blocked for test') }`);
  await downloadBy(`document.querySelector('.action-panel .button').click()`);
  assert.match(await evaluate(`document.querySelector('#draft-status').textContent`), /임시저장에는 실패/);
  console.log('PASS: download preserves storage-failure warning');

  await navigate('채점작업실.html', '#document-file');
  await setFile('#document-file', answerFile);
  await ready('#feedback-q1');
  await evaluate(`Storage.prototype.setItem=()=>{throw new Error('storage blocked for test')};const f=document.querySelector('#feedback-q1');f.value='저장 실패시 보존해야 하는 메모';f.dispatchEvent(new Event('input',{bubbles:true}))`);
  await evaluate(`new Promise(resolve=>{const check=()=>{if(document.querySelector('#export-status').textContent.includes('실패'))resolve(true);else setTimeout(check,25)};check()})`);
  const firstDialog = event('Page.javascriptDialogOpening');
  const chooseFile = setFile('#document-file', resultFile);
  await firstDialog;
  const secondDialog = event('Page.javascriptDialogOpening');
  await command('Page.handleJavaScriptDialog', { accept: true }, session);
  const warning = await secondDialog;
  assert.match(warning.message, /임시저장에 실패/);
  await command('Page.handleJavaScriptDialog', { accept: false }, session);
  await chooseFile;
  assert.equal(await evaluate(`document.querySelector('#feedback-q1').value`), '저장 실패시 보존해야 하는 메모');
  console.log('PASS: failed autosave warns again before file switch and preserves work');
  await evaluate(`window.confirm=()=>true;document.querySelector('#clear-work').click()`);
  assert.equal(await evaluate(`document.querySelector('#questions').childElementCount`), 0);
  console.log('PASS: clearing work removes rendered answers and pending state');
  assert.deepEqual(errors, []);
  console.log(`ALL BROWSER CHECKS PASSED. Preview: ${path.join(scratch, 'exam-preview.png')}`);
} finally {
  for (const item of pending.values()) clearTimeout(item.timer);
  chrome.kill('SIGTERM');
  const shutdown = setTimeout(() => { if (chrome.exitCode === null) chrome.kill('SIGKILL'); }, 2000);
  shutdown.unref();
}
