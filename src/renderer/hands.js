// 손 인식 (4차시 motion-cam의 hands.js + fingers.js에서 가져옴)
import { HandLandmarker } from '/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs';

const MODEL = '/models/hand_landmarker.task';

// 손가락마다 색 (엄지 빨강 / 검지 주황 / 중지 노랑 / 약지 초록 / 새끼 보라)
export const FINGER_COLORS = ['#ff4d4d', '#ff9f1c', '#ffe14d', '#3ddc97', '#b77dff'];
const PALM_COLOR = '#2ec4f1';
const FOLDED_COLOR = '#8a94a3';

// 엄지부터 새끼까지 손가락 끝 / 둘째 마디 점 번호
const TIPS = [4, 8, 12, 16, 20];
const PIPS = [3, 6, 10, 14, 18];

const FINGER_CONNECTIONS = FINGER_COLORS.map((_, f) => {
  const base = f * 4 + 1;
  const chain = f === 0 ? [0, 1, 2, 3, 4] : [base, base + 1, base + 2, base + 3];
  return chain.slice(1).map((end, k) => ({ start: chain[k], end }));
});
const PALM_CONNECTIONS = [[0, 5], [5, 9], [9, 13], [13, 17], [17, 0]].map(([start, end]) => ({ start, end }));

let landmarker = null;

export async function load(create) {
  landmarker = await create(HandLandmarker, {
    baseOptions: { modelAssetPath: MODEL },
    runningMode: 'VIDEO',
    numHands: 2,
  });
}

export function detect(video, time) {
  return removeDuplicateHand(landmarker.detectForVideo(video, time));
}

// 한 손을 두 번 겹쳐서 잡는 경우가 있음 (1을 보여 줬는데 1 + 1 = 2로 세어짐)
// 점검 기록: 진짜 두 손은 손 중심끼리 손바닥 길이의 0.98배 이상 떨어져 있었고, 겹쳐 잡힌 손은 0.08 ~ 0.41배
// → 0.7배보다 가까우면 같은 손으로 보고, 더 확실한(점수가 높은) 손 하나만 남김
const SAME_HAND = 0.7;

