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

// 약자 ("2B 1S", "O") → 볼을 먼저, 스트라이크를 나중에
export function shortText({ strike, ball, out }) {
  if (out) return 'O';
  return [ball && `${ball}B`, strike && `${strike}S`].filter(Boolean).join(' ');
}

// 풀어서 ("2볼 1스트라이크", "아웃") → 볼을 먼저, 스트라이크를 나중에
export function fullText({ strike, ball, out }) {
  if (out) return '아웃';
  return [ball && `${ball}볼`, strike && `${strike}스트라이크`].filter(Boolean).join(' ');
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
  resetInput(match);
  match.history = [];   // 이번 판에 던진 공 [{ guess, strike, ball, out, correct }]
  match.solved = false; // 이번 판을 맞혔는지
  match.lastPoints = 0;
}

// 입력 칸 비우기: 자리마다 숫자 또는 null(빈칸), 화살표(cursor)는 첫 칸
function resetInput(match) {
  match.input = Array(match.digits).fill(null);
  match.cursor = 0;
  match.cursorLocked = false; // true = 가위로 칸을 골랐음 → 다시 가위로 가리킬 때까지 화살표가 그 자리에 있음
}

// 입력한 숫자 개수
export function filledCount(match) {
  return match.input.filter((n) => n !== null).length;
}

// 모든 자리를 다 채웠는지
export function isFull(match) {
  return filledCount(match) === match.digits;
}

// 첫 번째 빈칸 (from부터 오른쪽으로 찾고, 없으면 처음부터) → 빈칸이 없으면 -1
function nextEmpty(match, from) {
  for (let k = 0; k < match.digits; k++) {
    const i = (from + k) % match.digits;
    if (match.input[i] === null) return i;
  }
  return -1;
}

// 화살표가 있는 자리에 숫자 넣기 → 무슨 일이 있었는지 돌려줌
export function addDigit(match, n) {
  if (match.solved || match.finished) return { ok: false, message: '이번 판은 끝났어요' };
  if (n < 0 || n > 9) return { ok: false, message: '0 ~ 9만 쓸 수 있어요' };
  const at = match.cursor;
  const other = match.input.findIndex((v, i) => v === n && i !== at);
  if (other >= 0) return { ok: false, message: `${n}은(는) 이미 ${other + 1}번째 자리에 있어요` };
  // 한번 들어간 숫자는 바로 바꿀 수 없음 → 양손바닥으로 먼저 지워야 함 (실수로 바뀌지 않게)
  if (match.input[at] !== null) {
    return { ok: false, message: `${at + 1}번째 자리에는 이미 ${match.input[at]}이(가) 있어요. 바꾸려면 양손바닥으로 먼저 지우세요` };
  }

  const replaced = null;
  match.input[at] = n;
  // 화살표: 가위로 칸을 고른 뒤에는 그대로 (다시 가위로 가리켜야 옮겨짐)
  //         가위를 안 썼으면 다음 빈칸으로 자동 이동 (빈칸이 없으면 그대로)
  if (!match.cursorLocked) {
    const next = nextEmpty(match, at + 1);
    if (next >= 0) match.cursor = next;
  }
  return { ok: true, at, replaced };
}

// 화살표를 왼쪽(-1) · 오른쪽(+1)으로 한 칸 옮기기 → 옮겼으면 true
export function moveCursor(match, dir) {
  if (match.solved || match.finished) return false;
  const to = match.cursor + dir;
  if (to < 0 || to >= match.digits) return false;
  match.cursor = to;
  match.cursorLocked = true; // 이제부터 화살표는 가위로만 움직임
  return true;
}

// 결과 보기 (숫자를 다 넣은 뒤 동그라미) → 판정 결과를 돌려줌
export function submit(match) {
  if (match.solved || match.finished || !isFull(match)) return null;
  const guess = [...match.input];
  const score = judge(match.secret, guess);
  const pitch = { guess, ...score };
  match.history.push(pitch);
  resetInput(match);

  if (score.correct) {
    match.solved = true;
    match.lastPoints = pointsFor(match.history.length);
    match.total += match.lastPoints;
    if (match.total >= match.target) match.finished = true;
  }
  return pitch;
}

// 숫자 하나 지우기 (양손바닥): 화살표 자리에 숫자가 있으면 그걸 지우고,
// 빈칸이면 왼쪽에서 가장 가까운 숫자를 지우고 화살표도 그리로 → 지운 자리(없으면 -1)
export function removeDigit(match) {
  if (match.solved || match.finished || filledCount(match) === 0) return -1;
  let at = match.cursor;
  if (match.input[at] === null) {
    if (match.cursorLocked) return -1; // 가위로 고른 칸이 비어 있으면 아무것도 안 지움 (화살표도 그대로)
    at = -1;
    for (let i = match.cursor - 1; i >= 0; i--) if (match.input[i] !== null) { at = i; break; }
    if (at < 0) return -1;
  }
  match.input[at] = null;
  match.cursor = at;
  return at;
}

// 입력한 숫자 모두 지우기 (엑스)
export function clearInput(match) {
  if (match.solved || match.finished || filledCount(match) === 0) return false;
  resetInput(match);
  return true;
}
