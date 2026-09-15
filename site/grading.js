import { QUESTIONS, RESOURCE_LABELS, emptyGrade } from './questions.js';
import {
  readDocumentFile,
  buildGradingDraft,
  buildResult,
  downloadJson,
  downloadText,
  exportResultHtml,
  submissionFilename,
  storageGet,
  storageSet,
  storageRemove,
  parseDocument,
  formatDate,
  totalScore
} from './lib.js';
import { rubricFor, RUBRIC_GUIDANCE } from './rubric.js';

const $ = (selector) => document.querySelector(selector);
const fileInput = $('#document-file');
const workspace = $('#workspace');
const questionContainer = $('#questions');
const fileStatus = $('#file-status');
const exportStatus = $('#export-status');
const restoreChoice = $('#restore-choice');
const clearButton = $('#clear-work');

let submission = null;
let grade = emptyGrade();
let importedKind = null;
let pendingLocalDraft = null;
let saveTimer = null;
let hasWork = false;
let hasUnsavedChanges = false;
let isOpeningFile = false;

function draftKey(id) {
  return `uxui-grading-draft:${id}`;
}

function setStatus(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle('error', isError);
}

function normalizeGrade(candidate) {
  const fresh = emptyGrade();
  if (!candidate || typeof candidate !== 'object') return fresh;
  QUESTIONS.forEach((question) => {
    const source = candidate.questions?.[question.id];
    if (source && typeof source === 'object') {
      fresh.questions[question.id].score = [0, 1, 2].includes(source.score) ? source.score : null;
      fresh.questions[question.id].feedback = typeof source.feedback === 'string' ? source.feedback : '';
    }
  });
  ['strengths', 'improvements', 'nextAction', 'reviewerName'].forEach((field) => {
    fresh[field] = typeof candidate[field] === 'string' ? candidate[field] : '';
  });
  return fresh;
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function buildQuestionCards() {
  questionContainer.replaceChildren();
  QUESTIONS.forEach((question, index) => {
    const card = createElement('article', 'question-card');
    card.dataset.questionId = question.id;

    const header = document.createElement('header');
    const heading = createElement('h2', null, `${index + 1}. ${question.title}`);
    const meta = createElement('p', 'question-meta', question.area);
    header.append(heading, meta);

    const prompt = createElement('p', 'question-copy', question.prompt);
    const followUp = createElement('p', 'muted question-copy', question.followUp);
    const answerHeading = createElement('h3', 'field-label', '제출 답안');
    const answer = createElement('div', 'answer-text', submission.answers[question.id] || '답안이 작성되지 않았습니다.');

    const rubric = rubricFor(question.id);
    const modelAnswer = document.createElement('details');
    modelAnswer.className = 'model-answer';
    const modelSummary = createElement('summary', null, '참고 답안 보기');
    const modelLead = createElement('p', 'muted', '문구 일치 여부가 아니라 설명의 방향과 빠진 요소를 비교하는 참고 자료입니다.');
    const modelText = createElement('div', 'answer-text', rubric?.modelAnswer || '등록된 참고 답안이 없습니다.');
    modelAnswer.append(modelSummary, modelLead, modelText);

    const details = document.createElement('details');
    const summary = createElement('summary', null, '평가기준 보기');
    details.append(summary);
    if (rubric) {
      const source = createElement('p', 'muted', `기준 근거: ${rubric.source}`);
      const list = createElement('ol', 'rubric-list');
      rubric.criteria.slice().sort((a, b) => b.score - a.score).forEach((criterion) => {
        const item = document.createElement('li');
        const strong = createElement('strong', null, `${criterion.score}점. `);
        item.append(strong, document.createTextNode(criterion.text));
        list.append(item);
      });
      const guidance = createElement('p', 'muted rubric-text', `판정 안내: ${RUBRIC_GUIDANCE}`);
      details.append(source, list, guidance);
    }

    const scoreGroup = createElement('fieldset', 'score-options');
    const legend = createElement('legend', 'field-label', '점수');
    scoreGroup.append(legend);
    [0, 1, 2].forEach((value) => {
      const label = createElement('label', 'score-option');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `score-${question.id}`;
      radio.value = String(value);
      radio.checked = grade.questions[question.id].score === value;
      radio.addEventListener('change', () => {
        grade.questions[question.id].score = value;
        updateScore();
        scheduleSave();
      });
      label.append(radio, document.createTextNode(`${value}점`));
      scoreGroup.append(label);
    });

    const feedbackField = createElement('div', 'field');
    const feedbackLabel = createElement('label', 'field-label', '문항 피드백');
    feedbackLabel.htmlFor = `feedback-${question.id}`;
    const feedback = document.createElement('textarea');
    feedback.className = 'textarea feedback';
    feedback.id = `feedback-${question.id}`;
    feedback.rows = 4;
    feedback.maxLength = 4000;
    feedback.placeholder = '답안에서 잘 드러난 점과 보완할 점을 기록하세요.';
    feedback.value = grade.questions[question.id].feedback;
    feedback.addEventListener('input', () => {
      grade.questions[question.id].feedback = feedback.value;
      scheduleSave();
    });
    feedbackField.append(feedbackLabel, feedback);

    card.append(header, prompt, followUp, answerHeading, answer, modelAnswer, details, scoreGroup, feedbackField);
    questionContainer.append(card);
  });
}

function syncSummaryFields() {
  $('#strengths').value = grade.strengths;
  $('#improvements').value = grade.improvements;
  $('#next-action').value = grade.nextAction;
  $('#reviewer-name').value = grade.reviewerName;
}

function updateScore() {
  const gradedCount = QUESTIONS.filter((question) => grade.questions[question.id].score !== null).length;
  $('#score-total').textContent = `현재 ${totalScore(grade)} / 10점 (${gradedCount}/5문항 채점)`;
}

function renderWorkspace() {
  $('#manager-name').textContent = submission.managerName || '이름 없음';
  $('#submission-id').textContent = submission.id;
  $('#submission-date').textContent = formatDate(submission.createdAt);
  $('#resource-used').textContent = RESOURCE_LABELS[submission.resourcesUsed] || '기록 없음';
  $('#resource-note').textContent = submission.resourceNote || '';
  buildQuestionCards();
  syncSummaryFields();
  updateScore();
  workspace.classList.remove('hidden');
  clearButton.disabled = false;
}

function workFromDocument(documentData) {
  if (documentData.kind === 'uxui-submission') {
    return { submission: documentData, grade: emptyGrade(), kind: documentData.kind };
  }
  if (documentData.kind === 'uxui-grading-draft' || documentData.kind === 'uxui-result') {
    return { submission: documentData.submission, grade: normalizeGrade(documentData.grade), kind: documentData.kind };
  }
  throw new Error('지원자 제출, 채점 초안, 또는 결과 파일만 열 수 있습니다.');
}

function useWork(work, sourceMessage) {
  submission = work.submission;
  grade = normalizeGrade(work.grade);
  importedKind = work.kind;
  hasUnsavedChanges = false;
  pendingLocalDraft = null;
  hasWork = true;
  restoreChoice.classList.add('hidden');
  renderWorkspace();
  setStatus(fileStatus, sourceMessage);
}

function localDraftForCurrentSubmission() {
  const saved = storageGet(draftKey(submission.id));
  if (!saved) return null;
  try {
    const documentData = parseDocument(saved);
    if (documentData.kind !== 'uxui-grading-draft' || documentData.submission.id !== submission.id) return null;
    return documentData;
  } catch {
    return null;
  }
}

function answersDiffer(first, second) {
  return QUESTIONS.some((question) => first.answers[question.id] !== second.answers[question.id]);
}

function showRestoreChoice(savedDraft) {
  const restoresOlderAnswers = answersDiffer(submission, savedDraft.submission);
  pendingLocalDraft = { documentData: savedDraft, restoresOlderAnswers };
  const savedInfo = `${savedDraft.submission.managerName} · ${formatDate(savedDraft.updatedAt)}에 임시저장`;
  $('#restore-copy').textContent = restoresOlderAnswers
    ? `${savedInfo}된 작업입니다. 가져온 파일과 답안 내용이 다릅니다. 복원하면 이전 답안까지 복원됩니다.`
    : `${savedInfo}된 작업입니다. 가져온 파일을 우선 표시하고 있습니다. 사용할 작업을 선택하세요.`;
  restoreChoice.classList.remove('hidden');
}

function clearScheduledSave() {
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = null;
}

function saveCurrentDraft() {
  if (!submission) return true;
  try {
    const draft = buildGradingDraft(submission, grade);
    if (!storageSet(draftKey(submission.id), draft)) throw new Error('저장 공간을 사용할 수 없습니다.');
    hasUnsavedChanges = false;
    setStatus(exportStatus, '이 브라우저에 임시저장했습니다. 파일도 별도로 내보내 보관하세요.');
    return true;
  } catch (error) {
    setStatus(exportStatus, `임시저장에 실패했습니다. ${error instanceof Error ? error.message : ''}`.trim(), true);
    return false;
  }
}

function flushPendingSave() {
  if (saveTimer === null && !hasUnsavedChanges) return true;
  clearScheduledSave();
  return saveCurrentDraft();
}

async function openFile(file) {
  if (!file || isOpeningFile) return;
  if (hasWork && !window.confirm('현재 채점 작업이 있습니다. 새 파일을 열면 화면의 작업이 바뀝니다. 계속할까요?')) {
    fileInput.value = '';
    return;
  }
  if (!flushPendingSave() && !window.confirm('현재 작업의 임시저장에 실패했습니다. 내보낸 파일이 없다면 작업이 사라질 수 있습니다. 그래도 새 파일을 열까요?')) {
    fileInput.value = '';
    return;
  }
  clearScheduledSave();
  isOpeningFile = true;
  fileInput.disabled = true;
  try {
    setStatus(fileStatus, '파일을 읽는 중입니다.');
    const documentData = await readDocumentFile(file);
    const work = workFromDocument(documentData);
    useWork(work, `${file.name} 파일을 이 브라우저에서 열었습니다. 서버에는 전송되지 않았습니다.`);
    const savedDraft = localDraftForCurrentSubmission();
    if (savedDraft) showRestoreChoice(savedDraft);
  } catch (error) {
    setStatus(fileStatus, error instanceof Error ? error.message : '파일을 열지 못했습니다.', true);
  } finally {
    fileInput.value = '';
    fileInput.disabled = false;
    isOpeningFile = false;
  }
}

function scheduleSave() {
  if (!submission) return;
  hasWork = true;
  hasUnsavedChanges = true;
  clearScheduledSave();
  setStatus(exportStatus, '이 브라우저에 임시저장할 준비를 하고 있습니다.');
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    saveCurrentDraft();
  }, 600);
}