function removeDuplicateHand(result) {
  if (result.landmarks.length !== 2) return result;
  const [a, b] = result.landmarks;
  const ids = [0, 5, 9, 13, 17];
  const center = (h) => ({ x: ids.reduce((s, i) => s + h[i].x, 0) / 5, y: ids.reduce((s, i) => s + h[i].y, 0) / 5 });
  const gap = Math.hypot(center(a).x - center(b).x, center(a).y - center(b).y);
  const palm = (Math.hypot(a[0].x - a[9].x, a[0].y - a[9].y) + Math.hypot(b[0].x - b[9].x, b[0].y - b[9].y)) / 2;
  if (gap >= palm * SAME_HAND) return result;

  const score = (i) => result.handedness[i]?.[0]?.score ?? 0;
  const keep = score(0) >= score(1) ? 0 : 1;
  return {
    landmarks: [result.landmarks[keep]],
    worldLandmarks: [result.worldLandmarks[keep]],
    handedness: [result.handedness[keep]],
  };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// 두 마디가 얼마나 일직선인지 (1 = 완전히 곧음, 0 = 직각, 음수 = 꺾여서 뒤로)
function straightness(a, b, c) {
  const v1 = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const v2 = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
  return dot / (Math.hypot(v1.x, v1.y, v1.z) * Math.hypot(v2.x, v2.y, v2.z) || 1);
}

// 손가락이 펴졌는지 [엄지, 검지, 중지, 약지, 새끼] (worldLandmarks = 실제 크기 3D 좌표)
// 진짜 웹캠 점검 기록으로 맞춘 기준
//  · 검지 ~ 새끼: 펴면 곧음 0.78 이상, 접으면 0.25 이하 → 0.5로 충분히 구분됨
//  · 엄지: 펴면 손바닥 반대쪽으로 벌어져서 엄지 끝이 새끼손가락 뿌리(17)에서 멀어짐
//          → "엄지 마디가 곧음(0.8 이상) + 엄지 끝이 새끼 뿌리에서 손바닥 길이 x 0.87 이상 떨어짐"이면 펴짐
//          (점검 2 기록: 엄지 정확도 73% → 91%, 숫자 15단계 모두 정답)
const THUMB_STRAIGHT = 0.8;    // 엄지 마디가 이만큼 곧아야 펴짐
const FINGER_STRAIGHT = 0.5;   // 나머지 손가락이 이만큼 곧아야 펴짐
const THUMB_OPEN = 0.87;       // 엄지 끝이 새끼 뿌리에서 손바닥 길이의 이만큼 떨어져야 펴짐
const THUMB_OFF_MIDDLE = 0.5;  // 엄지 끝이 중지 둘째 마디에서 손바닥 길이의 이만큼 떨어져야 펴짐

function fingersUp(world) {
  const wrist = world[0];
  const palm = dist(world[0], world[9]); // 손바닥 길이 (손목 ~ 중지 뿌리)

  // 엄지: ① 엄지 마디(2-3-4)가 곧고 ② 끝이 새끼 뿌리(17)에서 충분히 떨어져 있음 (손바닥 밖으로 벌어짐)
  //       ③ 끝이 중지 둘째 마디(10)에서도 떨어져 있음 (숫자 1처럼 엄지를 중지 위에 얹으면 0.26 ~ 0.34,
  //          진짜 펴면 0.63 이상 → 1이 2로 세어지는 것 막기)
  const thumb = straightness(world[2], world[3], world[4]) > THUMB_STRAIGHT
             && dist(world[4], world[17]) > palm * THUMB_OPEN
             && dist(world[4], world[10]) > palm * THUMB_OFF_MIDDLE;

  // 나머지: ① 끝이 둘째 마디보다 손목에서 멀고 ② 뿌리-둘째 마디-끝이 곧게 펴져 있음
  const others = [1, 2, 3, 4].map((f) => {
    const mcp = world[TIPS[f] - 3];
    const pip = world[PIPS[f]];
    const tip = world[TIPS[f]];
    return dist(wrist, tip) > dist(wrist, pip) && straightness(mcp, pip, tip) > FINGER_STRAIGHT;
  });
  return [thumb, ...others];
}

// 보이는 손들의 펴진 손가락 수 합계 (손이 없으면 null)
export function countFingers(result) {
  if (!result.landmarks.length) return null;
  let total = 0;
  result.worldLandmarks.forEach((world) => {
    total += fingersUp(world).filter(Boolean).length;
  });
  return total;
}

// 양손 가위 (가위바위보의 가위: 엄지 + 검지를 편 L자 모양) → 검지가 가리키는 방향
//  · 엄지는 인식이 가끔 흔들려서, 엄지는 펴졌든 접혔든 상관없이 "검지만 펴고 중지 · 약지 · 새끼는 접힘"이면 가위
//  'left' · 'right' : 두 손 모두 검지로 같은 쪽 옆을 가리킴 (화면에서 보이는 방향 = 거울 화면 기준)
//  'up'             : 가위 모양이지만 옆을 가리키지 않음
//  null             : 양손 가위가 아님
export function scissors(result, aspect) {
  if (result.landmarks.length !== 2) return null;
  const isL = result.worldLandmarks.every((w) => {
    const [, index, middle, ring, pinky] = fingersUp(w);
    return index && !middle && !ring && !pinky;
  });
  if (!isL) return null;

  const dirs = result.landmarks.map((p) => {
    // 검지 뿌리(5) → 검지 끝(8)
    const vx = (p[8].x - p[5].x) * aspect;
    const vy = p[8].y - p[5].y;
    if (Math.abs(vx) < Math.abs(vy)) return 'up'; // 옆보다 위아래를 더 가리킴
    return vx > 0 ? 'left' : 'right';             // 카메라 원본은 거울 화면과 좌우가 반대
  });
  return dirs[0] === dirs[1] && dirs[0] !== 'up' ? dirs[0] : 'up';
}

// 손 뼈대 그리기 (펴진 손가락 끝은 손가락 색, 접힌 손가락 끝은 회색 동그라미)
export function draw(result, drawingUtils, ctx) {
  result.landmarks.forEach((points, i) => {
    const up = fingersUp(result.worldLandmarks[i]);
    drawingUtils.drawConnectors(points, PALM_CONNECTIONS, { color: PALM_COLOR, lineWidth: 4 });
    FINGER_CONNECTIONS.forEach((connections, f) => {
      drawingUtils.drawConnectors(points, connections, { color: up[f] ? FINGER_COLORS[f] : FOLDED_COLOR, lineWidth: 5 });
    });
    TIPS.forEach((tip, f) => {
      const p = points[tip];
      ctx.beginPath();
      ctx.arc(p.x * ctx.canvas.width, p.y * ctx.canvas.height, up[f] ? 11 : 7, 0, Math.PI * 2);
      ctx.fillStyle = up[f] ? FINGER_COLORS[f] : FOLDED_COLOR;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    });
  });
}
