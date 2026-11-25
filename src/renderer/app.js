// ===== 반응 속도 측정기 =====
// 1. 설정 화면(카메라 꺼짐): 모드 · 횟수 고르기
// 2. 측정 화면(카메라 켜짐): 주먹 ✊ → 랜덤 시간 뒤 "지금!" → 검지 ☝ 를 펼 때까지의 시간을 잼 (정한 횟수만큼)
// 3. 결과 화면(카메라 꺼짐): 기록을 바탕으로 피드백 · 조언
import { FilesetResolver, DrawingUtils } from '/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs';
import * as hands from './hands.js';
import * as stadium from './stadium.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('overlay');
const ctx = canvas.getContext('2d');
const drawingUtils = new DrawingUtils(ctx);
const screen = $('screen');
const msgBig = $('msgBig');
const msgSmall = $('msgSmall');

// ----- 설정값 (숫자를 바꿔서 조절할 수 있어요) -----
const MIN_DELAY = 2000;        // 신호까지 기다리는 랜덤 시간 (ms) : 2 ~ 6초 사이
const MAX_DELAY = 6000;
const FIST_HOLD = 500;         // 주먹을 이만큼(ms) 유지하면 시작
const AFTER_RESULT = 800;      // 결과를 보여 준 뒤 이만큼은 다음 시작을 안 받음
const TO_FEEDBACK = 1500;      // 마지막 회 결과를 이만큼 보여 준 뒤 결과 화면으로
const TIMEOUT = 3000;          // 신호 뒤 이 시간 안에 검지를 안 펴면 시간 초과
const TOO_FAST = 100;          // 100ms보다 빠르면 신호를 보고 반응한 게 아니라 "찍은 것" → 부정 출발
const CONFIRM_FRAMES = 2;      // 검지가 연속 이만큼의 화면에서 보여야 인정 (한 화면짜리 잘못된 인식 막기)
const ROUND_CHOICES = [3, 5, 10, 15];

// 모드 2가지 = 공연 "회차" (시간은 둘 다 랜덤)
const MODES = [
  { id: 'hidden', label: '1회차 · 🎲 블라인드 오픈', short: '1회차 블라인드', desc: '언제 열릴지 몰라요 → 진짜 반응 속도' },
  { id: 'show', label: '2회차 · ⏱ 카운트다운 오픈', short: '2회차 카운트다운', desc: '오픈까지 남은 초가 3.2 → 3.1 → … 로 보여요' },
];

// 반응 속도 → 야구장 좌석 (빠를수록 홈플레이트에 가까운 좋은 자리)
//  id는 야구장 그림(stadium.js)의 구역 이름과 같음
const SEATS = [
  { id: 'vip', max: 250, name: '홈플레이트 VIP석', short: 'VIP석', line: '⚡ 번개 같은 반응 속도!' },
  { id: 'table', max: 350, name: '중앙 테이블석', short: '테이블석', line: '🚀 아주 빨라요!' },
  { id: 'infield', max: 450, name: '내야 지정석', short: '내야석', line: '👍 빠른 편이에요' },
  { id: 'outfield', max: 600, name: '외야 지정석', short: '외야석', line: '🙂 보통이에요' },
  { id: 'lawn', max: Infinity, name: '외야 잔디석', short: '잔디석', line: '🐢 조금 느린 편이에요' },
];
function seatOf(ms) {
  return SEATS.find((s) => ms < s.max);
}

// 티켓에 적을 자리 번호 (구역마다 블록 번호 범위가 다름, 잔디석은 자유석)
function seatNumber(seat) {
  const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const side = Math.random() < 0.5 ? '1루' : '3루';
  const rowSeat = `${rnd(1, 20)}열 ${rnd(1, 30)}번`;
  switch (seat.id) {
    case 'vip': return `${String(rnd(1, 4)).padStart(3, '0')}블록 ${rnd(1, 5)}열 ${rnd(1, 12)}번`;
    case 'table': return `${String(rnd(11, 24)).padStart(3, '0')}블록 ${rowSeat}`;
    case 'infield': return `${side} ${rnd(101, 130)}블록 ${rowSeat}`;
    case 'outfield': return `${side === '1루' ? '우익' : '좌익'} ${rnd(201, 230)}블록 ${rowSeat}`;
    default: return '중앙 잔디 자유석';
  }
}

