import {
  ASSESSMENT_VERSION,
  MAX_ANSWER_LENGTH,
  QUESTIONS,
  RESOURCE_LABELS,
  emptyAnswers
} from './questions.js';
import {
  buildSubmission,
  countAnswered,
  downloadJson,
  downloadText,
  formatDate,
  storageGet,
  storageRemove,
  storageSet,
  submissionFilename,
  toAnswersText
} from './lib.js';

const DRAFT_KEY = `uxui-consultant-assessment:${ASSESSMENT_VERSION}:draft`;
const SAVE_DELAY = 500;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const app = document.querySelector('#exam-app');

let saveTimer;
let state = createInitialState();

function createDraftId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();

  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function safeString(value, maxLength = MAX_ANSWER_LENGTH) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function createInitialState() {
  const saved = storageGet(DRAFT_KEY);
  const answers = emptyAnswers();

  if (saved && typeof saved === 'object') {
    QUESTIONS.forEach((question) => {
      answers[question.id] = safeString(saved.answers?.[question.id]);
    });
  }

  const savedSubmissionId = safeString(saved?.submissionId, 36);
  return {
    managerName: safeString(saved?.managerName, 80),
    answers,
    resourcesUsed: Object.hasOwn(RESOURCE_LABELS, saved?.resourcesUsed) ? saved.resourcesUsed : 'none',
    resourceNote: safeString(saved?.resourceNote, 1000),
    submissionId: UUID_V4_PATTERN.test(savedSubmissionId) ? savedSubmissionId : createDraftId(),
    restored: Boolean(saved && typeof saved === 'object')
  };
}

function element(tagName, options = {}) {
  const node = document.createElement(tagName);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.id) node.id = options.id;
  if (options.type) node.type = options.type;
  if (options.href) node.href = options.href;
  if (options.name) node.name = options.name;
  if (options.value !== undefined) node.value = options.value;
  if (options.htmlFor) node.htmlFor = options.htmlFor;
  return node;
}

function createStatus(text, kind = '') {
  const status = element('p', { className: `status ${kind}`.trim(), text, id: 'draft-status' });
  status.setAttribute('role', 'status');
  return status;
}

function render() {
  const workspace = element('div', { className: 'workspace' });
  const sidebar = buildSidebar();
  const main = element('section', { className: 'main-content', id: 'assessment-form' });

  main.append(buildIdentityPanel());
  main.append(buildResourcePanel());
  main.append(buildQuestions());
  main.append(buildActionPanel());
  workspace.append(sidebar, main);
  app.replaceChildren(workspace);

  updateAllIndicators();
  if (state.restored) {
    setStatus('이 브라우저에 임시저장한 초안을 복원했습니다. 공용 PC라면 작성 후 초기화해 주세요.');
  }
}

function buildSidebar() {
  const sidebar = element('aside', { className: 'sidebar', id: 'question-nav' });
  const label = element('p', { className: 'eyebrow', text: 'WRITING STATUS' });
  const status = element('p', { className: 'sidebar-progress', id: 'sidebar-progress' });
  const list = element('ol', { className: 'question-list' });

  QUESTIONS.forEach((question, index) => {
    const item = element('li');
    const link = element('a', { href: `#question-${question.id}` });
    const number = element('span', { className: 'question-number', text: String(index + 1).padStart(2, '0') });
    const title = element('span', { text: question.title });
    const marker = element('span', { className: 'answer-marker', id: `marker-${question.id}`, text: '미작성' });
    link.append(number, title, marker);
    item.append(link);
    list.append(item);
  });

  sidebar.append(label, status, list);
  return sidebar;
}

function buildIdentityPanel() {
  const panel = element('section', { className: 'panel' });
  const heading = element('h2', { text: '작성자' });
  const field = element('div', { className: 'field' });
  const label = element('label', { className: 'field-label', htmlFor: 'manager-name', text: '이름' });
  const input = element('input', { className: 'input', id: 'manager-name', type: 'text', value: state.managerName });
  input.maxLength = 80;
  input.autocomplete = 'name';
  input.required = true;
  input.setAttribute('aria-describedby', 'manager-name-help manager-name-error');
  input.addEventListener('input', () => {
    state.managerName = input.value;
    clearError('manager-name');
    queueSave();
  });
  const help = element('p', { className: 'field-help', id: 'manager-name-help', text: '파일을 전달할 때 작성자를 구분하기 위해 사용합니다.' });
  const error = element('p', { className: 'field-error', id: 'manager-name-error' });
  error.hidden = true;
  field.append(label, input, help, error);
  panel.append(heading, field);
  return panel;
}

