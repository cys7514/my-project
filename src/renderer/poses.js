// 두 손 · 두 팔로 만드는 모양 알아보기 (진짜 웹캠 점검 기록으로 맞춘 기준)
//  · 동그라미 ◯ : 두 손 엄지 끝끼리 맞대고, 나머지 손가락은 서로를 향해 둥글게 (가운데는 빔)
//  · 엑스 ✕     : 두 팔(손목)을 엇갈림 → 손이 겹쳐서 손 인식이 손 하나로 보는 일이 많아서
//                  "몸 인식"(어깨 · 손목 위치)으로 알아봐요
// 손 점 번호: 0 손목, 4 엄지 끝, 5 검지 뿌리, 8 검지 끝, 9 중지 뿌리, 12 중지 끝, 16 약지 끝

import { PoseLandmarker } from '/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs';

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// ===== 동그라미 =====
// 점검 기록: 동그라미는 엄지끼리 간격이 손바닥 길이의 0.31배 이하, 위쪽 손가락 끝끼리 1.15배 이하,
//            손가락이 다른 손 쪽을 향함(0.26 이상)
//            양손바닥은 엄지끼리 0.42배 이상, 손가락이 위를 향함(0.14 이하) → 겹치지 않음
const THUMB_TOUCH = 0.45;  // 엄지 끝끼리 손바닥 길이의 이만큼보다 가까움
const TOP_NEAR = 1.3;      // 위쪽 손가락 끝끼리 이만큼보다 가까움 (꼭 맞닿지 않아도 됨)
const INWARD = 0.2;        // 두 손 모두 손가락이 다른 손 쪽을 이만큼 이상 향함
const HOLE = 0.6;          // 가운데 빈 곳이 손바닥 길이의 이만큼은 돼야 함 (박수와 구분)
// 점검 2 기록: 손바닥을 붙여 엄지끼리 닿게 든 양손바닥은 손가락이 똑바로 위(0.96 이상),
//              동그라미는 손가락이 둥글게 기울어짐(0.67 이하) → 둘 다 위를 향하면 동그라미 아님
const UPRIGHT = 0.85;

function center(h) {
  const ids = [0, 5, 9, 13, 17];
  return { x: ids.reduce((s, i) => s + h[i].x, 0) / 5, y: ids.reduce((s, i) => s + h[i].y, 0) / 5 };
}

// 손가락(검지 · 중지 끝 평균)이 다른 손 쪽을 얼마나 향하는지 (1 = 정확히 그쪽, 0 = 옆, 음수 = 반대쪽)
function inward(h, other) {
  const tip = mid(h[8], h[12]);
  const dir = { x: tip.x - h[9].x, y: tip.y - h[9].y };
  const c = center(h);
  const o = center(other);
  const to = { x: o.x - c.x, y: o.y - c.y };
  return (dir.x * to.x + dir.y * to.y) / (Math.hypot(dir.x, dir.y) * Math.hypot(to.x, to.y) || 1);
}

export function isCircle(result, aspect) {
  if (result.landmarks.length !== 2) return false;
  const [a, b] = result.landmarks.map((pts) => pts.map((p) => ({ x: p.x * aspect, y: p.y })));
  const palm = (dist(a[0], a[9]) + dist(b[0], b[9])) / 2;

  const top = [8, 12, 16]
    .map((i) => ({ gap: dist(a[i], b[i]), at: mid(a[i], b[i]) }))
    .reduce((best, t) => (t.gap < best.gap ? t : best));
  const bottom = { gap: dist(a[4], b[4]), at: mid(a[4], b[4]) };

  // 손가락(중지 뿌리 → 끝)이 똑바로 위를 향하는 정도 (1 = 똑바로 위)
  const upright = (h) => (h[9].y - h[12].y) / (dist(h[9], h[12]) || 1);

  return bottom.gap < palm * THUMB_TOUCH                 // 엄지 끝끼리 맞닿음
      && Math.max(upright(a), upright(b)) < UPRIGHT      // 손가락이 똑바로 위가 아님 (양손바닥과 구분)
      && top.gap < palm * TOP_NEAR                       // 위쪽 손가락 끝끼리 가까움
      && Math.min(inward(a, b), inward(b, a)) > INWARD   // 손가락이 서로를 향해 둥글게
      && dist(top.at, bottom.at) > palm * HOLE           // 위아래로 벌어져 있고
      && dist(a[9], b[9]) > palm * HOLE;                 // 두 손바닥이 양옆으로 떨어져 있음
}

// ===== 엑스 (몸 인식) =====
// 몸 점 번호: 11 왼쪽 어깨, 12 오른쪽 어깨, 15 왼쪽 손목, 16 오른쪽 손목
// 팔을 엇갈리면 두 손목의 왼쪽 · 오른쪽 순서가 어깨 순서와 반대가 됨
// (그냥 나란히 든 양손바닥은 손목 순서가 어깨와 같아서 엑스가 될 수 없음)
const MODEL = '/models/pose_landmarker_lite.task';
const CROSS_MARGIN = 0.1;  // 손목이 어깨 너비의 이만큼 이상 반대쪽으로 넘어가야 엇갈림 (손목이 딱 붙어 있을 때 흔들림 방지)
const SEEN = 0.4;          // 손목 · 어깨가 이만큼 이상 확실히 보여야 함

let poser = null;
let lastPose = null;       // 가장 최근 몸 인식 결과

export async function load(create) {
  poser = await create(PoseLandmarker, {
    baseOptions: { modelAssetPath: MODEL },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
}

// 몸 인식 (손 인식보다 덜 자주 해도 돼서 app.js에서 몇 화면에 한 번씩 부름)
export function detectBody(video, time) {
  if (!poser) return;
  const r = poser.detectForVideo(video, time);
  lastPose = r.landmarks[0] || null;
}

function onScreen(q) {
  return q.x > 0 && q.x < 1 && q.y > 0 && q.y < 0.98;
}

// 손목이 둘 다 화면 안에 보이는지 (화면에 "손목이 화면 밖이에요" 안내용)
export function wristsVisible() {
  if (!lastPose) return false;
  return onScreen(lastPose[15]) && onScreen(lastPose[16]);
}

export function isX() {
  const p = lastPose;
  if (!p) return false;
  const [ls, rs, lw, rw] = [p[11], p[12], p[15], p[16]];
  if ([ls, rs, lw, rw].some((q) => (q.visibility ?? 1) < SEEN)) return false;
  // 점검 2 기록: 손목이 화면 밖(아래)으로 나가면 위치를 짐작만 해서 틀림 → 화면 안에 있을 때만
  if (!onScreen(lw) || !onScreen(rw)) return false;
  const shoulderSide = ls.x - rs.x;            // 어깨: 왼쪽 - 오른쪽
  const width = Math.abs(shoulderSide);
  if (width < 0.02) return false;               // 옆으로 서 있으면 판단 안 함
  const wristSide = (lw.x - rw.x) * Math.sign(shoulderSide); // 어깨와 같은 방향이면 +, 반대면 -
  return wristSide < -width * CROSS_MARGIN;     // 손목 순서가 어깨와 반대 → 엇갈림
}

// 화면에 그리기용: 어깨 · 손목 위치 (없으면 null)
export function bodyPoints() {
  if (!lastPose) return null;
  return [11, 12, 15, 16].map((i) => lastPose[i]);
}
