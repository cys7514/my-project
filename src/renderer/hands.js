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
  return landmarker.detectForVideo(video, time);
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
// 8이 9로 나오는 문제 → 접힌 손가락(특히 엄지)을 펴진 걸로 세지 않게 기준을 엄격하게 함
const THUMB_STRAIGHT = 0.6;    // 엄지 마디가 이만큼 곧아야 펴짐
const FINGER_STRAIGHT = 0.5;   // 나머지 손가락이 이만큼 곧아야 펴짐
const THUMB_AWAY = 0.6;        // 엄지 끝이 검지 뿌리에서 손바닥 길이의 이만큼 떨어져야 펴짐

function fingersUp(world) {
  const wrist = world[0];
  const palm = dist(world[0], world[9]); // 손바닥 길이 (손목 ~ 중지 뿌리)

  // 엄지: ① 엄지 마디(2-3-4)가 곧고 ② 끝이 검지 뿌리(5)에서 충분히 떨어져 있고 ③ 새끼 뿌리(17)에서 멀어지는 쪽
  const thumb = straightness(world[2], world[3], world[4]) > THUMB_STRAIGHT
             && dist(world[4], world[5]) > palm * THUMB_AWAY
             && dist(world[4], world[17]) > dist(world[3], world[17]);

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