function bindSummaryFields() {
  const bindings = [
    ['#strengths', 'strengths'],
    ['#improvements', 'improvements'],
    ['#next-action', 'nextAction'],
    ['#reviewer-name', 'reviewerName']
  ];
  bindings.forEach(([selector, field]) => {
    $(selector).addEventListener('input', (event) => {
      grade[field] = event.target.value;
      scheduleSave();
    });
  });
}

function downloadDraft() {
  if (!submission) return;
  try {
    const draft = buildGradingDraft(submission, grade);
    downloadJson(draft, submissionFilename(submission, 'grading-draft.json'));
    setStatus(exportStatus, '채점 초안 JSON을 파일로 내려받았습니다. 자동 전송되지는 않습니다.');
  } catch (error) {
    setStatus(exportStatus, error instanceof Error ? error.message : '초안을 만들지 못했습니다.', true);
  }
}

function buildFinalResult() {
  if (!submission) throw new Error('먼저 제출 파일을 열어 주세요.');
  return buildResult(submission, grade);
}

function downloadResultJson() {
  try {
    const result = buildFinalResult();
    downloadJson(result, submissionFilename(submission, 'result.json'));
    setStatus(exportStatus, '결과 JSON을 파일로 내려받았습니다. 결과 보기 또는 재채점에 사용할 수 있습니다.');
  } catch (error) {
    setStatus(exportStatus, `최종 확정 전 확인이 필요합니다. ${error instanceof Error ? error.message : ''}`.trim(), true);
  }
}

