export const ASSESSMENT_VERSION = 'uxui-v1';
export const MAX_ANSWER_LENGTH = 6000;
export const QUESTIONS = [
  {
    id: 'q1', area: '직무 설명', title: '프로덕트 디자이너는 어떤 일을 하나요?',
    prompt: '디자인을 처음 접한 지원자에게 프로덕트 디자이너가 하는 일을 1분 안에 설명한다고 가정해 주세요. 실제 상담에서 말하듯이 작성해 주세요.',
    followUp: '지원자가 떠올릴 수 있는 구체적인 업무 예시를 한 가지 포함해 주세요.'
  },
  {
    id: 'q2', area: '기대 확인과 상담', title: 'AI 이미지 제작을 기대하는 지원자',
    prompt: '지원자가 “AI로 광고 이미지나 캐릭터를 만들고 싶어서 지원했어요”라고 말했습니다. 이 지원자와 어떻게 상담하시겠습니까?',
    followUp: '먼저 물어볼 질문, 과정 안내 멘트, 설명 이후 확인할 질문을 실제 대화 형태로 작성해 주세요.'
  },
  {
    id: 'q3', area: '문제 해결 과정', title: '결제 직전 떠나는 사용자',
    prompt: '가상의 상황입니다. 쇼핑 앱에서 많은 사용자가 결제 직전에 이탈합니다. 이 문제를 맡은 프로덕트 디자이너는 어떤 순서로 일할까요?',
    followUp: '무엇을 확인하고, 어떤 작업을 하며, 결과를 어떻게 판단할지 설명해 주세요. 실제 서비스의 데이터가 주어진 상황은 아닙니다.'
  },
  {
    id: 'q4', area: 'AI 활용 이해', title: 'AI가 돕는 일, 사람이 판단할 일',
    prompt: '프로덕트 디자인 업무에서 AI가 도와줄 수 있는 일 두 가지와, 사람이 직접 판단하거나 검증해야 하는 일 두 가지를 설명해 주세요.',
    followUp: '도구 이름만 나열하기보다 어떤 업무에 어떻게 활용하는지 작성해 주세요.'
  },
  {
    id: 'q5', area: '과정과 결과물', title: '화면 너머의 포트폴리오',
    prompt: '지원자가 “수료하면 멋진 앱 화면을 모은 포트폴리오를 만들게 되나요? 개발도 직접 해야 하나요?”라고 물었습니다. 어떻게 안내하시겠습니까?',
    followUp: '포트폴리오에 담겨야 할 내용과 이 과정에서 다루는 구현 학습의 범위를 설명해 주세요. 확실하지 않은 부분은 확인이 필요하다고 적어도 괜찮습니다.'
  }
];
export const QUESTION_IDS = QUESTIONS.map(q => q.id);
export const RESOURCE_LABELS = { none: '자료를 참고하지 않았습니다', reference: '커리큘럼·인터넷 자료를 참고했습니다', ai: 'AI의 도움을 받았습니다', other: '기타' };
export function emptyAnswers() { return Object.fromEntries(QUESTION_IDS.map(id => [id, ''])); }
export function emptyGrade() {
  return { questions: Object.fromEntries(QUESTION_IDS.map(id => [id, { score: null, feedback: '' }])), strengths: '', improvements: '', nextAction: '', reviewerName: '' };
}
