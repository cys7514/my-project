// 숫자야구 규칙만 모아 둔 파일 (카메라와 상관없음)

export const LEVELS = [3, 4, 5];              // 난이도 = 숫자 몇 자리
export const TARGETS = [10, 20, 30, 50, 100]; // 고를 수 있는 목표 점수

// 몇 번 만에 맞혔는지에 따라 점수: 1번 10점, 2번 9점 … 10번째부터는 1점
export function pointsFor(tries) {
  return Math.max(11 - tries, 1);
}

// 0 ~ 9 중에서 서로 다른 숫자 뽑기
function makeSecret(digits) {
  const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const secret = [];
  for (let i = 0; i < digits; i++) {
    const k = Math.floor(Math.random() * pool.length);
    secret.push(pool.splice(k, 1)[0]);
  }
  return secret;
}

// S 스트라이크 = 숫자와 자리가 모두 맞음, B 볼 = 숫자는 있는데 자리가 다름, O 아웃 = 맞는 숫자가 하나도 없음
export function judge(secret, guess) {
  let strike = 0;
  let ball = 0;
  guess.forEach((n, i) => {
    if (secret[i] === n) strike++;
    else if (secret.includes(n)) ball++;
  });
  const out = strike === 0 && ball === 0;
  return { strike, ball, out, correct: strike === secret.length };
}

// 약자 ("1S 2B", "O")
export function shortText({ strike, ball, out }) {
  if (out) return 'O';
  return [strike && `${strike}S`, ball && `${ball}B`].filter(Boolean).join(' ');
}

// 풀어서 ("1스트라이크 2볼", "아웃")
export function fullText({ strike, ball, out }) {
  if (out) return '아웃';
  return [strike && `${strike}스트라이크`, ball && `${ball}볼`].filter(Boolean).join(' ');
}

// 게임 전체 (난이도, 목표 점수, 모은 점수)
export function newMatch(digits, target) {
  const match = { digits, target, total: 0, round: 0, finished: false };
  startRound(match);
  return match;
}

// 새 판 시작 (숨긴 숫자 새로 뽑기)
export function startRound(match) {
  match.round++;
  match.secret = makeSecret(match.digits);
  match.input = [];     // 지금 입력 중인 숫자들
  match.history = [];   // 이번 판에 던진 공 [{ guess, strike, ball, out, correct }]
  match.solved = false; // 이번 판을 맞혔는지
  match.lastPoints = 0;
}

// 숫자를 자리 수만큼 다 넣었는지
export function isFull(match) {
  return match.input.length === match.digits;
}

// 숫자 하나 넣기 → 무슨 일이 있었는지 돌려줌
export function addDigit(match, n) {
  if (match.solved || match.finished) return { ok: false, message: '이번 판은 끝났어요' };
  if (isFull(match)) return { ok: false, message: '숫자를 다 넣었어요. 동그라미를 그리면 결과가 나와요' };
  if (n < 0 || n > 9) return { ok: false, message: '0 ~ 9만 쓸 수 있어요' };
  if (match.input.includes(n)) return { ok: false, message: `${n}은(는) 이미 넣었어요` };

  match.input.push(n);
  return { ok: true };
}

// 결과 보기 (숫자를 다 넣은 뒤 동그라미를 그리면) → 판정 결과를 돌려줌
export function submit(match) {
  if (match.solved || match.finished || !isFull(match)) return null;
  const guess = match.input;
  const score = judge(match.secret, guess);
  const pitch = { guess, ...score };
  match.history.push(pitch);
  match.input = [];

  if (score.correct) {
    match.solved = true;
    match.lastPoints = pointsFor(match.history.length);
    match.total += match.lastPoints;
    if (match.total >= match.target) match.finished = true;
  }
  return pitch;
}

// 마지막 숫자 지우기
export function removeDigit(match) {
  if (match.solved || match.finished || match.input.length === 0) return false;
  match.input.pop();
  return true;
}

// 입력한 숫자 모두 지우기 (엑스를 그리면)
export function clearInput(match) {
  if (match.solved || match.finished || match.input.length === 0) return false;
  match.input = [];
  return true;
}
