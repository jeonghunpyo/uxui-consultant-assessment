import { ASSESSMENT_VERSION, MAX_ANSWER_LENGTH, QUESTIONS, QUESTION_IDS, RESOURCE_LABELS } from './questions.js';

export const FILE_LIMIT_BYTES = 1024 * 1024;
const SCHEMA_VERSION = 1;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 형식이 올바르지 않습니다.`);
  return value;
}
function text(value, label, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new Error(`${label}${required ? '을(를) 입력해 주세요.' : ' 형식을 확인해 주세요.'} (최대 ${max.toLocaleString('ko-KR')}자)`);
  }
  return value;
}
function date(value, label) {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} 날짜 형식이 올바르지 않습니다.`);
  }
  return new Date(value).toISOString();
}
function assertVersion(doc) {
  if (doc.schemaVersion !== SCHEMA_VERSION) throw new Error('지원하지 않는 파일 형식 버전입니다. 파일을 만든 버전의 사이트에서 열어 주세요.');
}
function normalizeAnswers(value) {
  object(value, '답안');
  return Object.fromEntries(QUESTION_IDS.map((id, i) => [id, text(value[id], `${i + 1}번 답변`, MAX_ANSWER_LENGTH, true)]));
}
export function parseSubmission(value) {
  const doc = object(value, '답안 파일');
  assertVersion(doc);
  if (doc.kind !== 'uxui-submission') throw new Error('UXUI 답안 파일이 아닙니다. 응시 화면에서 다운로드한 JSON 파일을 선택해 주세요.');
  if (doc.assessmentVersion !== ASSESSMENT_VERSION) throw new Error('다른 문항 버전의 답안입니다. 해당 버전의 채점 작업실에서 열어 주세요.');
  if (typeof doc.id !== 'string' || !UUID_PATTERN.test(doc.id)) throw new Error('답안 식별자가 올바르지 않습니다. 원본 파일을 다시 다운로드해 주세요.');
  if (!Object.hasOwn(RESOURCE_LABELS, doc.resourcesUsed)) throw new Error('자료 참고 여부를 선택해 주세요.');
  return {
    kind: 'uxui-submission', schemaVersion: SCHEMA_VERSION, assessmentVersion: ASSESSMENT_VERSION,
    id: doc.id, managerName: text(doc.managerName, '이름', 80, true).trim(),
    assessmentTitle: 'UXUI 상담 진단', questions: QUESTIONS.map(question => ({ ...question })),
    answers: normalizeAnswers(doc.answers), createdAt: date(doc.createdAt, '답안 작성'),
    resourcesUsed: doc.resourcesUsed, resourceNote: text(doc.resourceNote ?? '', '자료 참고 메모', 1000),
  };
}
export function buildSubmission(input) {
  object(input, '답안');
  return parseSubmission({
    ...input, kind: 'uxui-submission', schemaVersion: SCHEMA_VERSION, assessmentVersion: ASSESSMENT_VERSION,
    id: input.id ?? globalThis.crypto.randomUUID(), createdAt: new Date().toISOString(),
    resourceNote: input.resourceNote ?? '',
  });
}
function normalizeGrade(value, final = false) {
  const grade = object(value, '평가');
  object(grade.questions, '문항별 평가');
  const questions = Object.fromEntries(QUESTION_IDS.map((id, i) => {
    const item = object(grade.questions[id], `${i + 1}번 평가`);
    const score = item.score;
    if (!(score === null && !final) && !(Number.isInteger(score) && score >= 0 && score <= 2)) {
      throw new Error(`${i + 1}번 점수를 0·1·2점 중에서 선택해 주세요.`);
    }
    return [id, { score, feedback: text(item.feedback, `${i + 1}번 피드백`, 4000, final) }];
  }));
  return {
    questions,
    strengths: text(grade.strengths, '강점', 4000, final),
    improvements: text(grade.improvements, '보완할 점', 4000, final),
    nextAction: text(grade.nextAction, '다음 실습', 4000, final),
    reviewerName: text(grade.reviewerName ?? '', '평가자 이름', 80),
  };
}
export function buildGradingDraft(submission, grade) {
  return { kind: 'uxui-grading-draft', schemaVersion: SCHEMA_VERSION, submission: parseSubmission(submission), grade: normalizeGrade(grade), updatedAt: new Date().toISOString() };
}
export function buildResult(submission, grade) {
  const now = new Date().toISOString();
  return { kind: 'uxui-result', schemaVersion: SCHEMA_VERSION, submission: parseSubmission(submission), grade: normalizeGrade(grade, true), updatedAt: now, publishedAt: now };
}
export function parseDocument(input) {
  let doc;
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).length > FILE_LIMIT_BYTES) throw new Error('파일이 너무 큽니다. 1MB 이하의 JSON 파일을 선택해 주세요.');
    try { doc = JSON.parse(input); } catch { throw new Error('JSON 파일을 읽을 수 없습니다. 파일 내용을 수정하지 말고 원본 파일을 선택해 주세요.'); }
  } else doc = input;
  object(doc, '파일');
  assertVersion(doc);
  if (doc.kind === 'uxui-submission') return parseSubmission(doc);
  if (doc.kind !== 'uxui-grading-draft' && doc.kind !== 'uxui-result') throw new Error('지원하지 않는 파일입니다. UXUI 답안·채점 초안·결과 JSON만 열 수 있습니다.');
  const result = {
    kind: doc.kind, schemaVersion: SCHEMA_VERSION, submission: parseSubmission(doc.submission),
    grade: normalizeGrade(doc.grade, doc.kind === 'uxui-result'), updatedAt: date(doc.updatedAt, '평가 수정'),
  };
  if (doc.kind === 'uxui-result') result.publishedAt = date(doc.publishedAt, '결과 확정');
  return result;
}
export async function readDocumentFile(file) {
  if (!file || file.size > FILE_LIMIT_BYTES) throw new Error('1MB 이하의 JSON 파일을 선택해 주세요.');
  if (!file.name.toLowerCase().endsWith('.json')) throw new Error('JSON 파일을 선택해 주세요. HTML·TXT 파일은 이 화면에서 불러올 수 없습니다.');
  return parseDocument(await file.text());
}
export function storageGet(key) {
  try { const raw = globalThis.localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function storageSet(key, value) {
  try { globalThis.localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
export function storageRemove(key) {
  try { globalThis.localStorage.removeItem(key); return true; } catch { return false; }
}
export function countAnswered(answers) { return QUESTION_IDS.filter(id => typeof answers?.[id] === 'string' && answers[id].trim()).length; }
export function totalScore(grade) { return QUESTION_IDS.reduce((sum, id) => sum + (grade.questions[id].score ?? 0), 0); }
export function formatDate(iso) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return '—';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}
export function safeFilename(value) {
  return value.normalize('NFC').replace(/[\p{C}<>:"/\\|?*]/gu, '_').replace(/\s+/g, '_').replace(/^\.+|\.+$/g, '').slice(0, 60) || '응시자';
}
export function submissionFilename(submission, extension = 'json') {
  const formats = { json: ['답안', 'json'], txt: ['답안', 'txt'], html: ['답안', 'html'], 'grading-draft.json': ['채점초안', 'json'], 'result.json': ['결과', 'json'], 'result.html': ['결과', 'html'] };
  const [kind, suffix] = Object.hasOwn(formats, extension) ? formats[extension] : formats.json;
  return `UXUI_${kind}_${safeFilename(submission.managerName)}_${submission.id.slice(0, 8)}.${suffix}`;
}
export function downloadText(content, filename, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = safeDownloadName(filename); anchor.hidden = true;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function safeDownloadName(filename) { return filename.replace(/[\p{C}<>:"/\\|?*]/gu, '_').slice(0, 160); }
export function downloadJson(doc, filename) { downloadText(JSON.stringify(doc, null, 2), filename, 'application/json;charset=utf-8'); }
export function toAnswersText(submission) {
  const doc = parseSubmission(submission);
  return [
    'UXUI 상담 진단 · 답안', `이름: ${doc.managerName}`, `문항 버전: ${doc.assessmentVersion}`,
    `답안 ID: ${doc.id}`, `파일 생성: ${formatDate(doc.createdAt)} (한국 시간)`,
    `자료 참고: ${RESOURCE_LABELS[doc.resourcesUsed]}`, `참고 메모: ${doc.resourceNote || '없음'}`,
    '', '이 파일은 서버에 제출된 기록이 아닙니다. 채점 담당자에게 JSON 답안 파일을 직접 전달해 주세요.', '',
    ...QUESTIONS.flatMap((q, i) => [`${i + 1}. ${q.title}`, q.prompt, q.followUp, '', doc.answers[q.id], '', '─'.repeat(32), '']),
  ].join('\n');
}
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
export function exportResultHtml(input) {
  const result = parseDocument(input);
  if (result.kind !== 'uxui-result') throw new Error('확정된 결과만 HTML로 내보낼 수 있습니다.');
  const { submission: s, grade: g } = result;
  const e = escapeHtml;
  const cards = QUESTIONS.map((q, i) => `<section class="question"><div class="question-head"><span class="label">${String(i + 1).padStart(2, '0')} / ${e(q.area)}</span><span class="score">${g.questions[q.id].score} / 2점</span></div><h2>${e(q.title)}</h2><p class="prompt">${e(q.prompt)} ${e(q.followUp)}</p><h3>작성한 답변</h3><div class="answer">${e(s.answers[q.id])}</div><h3>문항별 피드백</h3><div class="feedback">${e(g.questions[q.id].feedback)}</div></section>`).join('\n');
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${e(s.managerName)} · UXUI 상담 진단 결과</title>
<style>
:root{color-scheme:light;--paper:#fff;--ground:#f5f5f4;--ink:#191919;--muted:#626262;--line:#dededb}*{box-sizing:border-box}body{margin:0;background:var(--ground);color:var(--ink);font:16px/1.8 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;padding-inline:20px;padding-block:48px}main{max-width:860px;margin:auto}header{padding-block:20px 36px;border-bottom:2px solid var(--ink)}.label{font:12px/1.6 ui-monospace,monospace;letter-spacing:.08em;color:var(--muted)}h1{font-size:clamp(28px,5vw,42px);line-height:1.3;letter-spacing:-.05em;margin:16px 0}h2{font-size:21px;line-height:1.5;margin:12px 0}h3{font-size:14px;margin:24px 0 8px}.meta,.prompt,footer{font-size:14px;color:var(--muted)}.summary{padding-block:24px;border-bottom:1px solid var(--line)}.summary p{white-space:pre-wrap;overflow-wrap:anywhere}.question{padding-block:30px;border-bottom:1px solid var(--line);break-inside:avoid}.question-head{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}.score{font:600 15px/1.5 ui-monospace,monospace}.answer,.feedback{white-space:pre-wrap;overflow-wrap:anywhere;padding:20px;background:var(--paper);border:1px solid var(--line)}.feedback{border-color:#aaa}.privacy{font-size:13px;border-left:2px solid var(--ink);padding-left:14px;margin-top:24px}footer{padding-block:32px}.meta{overflow-wrap:anywhere}@media print{body{background:#fff;padding-block:0;font-size:11pt}.answer,.feedback{padding:12px}header{padding-top:0}footer{padding-block:16px}.privacy{font-size:9pt}@page{margin:16mm}}
</style></head><body><main><header><span class="label">UXUI / CONSULTANT FIELD NOTES</span><h1>${e(s.managerName)}님의<br>상담 진단 결과</h1><p>종합 점수 <strong>${totalScore(g)} / 10점</strong> · 문항별 0–2점</p><p class="meta">${e(formatDate(result.publishedAt))} (한국 시간) · ${e(g.reviewerName.trim() || '평가자 미기재')}<br>문항 버전 ${e(s.assessmentVersion)} · 답안 ${e(s.id)}</p><p class="privacy">개인 답안과 평가가 포함된 파일입니다. 수신자에게만 직접 전달하고 GitHub·공개 게시판에 올리지 마세요. 이 진단은 내부 학습용이며, 표준화된 역량 시험이나 합격·순위 판정이 아닙니다.</p></header>
<section class="summary"><h2>잘하고 있는 점</h2><p>${e(g.strengths)}</p><h2>보완할 점</h2><p>${e(g.improvements)}</p><h2>다음 상담 전 실습</h2><p>${e(g.nextAction)}</p></section>
${cards}
<footer>자료 참고 여부: ${e(RESOURCE_LABELS[s.resourcesUsed])}${s.resourceNote ? `<br>${e(s.resourceNote)}` : ''}<br>브라우저의 인쇄 메뉴에서 PDF로 저장할 수 있습니다. 이 파일은 인터넷 연결 없이 열리며 외부로 데이터를 전송하지 않습니다.<br>수정 가능한 파일 형식이므로 서명된 성적 증명서로 사용하지 마세요.</footer></main></body></html>`;
}
