import { FilesetResolver, DrawingUtils } from '/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs';
import * as hands from './hands.js';
import * as game from './game.js';
import * as poses from './poses.js';

// ----- 손 동작 설정 (숫자를 바꿔서 조절할 수 있어요) -----
// 손가락 수가 바뀌면 바로 입력. 단, 손가락을 펴는 도중의 숫자(3 → 5 사이의 4 등)가
// 들어가지 않게 같은 개수가 이 시간만큼은 계속 보여야 인정 (0.25초)
const STABLE_MS = 250;
// 두 손 동그라미 · 엑스는 이 시간만큼 유지하면 실행 (0.3초, 손을 모으는 도중에 잘못 실행되지 않게)
const POSE_MS = 300;
// 양손바닥(손가락 10개 = 하나 지우기 · 다음 판)은 이 시간만큼 보여야 실행 (0.6초)
const PALMS_MS = 600;
// 두 손 모양을 만드는 중에 손이 잠깐 안 보여도 이 시간까지는 끊기지 않은 걸로 봄 (0.3초)
const POSE_GAP_MS = 300;
// 몸 인식(엑스)은 이만큼의 화면마다 한 번 (3 = 3화면에 한 번)
const BODY_EVERY = 3;
// 손가락으로 숫자를 하나 넣거나 지운 뒤 이 시간 동안은 다음 손가락 수를 인식하지 않음 (0.75초)
// → 쉬는 시간 0.75초 + 다음 숫자 확인 0.25초(STABLE_MS) = 다음 숫자까지 약 1초
const AFTER_INPUT_MS = 750;

const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');

const drawingUtils = new DrawingUtils(ctx);
let match = null;                  // 지금 하는 게임 (null = 시작 화면)
let level = game.LEVELS[0];        // 고른 난이도
let target = game.TARGETS[1];      // 고른 목표 점수
let vision = null;                 // MediaPipe (처음 시작할 때 한 번만 준비)
let handsReady = false;
let running = false;               // 카메라가 켜져서 인식 중인지
let lastVideoTime = -1;
let frameNo = 0;
let frames = 0;
let fpsTime = performance.now();

// 손가락 수 상태
let candidate = null;   // 방금 본 손가락 수
let candidateSince = 0; // candidate가 처음 보인 시각
let shown = null;       // 인정된 손가락 수 (손이 없으면 null)
let lastLabel = '';     // 방금 한 일 (예: "2번째 숫자 7 ✔")
let flashUntil = 0;     // 실행됐을 때 테두리를 보여 줄 시각까지

// 두 손 모양 상태
let pose = null;        // 지금 보이는 모양 'circle' | 'x' | null
let poseSince = 0;      // 그 모양이 처음 보인 시각
let poseDone = false;   // 이번에 만든 모양으로 이미 실행했는지 (손을 풀어야 다시 실행)
let poseLastSeen = 0;   // 모양이 마지막으로 보인 시각
let waitUntil = 0;      // 숫자를 넣은 뒤 이 시각까지는 다음 손가락 수를 안 봄

// ===== 시작 화면 =====
function makeChoices(box, values, unit, get, set) {
  box.innerHTML = '';
  values.forEach((v) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice';
    b.textContent = `${v}${unit}`;
    b.addEventListener('click', () => {
      set(v);
      [...box.children].forEach((c) => c.classList.toggle('active', c === b));
    });
    b.classList.toggle('active', v === get());
    box.appendChild(b);
  });
}

// 시작 화면만 보여 주고 카메라는 끔
function showSetup() {
  match = null;
  stopCamera();
  $('setup').hidden = false;
  $('game').hidden = true;
  $('home').hidden = true;
  $('setting').textContent = '';
  $('fps').textContent = '';
}

// 설정을 고르고 시작 → 게임 화면으로 바꾸고 카메라 켜기
async function startMatch() {
  match = game.newMatch(level, target);
  $('setup').hidden = true;
  $('game').hidden = false;
  $('home').hidden = false;
  $('setting').textContent = `${level}자리 · 목표 ${target}점`;
  clearBoard();
  setMessage('손가락으로 첫 번째 숫자를 보여 주세요');
  render();
  await startCamera();
}

function nextRound() {
  game.startRound(match);
  clearBoard();
  setMessage('새 숫자를 숨겼어요! 첫 번째 숫자를 보여 주세요');
  render();
}

// ===== 게임 화면 =====
function setMessage(text, kind = '') {
  $('message').textContent = text;
  $('message').className = `message ${kind}`;
}