// ----- 설정 -----
let mode = 'hidden';
let rounds = 5;

// ----- 상태 -----
// setup(설정) → idle(주먹 기다림) → count(랜덤 시간) → go(지금!) → result / foul → … → feedback(결과 화면)
let state = 'setup';
let waited = 0;               // 이번 매에서 주먹을 쥐고 기다린 시간 (손을 펴면 안 늘어남)
let lastTick = 0;
let fistHeld = false;         // 기다리는 동안 지금 주먹을 쥐고 있는지
let delay = 0;
let signalTime = 0;
let finishedAt = 0;
let fistSince = 0;
let armed = true;             // 주먹을 한 번 풀어야 다음 시작을 받음
let indexStreak = 0;
let indexFirstTime = 0;
let records = [];             // 이번 측정의 기록 { ms, kind: 'ok' | 'foul' | 'late' }
const lastAverage = {};       // 모드별 지난번 평균 (다음 결과에서 비교)
let audio = null;
let modelReady = false;
let camOn = false;
let camGen = 0;
let lastDetect = 0;

// ===== 1. 설정 화면 =====
function makeChoices(box, items, isOn, onPick) {
  box.innerHTML = '';
  items.forEach((item) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice';
    b.textContent = item.label;
    if (item.desc) { // 회차 카드: 아래에 작은 설명
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = item.desc;
      b.appendChild(sub);
    }
    if (isOn(item)) b.classList.add('on');
    b.addEventListener('click', () => {
      onPick(item);
      [...box.children].forEach((x) => x.classList.toggle('on', x === b));
      updateSummary();
    });
    box.appendChild(b);
  });
}

function showView(name) {
  $('setupView').hidden = name !== 'setup';
  $('testView').hidden = name !== 'test';
  $('resultView').hidden = name !== 'result';
  $('homeBtn').hidden = name !== 'test';
  $('setting').textContent = name === 'setup' ? '' : `${modeOf().short} · ${rounds}매`;

  // 예매 단계 표시: 측정 = 02 좌석 예매, 결과 = 03 예매 완료
  const step = { setup: 1, test: 2, result: 3 }[name];
  $('steps').hidden = name === 'setup';
  $('steps').querySelectorAll('li').forEach((li) => {
    const n = Number(li.dataset.step);
    li.classList.toggle('on', n === step);
    li.classList.toggle('done', n < step);
  });
}

function modeOf(id = mode) {
  return MODES.find((m) => m.id === id);
}

function updateSummary() {
  $('summary').textContent = `${modeOf().short} · ${rounds}매 · 0원`;
}

function showSetup() {
  state = 'setup';
  stopCamera();
  showView('setup');
  updateSummary();
}

makeChoices($('modes'), MODES, (m) => m.id === mode, (m) => { mode = m.id; });
makeChoices(
  $('rounds'),
  ROUND_CHOICES.map((n) => ({ n, label: `${n}매` })),
  (r) => r.n === rounds,
  (r) => { rounds = r.n; },
);

// ===== 2. 측정 시작: 이때 카메라를 켬 =====
async function startSession() {
  records = [];
  state = 'loading';
  showView('test');
  renderRecords();
  show('idle', '예매 페이지 접속 중…', '카메라를 켜고 있어요');
  if (!audio) audio = new AudioContext();
  if (audio.state === 'suspended') audio.resume();

  if (!(await startCamera())) return;
  if (!modelReady) {
    show('idle', '손 인식 준비 중…', '처음 한 번만 조금 걸려요');
    try {
      const vision = await FilesetResolver.forVisionTasks('/node_modules/@mediapipe/tasks-vision/wasm');
      await hands.load(makeCreate(vision));
      modelReady = true;
    } catch (err) {
      console.error(err);
      show('foul', '손 인식을 시작하지 못했어요', err.message);
      return;
    }
  }
  if (state !== 'loading') return; // 준비하는 사이에 "처음으로"를 누름
  state = 'idle';
  armed = true;
  showIdle();
}

