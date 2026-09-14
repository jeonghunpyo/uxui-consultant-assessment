import { QUESTIONS, RESOURCE_LABELS } from './questions.js';
import { readDocumentFile, formatDate, totalScore } from './lib.js';

const $ = (selector) => document.querySelector(selector);
const fileInput = $('#result-file');
const status = $('#file-status');
const content = $('#result-content');

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function validResult(documentData) {
  if (documentData?.kind !== 'uxui-result') {
    throw new Error('이 화면에서는 최종 결과 JSON 파일만 열 수 있습니다. 제출 파일과 채점 초안 파일은 채점 화면에서 열어 주세요.');
  }
  if (!documentData.submission || !documentData.grade) {
    throw new Error('결과 파일에 제출 내용 또는 채점 내용이 없습니다.');
  }
  return documentData;
}

function clearRenderedResult() {
  $('#manager-name').textContent = '—';
  $('#result-meta').textContent = '—';
  $('#total-score').textContent = '0 / 10점';
  $('#question-results').replaceChildren();
  $('#strengths').textContent = '—';
  $('#improvements').textContent = '—';
  $('#next-action').textContent = '—';
  $('#reviewer-name').textContent = '';
  $('#print-result').disabled = true;
  content.classList.add('hidden');
}

function appendQuestionResult(question, index, result) {
  const submission = result.submission;
  const questionGrade = result.grade.questions?.[question.id];
  const card = createElement('article', 'question-card result-question');
  const heading = createElement('h2', null, `${index + 1}. ${question.title}`);
  const meta = createElement('p', 'question-meta', question.area);
  const prompt = createElement('p', 'muted answer-text', question.prompt);
  const answerLabel = createElement('h3', 'field-label', '제출 답안');
  const answer = createElement('p', 'answer-text', submission.answers?.[question.id] || '답안이 작성되지 않았습니다.');
  const score = createElement('p', 'status', `점수: ${questionGrade?.score ?? '—'} / 2점`);
  const feedbackLabel = createElement('h3', 'field-label', '문항 피드백');
  const feedback = createElement('p', 'feedback', questionGrade?.feedback || '—');
  card.append(heading, meta, prompt, answerLabel, answer, score, feedbackLabel, feedback);
  $('#question-results').append(card);
}

function renderResult(result) {
  const submission = result.submission;
  const grade = result.grade;
  $('#manager-name').textContent = submission.managerName || '이름 없음';
  const resource = RESOURCE_LABELS[submission.resourcesUsed] || '기록 없음';
  $('#result-meta').textContent = `제출 ${formatDate(submission.createdAt)} · 결과 ${formatDate(result.publishedAt)} · 참고 자료: ${resource}`;
  $('#total-score').textContent = `${totalScore(grade)} / 10점`;
  $('#question-results').replaceChildren();
  QUESTIONS.forEach((question, index) => appendQuestionResult(question, index, result));
  $('#strengths').textContent = grade.strengths || '—';
  $('#improvements').textContent = grade.improvements || '—';
  $('#next-action').textContent = grade.nextAction || '—';
  $('#reviewer-name').textContent = grade.reviewerName ? `채점자: ${grade.reviewerName}` : '';
  $('#print-result').disabled = false;
  content.classList.remove('hidden');
}

async function openResult(file) {
  if (!file) return;
  try {
    setStatus('결과 파일을 읽는 중입니다.');
    const documentData = validResult(await readDocumentFile(file));
    renderResult(documentData);
    setStatus(`${file.name} 파일을 이 브라우저에서 열었습니다. 서버에는 전송되지 않았습니다.`);
  } catch (error) {
    clearRenderedResult();
    setStatus(error instanceof Error ? error.message : '결과 파일을 열지 못했습니다.', true);
  } finally {
    fileInput.value = '';
  }
}

fileInput.addEventListener('change', (event) => openResult(event.target.files?.[0]));
$('#print-result').addEventListener('click', () => window.print());