// 판정 칸 (S · B · O 숫자와 정답 여부)
function showBoard(pitch) {
  const rows = { s: pitch.strike, b: pitch.ball, o: pitch.out ? 1 : 0 };
  Object.entries(rows).forEach(([k, v]) => {
    $(`lamp-${k}`).textContent = v;
    $(`lamp-${k}`).parentElement.classList.toggle('on', v > 0);
  });
  const verdict = $('verdict');
  verdict.textContent = `${pitch.guess.join('')} → ${game.shortText(pitch)} (${game.fullText(pitch)}) · `
    + (pitch.correct ? '정답이에요!' : '정답이 아니에요');
  verdict.className = `verdict ${pitch.correct ? 'yes' : 'no'}`;
}

function clearBoard() {
  ['s', 'b', 'o'].forEach((k) => {
    $(`lamp-${k}`).textContent = '-';
    $(`lamp-${k}`).parentElement.classList.remove('on');
  });
  $('verdict').textContent = '';
  $('recognized').textContent = '';
}

// 결과표 한 줄: 번호 | 입력 | B | S | O | 결과
function historyRow(p, i, isLatest) {
  const cell = (cls, v) => `<td class="${v ? cls : `${cls} zero`}">${v}</td>`;
  const classes = [p.correct && 'correct', isLatest && 'latest'].filter(Boolean).join(' ');
  return `<tr class="${classes}">`
    + `<td class="num">${i + 1}</td>`
    + `<td class="guess">${p.guess.join('')}</td>`
    + cell('b', p.ball)
    + cell('s', p.strike)
    + cell('o', p.out ? 1 : 0)
    + `<td class="res">${p.correct ? '정답!' : '아님'}</td>`
    + '</tr>';
}

function render() {
  if (!match) return;
  const tries = match.history.length;
  $('total').textContent = `${match.total} / ${match.target}`;
  $('round').textContent = `${match.round}판`;
  $('worth').textContent = match.solved
    ? `+${match.lastPoints}점`
    : `${tries + 1}번째 · ${game.pointsFor(tries + 1)}점`;

  // 자리 수만큼 칸 만들기
  const slots = $('slots');
  if (slots.children.length !== match.digits) {
    slots.innerHTML = '<span class="slot"></span>'.repeat(match.digits);
  }
  const shownDigits = match.solved ? match.history.at(-1).guess : match.input;
  [...slots.children].forEach((slot, i) => {
    const n = shownDigits[i];
    slot.textContent = n ?? '';
    slot.classList.toggle('filled', n !== undefined);
    slot.classList.toggle('next', !match.solved && i === match.input.length);
  });

  // 이번 판 결과표 (1번부터 차례대로, 방금 것은 주황색으로 표시)
  $('history').innerHTML = match.history
    .map((h, i) => historyRow(h, i, i === tries - 1))
    .join('');
  $('history-empty').hidden = tries > 0;
  const scroller = $('history-scroll');
  scroller.scrollTop = scroller.scrollHeight; // 방금 결과가 보이게 맨 아래로

  // 판이 끝났을 때
  const ending = $('ending');
  ending.hidden = !match.solved;
  ending.classList.toggle('final', match.finished);
  if (match.finished) {
    $('ending-title').textContent = '🏆 목표 달성!';
    $('ending-text').textContent = `${match.round}판 동안 모두 ${match.total}점을 모았어요. (목표 ${match.target}점)`;
    $('ending-next').textContent = '양손바닥(손가락 10개)을 보여 주면 처음으로';
    $('next').textContent = '처음으로';
  } else if (match.solved) {
    $('ending-title').textContent = `🎉 ${match.digits}스트라이크! 정답이에요`;
    $('ending-text').textContent = `정답 ${match.secret.join('')} · ${tries}번 만에 맞혀서 +${match.lastPoints}점`;
    $('ending-next').textContent = '양손바닥(손가락 10개)을 보여 주면 다음 판';
    $('next').textContent = '다음 판';
  }
}

// ===== 입력 (숫자는 손가락으로만) =====
function inputDigit(n) {
  const r = game.addDigit(match, n);
  $('recognized').textContent = `· 인식된 숫자 ${n}`;
  if (!r.ok) {
    setMessage(r.message, 'warn');
  } else if (game.isFull(match)) {
    setMessage('다 넣었어요! 두 손으로 동그라미 ◯ = 결과, 두 손목 엑스 ✕ = 모두 지우기', 'warn');
  } else {
    setMessage(`${match.input.length}번째 숫자 ${n} 입력! 다음 숫자를 보여 주세요`);
  }
  render();
}

function deleteDigit() {
  if (game.removeDigit(match)) setMessage('마지막 숫자를 지웠어요');
  render();
}

// 동그라미 → 결과 보기
function submitGuess() {
  const pitch = game.submit(match);
  if (!pitch) return;
  showBoard(pitch);
  setMessage(pitch.correct ? '' : '다시 첫 번째 숫자부터 보여 주세요');
  render();
}