function makeCreate(vision) {
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
  $('camState').textContent = '카메라 켜는 중…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
      audio: false,
    });
    if (state !== 'loading') { // 켜는 사이에 "처음으로"를 누름
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }
    video.srcObject = stream;
    await new Promise((resolve) => { video.onloadedmetadata = resolve; });
    await video.play();
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    // 무대를 카메라와 같은 가로:세로 비율로 (예: 1280 / 720 = 16:9, 640 / 480 = 4:3)
    screen.style.setProperty('--cam-ratio', `${video.videoWidth} / ${video.videoHeight}`);
    console.log('카메라 해상도', video.videoWidth, 'x', video.videoHeight);
    const fps = stream.getVideoTracks()[0].getSettings().frameRate;
    $('camState').textContent = `카메라 켜짐${fps ? ` · ${Math.round(fps)}fps` : ''}`;
    camOn = true;
    camGen++;
    nextFrame(camGen);
    return true;
  } catch (err) {
    console.error(err);
    $('camState').textContent = '카메라를 켤 수 없어요';
    show('foul', '카메라를 켤 수 없어요', '웹캠이 연결돼 있는지, 다른 프로그램이 쓰고 있지 않은지 확인하세요.');
    return false;
  }
}

function stopCamera() {
  camOn = false;
  const stream = video.srcObject;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  $('camState').textContent = '카메라 꺼짐';
}

// 카메라에 새 화면이 들어올 때마다 손 인식
// gen: 카메라를 켤 때마다 1씩 늘어나는 번호. 껐다 켜면 예전 반복은 멈추고 새 반복 하나만 돌게 함
function nextFrame(gen) {
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback((now, meta) => onFrame(gen, meta));
  else requestAnimationFrame(() => onFrame(gen, {}));
}

function onFrame(gen, meta) {
  if (!camOn || gen !== camGen) return; // 카메라를 끄면 멈춤
  const now = performance.now();
  // 카메라가 이 화면을 찍은 시각 (알 수 있으면 그걸 써야 더 정확함)
  const frameTime = meta && meta.captureTime ? meta.captureTime : now;
  if (modelReady && now > lastDetect) { // 손 인식에는 점점 커지는 시각을 넣어야 함
    lastDetect = now;
    const result = hands.detect(video, now);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hands.draw(result, drawingUtils, ctx);
    handleShape(hands.shape(result), frameTime, now);
  }
  nextFrame(gen);
}

// ===== 3. 손 모양에 따라 진행 =====
const SHAPE_LABEL = {
  none: '손이 안 보여요',
  fist: '✊ 주먹',
  index: '☝ 검지 펼침',
  other: '✋ 손 보임',
};

function handleShape(shape, frameTime, now) {
  $('handState').textContent = SHAPE_LABEL[shape];
  $('handState').className = `hand-state ${shape}`;

  if (shape === 'index') {
    indexStreak++;
    if (indexStreak === 1) indexFirstTime = frameTime;
  } else {
    indexStreak = 0;
  }
  const indexConfirmed = indexStreak >= CONFIRM_FRAMES;

  if (state === 'idle' || state === 'result' || state === 'foul') {
    if (shape !== 'fist') armed = true;
    const canStart = armed && now - finishedAt > AFTER_RESULT && records.length < rounds;
    if (shape === 'fist' && canStart) {
      if (!fistSince) fistSince = now;
      const p = Math.min((now - fistSince) / FIST_HOLD, 1);
      $('holdFill').style.width = `${p * 100}%`;
      if (p >= 1) startRound();
    } else {
      fistSince = 0;
      $('holdFill').style.width = '0%';
    }
  } else if (state === 'count') {
    // 기다리는 동안: 주먹을 쥐고 있을 때만 시간이 흐름. 손을 펴거나 손이 안 보이면 멈춤
    setFistHeld(shape === 'fist');
  } else if (state === 'go') {
    if (indexConfirmed) {
      // 검지를 처음 편 화면이 신호보다 먼저 찍혔거나 너무 빠르면 부정 출발
      // (남은 시간을 보여 주는 모드는 미리 준비할 수 있어서 "너무 빠름" 규칙을 안 씀)
      const ms = indexFirstTime - signalTime;
      const tooFast = mode === 'hidden' ? ms < TOO_FAST : ms < 0;
      finish(tooFast ? 'foul' : 'ok', ms);
    }
  }
}