function downloadResultHtml() {
  try {
    const result = buildFinalResult();
    downloadText(exportResultHtml(result), submissionFilename(submission, 'result.html'), 'text/html;charset=utf-8');
    setStatus(exportStatus, '결과 HTML을 파일로 내려받았습니다. 로컬 파일로 열거나 직접 공유할 수 있습니다.');
  } catch (error) {
    setStatus(exportStatus, `최종 확정 전 확인이 필요합니다. ${error instanceof Error ? error.message : ''}`.trim(), true);
  }
}

fileInput.addEventListener('change', (event) => openFile(event.target.files?.[0]));
$('#use-imported').addEventListener('click', () => {
  pendingLocalDraft = null;
  restoreChoice.classList.add('hidden');
  setStatus(fileStatus, '가져온 파일의 내용을 사용합니다. 임시저장은 덮어쓰지 않았습니다.');
});
$('#restore-local').addEventListener('click', () => {
  if (!pendingLocalDraft) return;
  if (pendingLocalDraft.restoresOlderAnswers && !window.confirm('임시저장을 복원하면 가져온 파일의 답안 대신 이전 답안까지 복원됩니다. 계속할까요?')) return;
  useWork(workFromDocument(pendingLocalDraft.documentData), '이 브라우저에 있던 임시저장을 복원했습니다.');
  pendingLocalDraft = null;
});
clearButton.addEventListener('click', () => {
  if (!submission || !window.confirm('현재 화면의 작업을 비우고 이 제출의 브라우저 임시저장도 지울까요? 내보낸 파일은 지워지지 않습니다.')) return;
  clearScheduledSave();
  const savedId = submission.id;
  const removed = storageRemove(draftKey(savedId));
  submission = null;
  grade = emptyGrade();
  pendingLocalDraft = null;
  hasWork = false;
  hasUnsavedChanges = false;
  questionContainer.replaceChildren();
  syncSummaryFields();
  $('#manager-name').textContent = '—';
  $('#submission-id').textContent = '—';
  $('#submission-date').textContent = '—';
  $('#resource-used').textContent = '—';
  $('#resource-note').textContent = '';
  workspace.classList.add('hidden');
  restoreChoice.classList.add('hidden');
  clearButton.disabled = true;
  if (removed) {
    setStatus(fileStatus, '현재 작업과 이 브라우저의 임시저장을 비웠습니다.');
    setStatus(exportStatus, '');
  } else {
    setStatus(fileStatus, '현재 화면의 작업은 비웠지만, 브라우저 임시저장을 지우지 못했습니다. 브라우저 저장공간 설정을 확인해 주세요.', true);
    setStatus(exportStatus, '임시저장 삭제에 실패했습니다. 내보낸 파일과 브라우저 저장공간을 확인해 주세요.', true);
  }
});
$('#download-draft').addEventListener('click', downloadDraft);
$('#download-result-json').addEventListener('click', downloadResultJson);
$('#download-result-html').addEventListener('click', downloadResultHtml);
$('#grading-form').addEventListener('submit', event => event.preventDefault());
window.addEventListener('beforeunload', event => {
  if (hasUnsavedChanges && !flushPendingSave()) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('pagehide', flushPendingSave);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushPendingSave();
});
bindSummaryFields();