function buildResourcePanel() {
  const panel = element('section', { className: 'panel' });
  const heading = element('h2', { text: '자료 참고 여부' });
  const explanation = element('p', { className: 'field-help', text: '참고하지 않았다면 “자료를 참고하지 않았습니다”를 선택해 주세요. 참고 여부는 답안의 맥락을 이해하기 위한 정보입니다.' });
  const options = element('div', { className: 'resource-options' });

  Object.entries(RESOURCE_LABELS).forEach(([value, labelText]) => {
    const option = element('label', { className: 'radio-option' });
    const radio = element('input', { type: 'radio', name: 'resources-used', value });
    radio.checked = state.resourcesUsed === value;
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      state.resourcesUsed = value;
      queueSave();
    });
    option.append(radio, document.createTextNode(labelText));
    options.append(option);
  });

  const field = element('div', { className: 'field compact-field' });
  const label = element('label', { className: 'field-label', htmlFor: 'resource-note', text: '참고한 자료 또는 사용 방식 메모 (선택)' });
  const note = element('textarea', { className: 'textarea', id: 'resource-note', value: state.resourceNote });
  note.rows = 3;
  note.maxLength = 1000;
  note.placeholder = '예: 과정 소개 페이지를 확인함, AI로 문장 구조를 점검함';
  note.addEventListener('input', () => {
    state.resourceNote = note.value;
    queueSave();
  });
  field.append(label, note);
  panel.append(heading, explanation, options, field);
  return panel;
}

function buildQuestions() {
  const section = element('section', { className: 'question-section', id: 'questions' });
  const heading = element('h2', { className: 'section-title', text: '상담 답안' });
  const description = element('p', { className: 'muted', text: '모든 문항에 답해 주세요. 잘 모르겠는 내용도 현재 생각을 적어 주세요.' });
  section.append(heading, description);

  QUESTIONS.forEach((question, index) => {
    const card = element('article', { className: 'question-card', id: `question-${question.id}` });
    const meta = element('p', { className: 'question-meta', text: `Q${String(index + 1).padStart(2, '0')} · ${question.area}` });
    const title = element('h3', { text: question.title });
    const prompt = element('p', { className: 'question-prompt', text: question.prompt });
    const followUp = element('p', { className: 'field-help', text: question.followUp });
    const field = element('div', { className: 'field' });
    const label = element('label', { className: 'field-label sr-only', htmlFor: `${question.id}-answer`, text: `${question.title} 답변` });
    const textarea = element('textarea', { className: 'textarea', id: `${question.id}-answer`, value: state.answers[question.id] });
    textarea.rows = 9;
    textarea.maxLength = MAX_ANSWER_LENGTH;
    textarea.required = true;
    textarea.placeholder = '상담에서 실제로 말하듯이 작성해 주세요.';
    textarea.setAttribute('aria-describedby', `${question.id}-count ${question.id}-error`);
    textarea.addEventListener('input', () => {
      state.answers[question.id] = textarea.value;
      clearError(question.id);
      updateQuestionIndicator(question.id);
      updateProgress();
      updateCounter(question.id);
      queueSave();
    });
    const lower = element('div', { className: 'field-lower' });
    const counter = element('span', { className: 'char-count', id: `${question.id}-count` });
    const error = element('p', { className: 'field-error', id: `${question.id}-error` });
    error.hidden = true;
    lower.append(counter, error);
    field.append(label, textarea, lower);
    card.append(meta, title, prompt, followUp, field);
    section.append(card);
  });
  return section;
}

function buildActionPanel() {
  const panel = element('section', { className: 'panel action-panel' });
  const heading = element('h2', { text: '파일로 준비하기' });
  const lead = element('p', { text: '채점을 위해 JSON 파일을 반드시 담당자에게 전달해 주세요. TXT는 답안을 읽기 편한 형식으로 보관하거나 공유할 때 사용할 수 있습니다.' });
  const warning = element('p', { className: 'notice warning inline-notice', text: '다운로드만으로 담당자에게 자동 전달되지는 않습니다. 채점용 JSON 파일을 내려받아 직접 전달해 주세요.' });
  const resumeHelp = element('p', { className: 'field-help', text: '이 화면에서는 내려받은 JSON 파일을 다시 불러와 이어 쓰는 기능을 제공하지 않습니다. 같은 브라우저의 임시저장 내용이 남아 있을 때만 이어서 작성할 수 있습니다.' });
  const actionRow = element('div', { className: 'actions' });
  const jsonButton = element('button', { className: 'button', type: 'button', text: 'JSON 내려받기 (채점용)' });
  const textButton = element('button', { className: 'button secondary', type: 'button', text: 'TXT 내려받기 (읽기용)' });
  const resetButton = element('button', { className: 'button danger', type: 'button', text: '이 브라우저 초안 초기화' });
  jsonButton.addEventListener('click', () => download('json'));
  textButton.addEventListener('click', () => download('txt'));
  resetButton.addEventListener('click', resetDraft);
  actionRow.append(jsonButton, textButton, resetButton);
  const status = createStatus('입력하면 이 브라우저에 임시저장됩니다. 같은 초안은 다시 내려받아도 같은 문서 ID를 유지합니다.');
  panel.append(heading, lead, warning, resumeHelp, actionRow, status);
  return panel;
}

function updateCounter(questionId) {
  const counter = document.querySelector(`#${questionId}-count`);
  if (counter) counter.textContent = `${state.answers[questionId].length.toLocaleString()} / ${MAX_ANSWER_LENGTH.toLocaleString()}자`;
}