function startRound() {
  state = 'count';
  armed = false;
  fistSince = 0;
  $('holdFill').style.width = '0%';
  waited = 0;
  lastTick = performance.now();
  delay = MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY);

  // 접속 대기 창 준비: 대기 인원은 랜덤으로 시작해서 줄어듦
  queue.start = 150 + Math.floor(Math.random() * 750);
  queue.tau = 1200 + Math.random() * 1300;          // 줄어드는 빠르기 (숨김 모드)
  queue.floor = 1 + Math.floor(Math.random() * 25); // 숨김 모드에서는 0까지 안 내려감 (오픈 시각을 알려 주지 않게)
  $('qLabel').textContent = mode === 'hidden' ? '현재 대기 시간' : '오픈까지 남은 시간';
  fistHeld = false;
  setFistHeld(true); // 주먹을 쥐어서 시작했으니 처음에는 시간이 흐르는 상태
  updateQueue(0);
  show('count', '', '');
}

// 주먹을 쥐고 있는지에 따라 대기 시간을 흐르게 / 멈추게 하고, 창 글자도 바꿈
function setFistHeld(held) {
  if (held === fistHeld) return;
  fistHeld = held;
  $('queue').classList.toggle('paused', !held);
  $('qTitle').textContent = held ? '접속 대기 중입니다.' : '대기가 멈췄어요';
  if (held) {
    $('qNote').innerHTML = mode === 'hidden'
      ? '주먹 ✊ 을 쥐고 있는 동안만 대기 시간이 흘러요.<br>"예매 오픈!"이 뜨면 검지 ☝ 를 펴세요.'
      : '주먹 ✊ 을 쥐고 있는 동안만 시간이 줄어요.<br>0이 되는 순간 예매가 열립니다.';
  } else {
    $('qNote').innerHTML = '손을 펴면 시간이 멈춰요.<br><b>주먹 ✊ 을 다시 쥐면</b> 이어서 기다려요.';
  }
}

// 접속 대기 창 숫자 바꾸기 (elapsed = 기다린 시간 ms)
const queue = { start: 0, tau: 0, floor: 0 };
function updateQueue(elapsed) {
  let people;
  if (mode === 'hidden') {
    // 기다린 시간이 올라감 00:00:01 → 00:00:02 …, 대기 인원은 오픈 시각과 상관없이 줄어듦
    $('qTime').textContent = clock(elapsed);
    people = Math.max(queue.floor, Math.round(queue.start * Math.exp(-elapsed / queue.tau)));
  } else {
    // 남은 시간이 줄어듦 00:03.2 → 00:03.1 …, 대기 인원도 오픈 때 0명
    const remain = Math.max(delay - elapsed, 0);
    $('qTime').textContent = `00:${secLeft(remain).padStart(4, '0')}`;
    people = Math.ceil(queue.start * (remain / delay));
  }
  $('qPeople').textContent = people.toLocaleString();
}