// 엑스 → 모두 지우기
function clearAll() {
  if (game.clearInput(match)) setMessage('모두 지웠어요. 첫 번째 숫자부터 다시 보여 주세요');
  render();
}

function afterRound() {
  if (match.finished) showSetup();
  else nextRound();
}

$('start').addEventListener('click', startMatch);
$('next').addEventListener('click', afterRound);
$('home').addEventListener('click', showSetup);

// 지금 손가락 수로 무엇을 하게 되는지
function actionFor(count) {
  if (count === null || !match) return null;
  if (match.solved) {
    const label = match.finished ? '처음으로' : '다음 판';
    return count === 10 ? { label, run: afterRound } : { label: `양손바닥 = ${label}`, run: null };
  }
  // 양손바닥(손가락 10개) = 하나 지우기, 0(주먹) ~ 9 = 숫자
  if (count === 10) {
    return match.input.length ? { label: '하나 지우기', run: deleteDigit } : { label: '양손바닥 = 하나 지우기', run: null };
  }
  if (game.isFull(match)) return { label: '두 손 ◯ = 결과 · ✕ = 모두 지우기', run: null };
  if (match.input.includes(count)) return { label: `${count}은(는) 이미 있어요`, run: null };
  return { label: `${match.input.length + 1}번째 숫자 ${count}`, run: () => inputDigit(count) };
}

// 지금 두 손 모양으로 무엇을 하게 되는지
function poseAction(name) {
  if (!match || match.solved) return null;
  if (name === 'circle') {
    return game.isFull(match) ? { label: '동그라미 ◯ 결과!', run: submitGuess } : { label: '숫자를 다 넣고 ◯', run: null };
  }
  if (name === 'x') {
    return match.input.length ? { label: '엑스 ✕ 모두 지우기', run: clearAll } : { label: '지울 숫자가 없어요', run: null };
  }
  return null;
}

function done(label, run, now) {
  lastLabel = `${label} ✔`;
  flashUntil = now + 500;
  run();
}

// 두 손 동그라미 · 엑스 확인 → 모양이 보이는 동안 true (그동안 손가락 수는 숫자로 안 셈)
function updatePose(result, now) {
  const aspect = canvas.width / canvas.height;
  let name = poses.isX() ? 'x' : poses.isCircle(result, aspect) ? 'circle' : null;
  if (name) poseLastSeen = now;
  // 손을 엇갈리면 손 하나가 잠깐 가려질 수 있어서, 0.3초까지는 같은 모양이 계속되는 걸로 봄
  else if (pose && now - poseLastSeen < POSE_GAP_MS) name = pose;
  if (name !== pose) {
    pose = name;
    poseSince = now;
    poseDone = false;
  }
  if (!pose) return false;

  const action = poseAction(pose);
  if (!poseDone && now - poseSince >= POSE_MS) {
    poseDone = true;
    lastLabel = action ? action.label : '';
    if (action?.run) {
      done(action.label, action.run, now);
      waitUntil = now + AFTER_INPUT_MS; // 1초 동안 쉬었다가 다음 숫자 인식
    }
  }
  return true;
}

// 매 화면 손가락 수 처리 → 인정된 손가락 수가 바뀌었으면 true
function updateGesture(count, now, paused) {
  if (count !== candidate || paused || now < waitUntil) {
    candidate = count;
    candidateSince = now; // 두 손 모양을 만드는 중이면 다시 처음부터 확인
  }
  if (candidate === shown) return false;
  // 손가락을 펴는 도중일 수 있어서 잠깐 확인. 양손바닥(10)은 동그라미 · 엑스를 만들려고
  // 손을 드는 중일 수도 있어서 조금 더 오래 확인
  const need = candidate === 10 ? PALMS_MS : STABLE_MS;
  if (now - candidateSince < need) return false;
  shown = candidate;
  return true;
}

