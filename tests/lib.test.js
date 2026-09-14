import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSubmission, buildGradingDraft, buildResult, parseDocument, readDocumentFile, exportResultHtml, escapeHtml, submissionFilename, safeFilename, toAnswersText, totalScore, storageGet, storageSet, storageRemove, countAnswered, FILE_LIMIT_BYTES } from '../site/lib.js';
import { QUESTIONS, emptyAnswers, emptyGrade } from '../site/questions.js';

function submission(overrides = {}) {
  return buildSubmission({ managerName: '테스트 응시자', answers: Object.fromEntries(QUESTIONS.map(q => [q.id, `연습용 답변: ${q.area}`])), resourcesUsed: 'none', resourceNote: '', ...overrides });
}
function completeGrade() {
  const grade = emptyGrade();
  for (const q of QUESTIONS) grade.questions[q.id] = { score: 2, feedback: '테스트용 피드백입니다.' };
  return { ...grade, strengths: '강점 예시', improvements: '보완 예시', nextAction: '다음 실습 예시', reviewerName: '테스트 채점자' };
}

test('완전한 답안 JSON을 정규화하고 재열기한다', () => {
  const doc = submission();
  assert.deepEqual(parseDocument(JSON.stringify(doc)), doc);
  assert.equal(doc.managerName, '테스트 응시자');
  assert.match(doc.id, /^[\da-f-]{36}$/);
});
test('동일 초안 재다운로드는 ID를 유지한다', () => {
  const first = submission();
  assert.equal(submission({ id: first.id }).id, first.id);
});
test('이름과 모든 답변이 필수다', () => {
  assert.throws(() => submission({ managerName: '   ' }), /이름/);
  assert.throws(() => submission({ answers: emptyAnswers() }), /1번 답변/);
  assert.throws(() => submission({ answers: { ...submission().answers, q5: '\n ' } }), /5번 답변/);
});
test('입력 길이와 참고 여부를 검증한다', () => {
  assert.throws(() => submission({ managerName: '가'.repeat(81) }), /이름/);
  assert.throws(() => submission({ answers: { ...submission().answers, q1: 'a'.repeat(6001) } }), /1번 답변/);
  assert.throws(() => submission({ resourcesUsed: '__proto__' }), /참고 여부/);
});
test('외부 파일 종류, 스키마, 문항 버전 및 ID를 검증한다', () => {
  const doc = submission();
  for (const patch of [{ schemaVersion: 2 }, { assessmentVersion: 'old' }, { kind: 'other' }, { id: 'uxui-invalid' }]) {
    assert.throws(() => parseDocument({ ...doc, ...patch }));
  }
  assert.throws(() => parseDocument(null));
  assert.throws(() => parseDocument('not json'), /JSON/);
  assert.throws(() => parseDocument({ ...doc, createdAt: 'invalid' }), /날짜/);
});
test('불필요한 파일 필드와 사용자 제공 질문은 받아들이지 않는다', () => {
  const doc = submission();
  const clean = parseDocument({ ...doc, secret: 'x', prompts: '잘못된 문항', answers: { ...doc.answers, q6: 'x' } });
  assert.equal(clean.secret, undefined);
  assert.equal(clean.prompts, undefined);
  assert.equal(clean.answers.q6, undefined);
});
test('미채점 상태는 초안에 저장할 수 있으나 결과를 만들 수 없다', () => {
  const doc = submission();
  const draft = buildGradingDraft(doc, emptyGrade());
  assert.equal(draft.grade.questions.q1.score, null);
  assert.deepEqual(parseDocument(draft), draft);
  assert.throws(() => buildResult(doc, emptyGrade()), /1번 점수/);
});
test('0점은 유효하며 문자 숫자, 소수, 범위 밖 점수는 거부한다', () => {
  const doc = submission();
  const grade = completeGrade();
  grade.questions.q1.score = 0;
  assert.equal(totalScore(buildResult(doc, grade).grade), 8);
  for (const score of ['2', true, 0.5, 3, -1, undefined]) {
    assert.throws(() => buildGradingDraft(doc, { ...grade, questions: { ...grade.questions, q1: { score, feedback: '예시' } } }));
  }
});
test('결과에는 문항 피드백과 종합 피드백이 필수다', () => {
  const doc = submission();
  for (const field of ['strengths', 'improvements', 'nextAction']) assert.throws(() => buildResult(doc, { ...completeGrade(), [field]: ' ' }));
  const grade = completeGrade();
  grade.questions.q3.feedback = '';
  assert.throws(() => buildResult(doc, grade), /3번 피드백/);
});
test('완성 결과를 재열어도 값이 유지된다', () => {
  const result = buildResult(submission(), completeGrade());
  assert.deepEqual(parseDocument(JSON.stringify(result)), result);
  assert.equal(totalScore(result.grade), 10);
});
test('대용량 파일과 JSON 아닌 파일을 거부한다', async () => {
  await assert.rejects(readDocumentFile({ name: 'big.json', size: FILE_LIMIT_BYTES + 1 }), /1MB/);
  await assert.rejects(readDocumentFile({ name: 'bad.html', size: 10 }), /JSON/);
  assert.throws(() => parseDocument('a'.repeat(FILE_LIMIT_BYTES + 1)), /너무 큽니다/);
  const doc = submission();
  assert.deepEqual(await readDocumentFile({ name: 'answer.JSON', size: 100, text: async () => JSON.stringify(doc) }), doc);
});
test('결과 HTML은 입력 HTML과 스크립트를 실행하지 않는다', () => {
  const payload = '<script>alert("x")</script><img src=x onerror=alert(1)>';
  const doc = submission({ managerName: '<img src=x>', answers: Object.fromEntries(QUESTIONS.map(q => [q.id, payload])) });
  const result = buildResult(doc, { ...completeGrade(), strengths: payload });
  const html = exportResultHtml(result);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img '));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(!/\b(?:src|href)="https?:/i.test(html));
  assert.ok(html.includes('10 / 10점'));
  assert.throws(() => exportResultHtml(buildGradingDraft(doc, emptyGrade())), /확정된 결과/);
});
test('파일명은 경로와 제어문자를 제거하고 각 파일 용도를 구분한다', () => {
  assert.equal(safeFilename('../a\\b\n'), '_a_b_');
  const doc = submission();
  assert.match(submissionFilename(doc, 'json'), /\.json$/);
  assert.match(submissionFilename(doc, 'txt'), /\.txt$/);
  assert.match(submissionFilename(doc, 'result.html'), /_결과_.*\.html$/);
  assert.match(submissionFilename(doc, 'result.json'), /_결과_.*\.json$/);
  assert.match(submissionFilename(doc, 'grading-draft.json'), /_채점초안_.*\.json$/);
  assert.notEqual(submissionFilename(doc), submissionFilename(doc, 'grading-draft.json'));
});
test('텍스트 답안에는 질문과 답변 및 파일 전달 안내가 포함된다', () => {
  const doc = submission();
  const txt = toAnswersText(doc);
  for (const q of QUESTIONS) { assert.ok(txt.includes(q.title)); assert.ok(txt.includes(doc.answers[q.id])); }
  assert.ok(txt.includes('서버에 제출된 기록이 아닙니다'));
  assert.equal(countAnswered({ q1: ' yes ', q2: ' ' }), 1);
  assert.equal(escapeHtml('<&"\''), '&lt;&amp;&quot;&#39;');
});
test('저장소가 차단되어도 예외 없이 동작한다', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
  try {
    assert.equal(storageGet('x'), null);
    assert.equal(storageSet('x', {}), false);
    assert.equal(storageRemove('x'), false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});