// ms → "00:00:05" (시:분:초)
function clock(ms) {
  const s = Math.floor(ms / 1000);
  const two = (n) => String(n).padStart(2, '0');
  return `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
}

// "중지" 버튼: 이번 매 기다리기를 그만둠 (기록 안 남음, 주먹을 풀었다가 다시 쥐면 다시 대기)
function stopWaiting() {
  if (state !== 'count') return;
  state = 'idle';
  armed = false;
  showIdle();
}

// 화면을 그릴 때마다 남은 시간 · 시간 초과 확인
function tick(now) {
  if (state === 'count') {
    // 주먹을 쥐고 있을 때만 기다린 시간(waited)이 늘어남
    const t = performance.now();
    if (fistHeld) waited += Math.max(t - lastTick, 0);
    lastTick = t;
    const remain = delay - waited;
    if (remain > 0) updateQueue(waited);
    if (remain <= 0) {
      state = 'go';
      signalTime = performance.now(); // 이 화면이 그려지는 시각이 신호 시각
      show('go', '예매 오픈!', '지금 검지를 펴세요! ☝');
      beep(1040, 0.2);
    }
  } else if (state === 'go' && performance.now() - signalTime > TIMEOUT) {
    finish('late');
  }
  requestAnimationFrame(tick);
}

function beep(freq, sec) {
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.value = freq;
  gain.gain.value = 0.15;
  osc.connect(gain).connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + sec);
}

function finish(kind, ms = null) {
  state = kind === 'ok' ? 'result' : 'foul';
  finishedAt = performance.now();
  records.push({ ms, kind });
  renderRecords();

  const done = records.length >= rounds;
  const next = done ? '예매 끝! 잠시 뒤 티켓이 나와요' : '다음 매: 주먹 ✊ 을 쥐세요';
  if (kind === 'ok') show('result', `🎟 ${seatOf(ms).short} 확보!`, `${fmt(ms)} · ${seatOf(ms).name} · ${next}`);
  else if (kind === 'foul') {
    const why = ms < 0 ? '오픈 전에 검지를 폈어요' : `${TOO_FAST / 1000}초보다 빨라요. 보고 반응한 게 아니라 찍었어요`;
    show('foul', '🚫 부정 예매', `${why} (매크로 의심 🤖) · ${next}`);
  }
  else show('foul', '매진되었습니다', `${TIMEOUT / 1000}초 안에 검지를 펴지 않았어요 · ${next}`);

  if (done) {
    setTimeout(() => {
      if (state === 'result' || state === 'foul') showFeedback();
    }, TO_FEEDBACK);
  }
}

// ===== 4. 측정 화면 표시 =====
function show(cls, big, small) {
  screen.className = `screen ${cls}`;
  msgBig.textContent = big;
  msgSmall.textContent = small;
  // 기다리는 동안에는 글자 대신 "접속 대기 중" 창을 띄움
  const waiting = cls === 'count';
  $('queue').hidden = !waiting;
  $('message').hidden = waiting;
}

function showIdle() {
  const how = mode === 'hidden' ? '언제 열릴지 몰라요' : '남은 시간이 보여요';
  show('idle', '주먹 ✊ 을 쥐면 대기열 입장', `랜덤 시간 뒤 "예매 오픈!"이 뜨면 검지 ☝ 를 펴세요 (${how})`);
}

// 남은 시간 (ms) → "3.2" 처럼 소수 첫째 자리까지 (0.0이 되기 전에는 0.1로 보이게 올림)
function secLeft(ms) {
  return (Math.ceil(ms / 100) / 10).toFixed(1);
}

function okTimes() {
  return records.filter((r) => r.kind === 'ok').map((r) => r.ms);
}

function average(list) {
  return list.reduce((a, b) => a + b, 0) / list.length;
}

function renderRecords() {
  const ok = okTimes();
  const last = records[records.length - 1];
  const best = ok.length ? Math.min(...ok) : null;

  $('progress').textContent = `${records.length} / ${rounds}`;
  $('lastTime').textContent = !last ? '-' : last.kind === 'ok' ? fmt(last.ms) : '실패';
  $('avgTime').textContent = ok.length ? fmt(average(ok)) : '-';
  $('bestTime').textContent = best !== null ? fmt(best) : '-';

  // 회차별 기록: 1회부터 차례로, 아직 안 한 회는 점선 칸
  const list = $('history');
  list.innerHTML = '';
  for (let i = 0; i < rounds; i++) {
    const r = records[i];
    const li = document.createElement('li');
    if (!r) {
      li.classList.add('todo');
      li.innerHTML = `<span class="no">${i + 1}매</span>-`;
    } else {
      const isBest = r.kind === 'ok' && r.ms === best;
      if (r.kind !== 'ok') li.classList.add('bad');
      if (isBest) li.classList.add('best');
      li.innerHTML = `<span class="no">${i + 1}매</span>${seatTag(r)}<span class="time">${label(r)}${isBest ? ' 🏆' : ''}</span>`;
    }
    list.appendChild(li);
  }
}

function label(r) {
  return r.kind === 'ok' ? fmt(r.ms) : r.kind === 'foul' ? '부정 예매' : '매진';
}

// 성공한 매는 앞에 좌석 등급 (예: R석 312 ms)
function seatTag(r) {
  return r.kind === 'ok' ? `<span class="seat">${seatOf(r.ms).short}</span>` : '';
}

function fmt(ms) {
  return `${Math.round(ms)} ms`;
}

// ===== 5. 결과 · 조언 화면 (카메라 끔) =====
function showFeedback() {
  state = 'feedback';
  stopCamera();
  showView('result');

  const ok = okTimes();
  const fouls = records.filter((r) => r.kind === 'foul').length;
  const lates = records.filter((r) => r.kind === 'late').length;
  const avg = ok.length ? average(ok) : null;
  const best = ok.length ? Math.min(...ok) : null;
  const worst = ok.length ? Math.max(...ok) : null;
  // 표준편차: 기록이 평균에서 보통 얼마나 벗어나는지 (작을수록 고름)
  const spread = ok.length >= 2 ? Math.sqrt(average(ok.map((x) => (x - avg) ** 2))) : null;

  $('resultSetting').textContent = `${modeOf().label} · ${rounds}매`;
  // 티켓 정보: 예매번호(오늘 날짜 + 랜덤 4자리), 관람일, 회차, 평균으로 정한 좌석 등급
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  $('tNo').textContent = `T${ymd}-${Math.floor(1000 + Math.random() * 9000)}`;
  $('tDate').textContent = `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
  $('tMode').textContent = modeOf().short;
  const mySeat = avg !== null ? seatOf(avg) : null;
  $('tSeat').textContent = mySeat ? mySeat.short : '매진';
  $('tSeatName').textContent = mySeat ? mySeat.name : '';
  $('tSeatNo').textContent = mySeat ? seatNumber(mySeat) : '';

  // 야구장 배치도: 평균으로 정한 내 자리는 빨갛게, 매마다 잡았던 구역에는 횟수 표시
  const counts = {};
  ok.forEach((ms) => { const id = seatOf(ms).id; counts[id] = (counts[id] || 0) + 1; });
  stadium.draw($('mapResult'), mySeat && mySeat.id, counts);
  stadium.legend($('legendResult'), SEATS, mySeat && mySeat.id, counts);
  $('rAvg').textContent = avg !== null ? fmt(avg) : '-';
  $('rBest').textContent = best !== null ? fmt(best) : '-';
  $('rWorst').textContent = worst !== null ? fmt(worst) : '-';
  $('rSpread').textContent = spread !== null ? fmt(spread) : '-';
  $('rOk').textContent = `${ok.length} / ${records.length}`;
  $('grade').textContent = grade(avg);

  // 회차별 막대 그래프 (막대가 길수록 느림)
  const chart = $('chart');
  chart.innerHTML = '';
  const max = Math.max(worst || 0, 600);
  records.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'chart-row';
    if (r.kind !== 'ok') row.classList.add('bad');
    if (r.kind === 'ok' && r.ms === best) row.classList.add('best');
    const seat = r.kind === 'ok' ? `${seatOf(r.ms).short} · ` : '';
    row.innerHTML = `<span class="no">${i + 1}매</span>
      <div class="track"><div class="fill"></div></div>
      <span class="val">${seat}${label(r)}${r.kind === 'ok' && r.ms === best ? ' 🏆' : ''}</span>`;
    // (보안 설정 때문에 style="..."를 글자로 못 넣어서 자바스크립트로 길이를 정함)
    row.querySelector('.fill').style.width = `${r.kind === 'ok' ? (r.ms / max) * 100 : 0}%`;
    chart.appendChild(row);
  });

  // 피드백 · 조언
  const advice = makeAdvice({ ok, fouls, lates, avg, best, spread });
  $('advice').innerHTML = advice.map((a) => `<li>${a}</li>`).join('');

  if (avg !== null) lastAverage[mode] = avg;
}