// ===== 카메라 화면 위에 그리기 =====
function drawHud(now, handCount) {
  const action = actionFor(shown);
  const x = canvas.width - 120;
  const y = 120;
  const r = 78;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fill();

  // 숫자를 넣은 뒤 쉬는 동안: 남은 시간만큼 줄어드는 하늘색 둥근 막대
  if (now < waitUntil) {
    const left = (waitUntil - now) / AFTER_INPUT_MS;
    ctx.beginPath();
    ctx.arc(x, y, r - 6, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2);
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#2ec4f1';
    ctx.stroke();
  }

  // 방금 실행됐으면 잠깐 주황 테두리
  if (now < flashUntil) {
    ctx.beginPath();
    ctx.arc(x, y, r - 6, 0, Math.PI * 2);
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#ff9f1c';
    ctx.stroke();
  }

  // 가운데: 두 손 모양이면 ◯ / ✕, 아니면 손가락 수
  const big = pose === 'circle' ? '◯' : pose === 'x' ? '✕' : shown === null ? '?' : String(shown);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 84px "Malgun Gothic", sans-serif';
  ctx.fillText(big, x, y + 4);

  let caption;
  if (pose) caption = lastLabel || (poseAction(pose)?.label ?? '');
  else if (shown === null) caption = '손을 보여 주세요';
  else caption = lastLabel || action?.label || '';
  ctx.font = 'bold 24px "Malgun Gothic", sans-serif';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.strokeText(caption, x, y + r + 28);
  ctx.fillText(caption, x, y + r + 28);

  // 보이는 손 개수 (엑스 · 동그라미는 두 손이 다 보여야 해요)
  ctx.font = 'bold 18px "Malgun Gothic", sans-serif';
  ctx.fillStyle = handCount === 2 ? '#3ddc97' : '#c8d0da';
  const seen = `보이는 손 ${handCount}개`;
  ctx.strokeText(seen, x, y + r + 58);
  ctx.fillText(seen, x, y + r + 58);

  // 손목이 화면 안에 보이는지 (엑스는 두 손목이 화면 안에서 엇갈려야 알아볼 수 있어요)
  const wristsIn = poses.wristsVisible();
  ctx.fillStyle = wristsIn ? '#3ddc97' : '#c8d0da';
  const wristText = wristsIn ? '손목 2개 보임' : '손목이 화면 밖';
  ctx.strokeText(wristText, x, y + r + 84);
  ctx.fillText(wristText, x, y + r + 84);
  ctx.restore();
}

function loop() {
  requestAnimationFrame(loop);
  if (!running || !handsReady || video.readyState < 2) return;
  if (video.currentTime === lastVideoTime) return; // 새 화면이 아직 안 옴
  lastVideoTime = video.currentTime;

  const now = performance.now();
  const result = hands.detect(video, now);
  // 몸 인식(엑스용)은 3화면에 한 번만 (두 가지를 매번 다 하면 느려져서)
  if (frameNo++ % BODY_EVERY === 0) poses.detectBody(video, now);

  const posing = updatePose(result, now);
  if (posing) lastLabel = poseDone ? lastLabel : '';

  // 손가락 수가 바뀌면 바로 실행 (두 손 모양을 만드는 중에는 안 함)
  if (updateGesture(hands.countFingers(result), now, posing)) {
    const action = actionFor(shown);
    lastLabel = '';
    if (action?.run) done(action.label, action.run, now);
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.setTransform(-1, 0, 0, 1, canvas.width, 0); // 영상처럼 좌우 뒤집기
  hands.draw(result, drawingUtils, ctx);
  ctx.restore();
  drawHud(now, result.landmarks.length);

  frames++;
  if (now - fpsTime >= 1000) {
    $('fps').textContent = `${Math.round((frames * 1000) / (now - fpsTime))} FPS`;
    frames = 0;
    fpsTime = now;
  }
}

// ===== 카메라 켜기 / 끄기 =====
// GPU로 먼저 만들어 보고, 안 되면 CPU로 만들기
function makeCreate() {
  return async (TaskClass, options) => {
    try {
      return await TaskClass.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'GPU' } });
    } catch (err) {
      console.warn('GPU를 쓸 수 없어서 CPU로 바꿔요:', err);
      return TaskClass.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } });
    }
  };
}

async function startCamera() {
  const status = $('status');
  status.textContent = '카메라를 켜는 중…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    if (!match) { // 켜는 사이에 "처음으로"를 누름
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    video.srcObject = stream;
    await new Promise((resolve) => {
      video.onloadedmetadata = resolve;
    });
    await video.play();
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  } catch (err) {
    console.error(err);
    status.textContent = `카메라를 켜지 못했어요: ${err.message}`;
    return;
  }

  if (!handsReady) {
    status.textContent = '손 인식을 준비하는 중…';
    try {
      vision = await FilesetResolver.forVisionTasks('/node_modules/@mediapipe/tasks-vision/wasm');
      await hands.load(makeCreate());
      await poses.load(makeCreate()); // 몸 인식 (엑스 = 팔 엇갈림)
      handsReady = true;
    } catch (err) {
      console.error(err);
      status.textContent = `손 인식을 시작하지 못했어요: ${err.message}`;
      return;
    }
  }
  status.textContent = '';
  candidate = shown = pose = null;
  lastLabel = '';
  running = true;
}

function stopCamera() {
  running = false;
  const stream = video.srcObject;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
  lastVideoTime = -1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// 처음에는 시작 화면만 (카메라는 "게임 시작"을 눌러야 켜짐)
makeChoices($('levels'), game.LEVELS, '자리', () => level, (v) => { level = v; });
makeChoices($('targets'), game.TARGETS, '점', () => target, (v) => { target = v; });
showSetup();
requestAnimationFrame(loop);