function updateQuestionIndicator(questionId) {
  const marker = document.querySelector(`#marker-${questionId}`);
  if (!marker) return;
  const answered = state.answers[questionId].trim().length > 0;
  marker.textContent = answered ? '작성됨' : '미작성';
  marker.classList.toggle('is-answered', answered);
}

function updateProgress() {
  const count = countAnswered(state.answers);
  const progress = document.querySelector('#sidebar-progress');
  if (progress) progress.textContent = `${count} / ${QUESTIONS.length} 문항 작성`;
}

function updateAllIndicators() {
  QUESTIONS.forEach((question) => {
    updateQuestionIndicator(question.id);
    updateCounter(question.id);
  });
  updateProgress();
}

function queueSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined;
    saveDraft();
  }, SAVE_DELAY);
}

function flushSave() {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  saveDraft();
}

function saveDraft() {
  const saved = storageSet(DRAFT_KEY, {
    managerName: state.managerName,
    answers: state.answers,
    resourcesUsed: state.resourcesUsed,
    resourceNote: state.resourceNote,
    submissionId: state.submissionId
  });

  if (saved) {
    setStatus(`이 브라우저에 임시저장됨 · ${formatDate(new Date().toISOString())}`);
  } else {
    setStatus('이 브라우저 임시저장에 실패했습니다. 작성 후 파일을 바로 내려받아 보관해 주세요.', 'error');
  }
  return saved;
}

function clearError(fieldId) {
  const target = document.querySelector(`#${fieldId}-error`);
  const input = document.querySelector(`#${fieldId === 'manager-name' ? 'manager-name' : `${fieldId}-answer`}`);
  if (target) {
    target.hidden = true;
    target.textContent = '';
  }
  if (input) input.removeAttribute('aria-invalid');
}

function showError(fieldId, message) {
  const target = document.querySelector(`#${fieldId}-error`);
  const input = document.querySelector(`#${fieldId === 'manager-name' ? 'manager-name' : `${fieldId}-answer`}`);
  if (target) {
    target.textContent = message;
    target.hidden = false;
  }
  if (input) input.setAttribute('aria-invalid', 'true');
  return input;
}

function validateForDownload() {
  let firstInvalid = null;
  clearError('manager-name');
  if (!state.managerName.trim()) {
    firstInvalid = showError('manager-name', '이름을 입력해 주세요.');
  }

  QUESTIONS.forEach((question) => {
    clearError(question.id);
    if (!state.answers[question.id].trim()) {
      const input = showError(question.id, '답변을 작성해 주세요. 모를 경우에도 현재 생각을 적어 주세요.');
      if (!firstInvalid) firstInvalid = input;
    }
  });

  if (firstInvalid) {
    setStatus('내려받기 전에 이름과 모든 답변을 확인해 주세요.', 'error');
    firstInvalid.focus();
    return false;
  }
  return true;
}

function createSubmission() {
  return buildSubmission({
    managerName: state.managerName,
    answers: state.answers,
    resourcesUsed: state.resourcesUsed,
    resourceNote: state.resourceNote,
    id: state.submissionId
  });
}

function download(extension) {
  if (!validateForDownload()) return;

  try {
    const builtSubmission = createSubmission();
    // Keep one draft identifier across repeated downloads, including after revisions.
    const submission = { ...builtSubmission, id: state.submissionId };
    const filename = submissionFilename(submission, extension);

    if (extension === 'json') {
      downloadJson(submission, filename);
    } else {
      downloadText(toAnswersText(submission), filename, 'text/plain;charset=utf-8');
    }

    const saved = saveDraft();
    setStatus(saved
      ? `${extension.toUpperCase()} 파일 다운로드를 요청했습니다. 다운로드 폴더에서 확인한 뒤 담당자에게 직접 전달해 주세요.`
      : `${extension.toUpperCase()} 파일 다운로드를 요청했지만 브라우저 임시저장에는 실패했습니다. 다운로드 폴더에서 파일을 꼭 확인하고 보관·전달해 주세요.`, saved ? '' : 'error');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '파일을 준비하지 못했습니다. 입력 내용을 다시 확인해 주세요.', 'error');
  }
}

function resetDraft() {
  const confirmed = window.confirm('이 브라우저에 임시저장된 이름과 모든 답안을 초기화할까요? 이 작업은 되돌릴 수 없습니다.');
  if (!confirmed) return;

  window.clearTimeout(saveTimer);
  const removed = storageRemove(DRAFT_KEY);
  state = {
    managerName: '',
    answers: emptyAnswers(),
    resourcesUsed: 'none',
    resourceNote: '',
    submissionId: createDraftId(),
    restored: false
  };
  render();
  setStatus(removed ? '이 브라우저의 임시 초안을 초기화했습니다.' : '임시저장소를 비우지 못했습니다. 현재 입력 화면은 비워졌습니다.', removed ? '' : 'error');
}

function setStatus(message, kind = '') {
  const status = document.querySelector('#draft-status');
  if (!status) return;
  status.textContent = message;
  status.className = `status ${kind}`.trim();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave();
});
window.addEventListener('pagehide', flushSave);

render();