function grade(avg) {
  if (avg === null) return '😥 한 장도 예매하지 못했어요';
  return seatOf(avg).line;
}

function makeAdvice({ ok, fouls, lates, avg, best, spread }) {
  const list = [];

  if (!ok.length) {
    list.push('한 장도 예매하지 못했어요. 먼저 <b>손이 화면 가운데에 크게</b> 보이는지, 아래 손 상태에 <b>✊ 주먹</b> · <b>☝ 검지 펼침</b>이 제대로 뜨는지 확인해 보세요.');
  } else {
    // 지난번과 비교
    const prev = lastAverage[mode];
    if (prev !== undefined) {
      const diff = Math.round(avg - prev);
      if (diff <= -10) list.push(`지난번 평균보다 <b>${-diff} ms 빨라졌어요!</b> 연습한 효과가 있어요.`);
      else if (diff >= 10) list.push(`지난번 평균보다 <b>${diff} ms 느려졌어요.</b> 잠깐 쉬었다가 다시 해 보세요.`);
      else list.push('지난번과 거의 같은 기록이에요. 꾸준해요!');
    }

    const bestRound = records.findIndex((r) => r.kind === 'ok' && r.ms === best) + 1;
    list.push(`가장 빨랐던 건 <b>${bestRound}매째 ${fmt(best)} (${seatOf(best).name})</b>예요. 그때처럼 집중하면 평균도 더 빨라질 수 있어요.`);

    // 고른 정도
    if (spread !== null) {
      if (spread < 40) list.push(`기록이 <b>아주 고르게</b> 나왔어요 (± ${fmt(spread)}). 집중력이 좋아요!`);
      else if (spread < 90) list.push(`기록이 <b>고른 편</b>이에요 (± ${fmt(spread)}).`);
      else list.push(`기록이 <b>들쭉날쭉</b>해요 (± ${fmt(spread)}). 매번 <b>같은 자세</b>로 손을 두고, 화면 가운데를 보면서 기다려 보세요.`);
    }

    // 앞쪽 절반 vs 뒤쪽 절반
    if (ok.length >= 4) {
      const half = Math.floor(ok.length / 2);
      const first = average(ok.slice(0, half));
      const second = average(ok.slice(-half));
      if (second - first > 30) list.push(`뒤로 갈수록 <b>느려졌어요</b> (앞 ${fmt(first)} → 뒤 ${fmt(second)}). 지치거나 집중이 풀렸을 수 있어요. 중간에 손을 한 번 털고 쉬어 보세요.`);
      else if (first - second > 30) list.push(`뒤로 갈수록 <b>빨라졌어요</b> (앞 ${fmt(first)} → 뒤 ${fmt(second)}). 금방 익숙해지는 타입이에요!`);
    }
  }

  if (fouls) {
    list.push(mode === 'hidden'
      ? `부정 예매(0.1초보다 빠름)가 <b>${fouls}번</b> 있었어요. 언제 열릴지 <b>짐작하지 말고</b>, "예매 오픈!" 화면을 <b>본 다음</b> 움직이세요.`
      : `부정 예매가 <b>${fouls}번</b> 있었어요. 숫자가 <b>0이 된 다음</b> 펴야 해요. 너무 서두르지 마세요.`);
  }
  if (lates) {
    list.push(`매진이 <b>${lates}번</b> 있었어요. 검지를 <b>곧게 쭉</b> 펴야 인식돼요. 손이 너무 멀거나 어두우면 인식이 늦어요.`);
  }

  if (mode === 'show' && ok.length) {
    list.push('카운트다운 오픈은 미리 준비할 수 있어서 기록이 빨리 나와요. <b>1회차 🎲 블라인드 오픈</b>으로 진짜 반응 속도도 재 보세요.');
  } else if (mode === 'hidden' && avg !== null && avg < 350 && !fouls) {
    list.push('부정 예매 없이 이 정도면 정말 훌륭해요! <b>10매 · 15매</b>로 늘려서 꾸준함도 도전해 보세요.');
  }

  list.push('참고: 웹캠과 손 인식에도 시간이 조금 걸려서, 버튼을 누르는 테스트보다 기록이 <b>약 0.1초</b> 느리게 나올 수 있어요.');
  return list;
}

// ===== 6. 버튼 =====
$('startBtn').addEventListener('click', startSession);
$('againBtn').addEventListener('click', startSession);
$('setupBtn').addEventListener('click', showSetup);
$('homeBtn').addEventListener('click', showSetup); // 측정 도중 그만두기 (이번 기록은 버림)
$('qStop').addEventListener('click', stopWaiting);

// 야구장 좌석 배치도 (설정 화면: 안내용 / 결과 화면: 내 자리 표시)
stadium.draw($('mapSetup'));
stadium.legend($('legendSetup'), SEATS);

showSetup();
requestAnimationFrame(tick);
