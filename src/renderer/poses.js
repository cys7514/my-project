// 두 손으로 만드는 모양 알아보기
//  · 동그라미 ◯ : 두 손의 손가락 끝끼리, 엄지 끝끼리 맞대서 가운데가 빈 큰 동그라미
//  · 엑스 ✕     : 두 손목을 엇갈려서 교차
// 점 번호: 0 손목, 4 엄지 끝, 8 검지 끝, 9 중지 뿌리, 12 중지 끝, 16 약지 끝

const TOUCH = 0.7;  // 손바닥 길이의 이만큼보다 가까우면 "맞댔다"
const HOLE = 0.6;   // 동그라미 가운데 빈 곳이 손바닥 길이의 이만큼은 돼야 함 (박수와 구분)

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// 화면 비율을 곱해서 가로 · 세로 길이 단위를 맞춘 두 손의 점들 (손이 둘이 아니면 null)
function twoHands(result, aspect) {
  if (result.landmarks.length !== 2) return null;
  return result.landmarks.map((pts) => pts.map((p) => ({ x: p.x * aspect, y: p.y })));
}

export function isCircle(result, aspect) {
  const hands = twoHands(result, aspect);
  if (!hands) return false;
  const [a, b] = hands;
  const palm = (dist(a[0], a[9]) + dist(b[0], b[9])) / 2;

  // 위쪽: 검지 · 중지 · 약지 끝 중 같은 손가락끼리 가장 가까운 것
  const tops = [8, 12, 16].map((i) => ({ gap: dist(a[i], b[i]), at: mid(a[i], b[i]) }));
  const top = tops.reduce((best, t) => (t.gap < best.gap ? t : best));
  // 아래쪽: 엄지 끝끼리
  const bottom = { gap: dist(a[4], b[4]), at: mid(a[4], b[4]) };

  return top.gap < palm * TOUCH                  // 위쪽 손가락 끝끼리 맞닿음
      && bottom.gap < palm * TOUCH               // 아래쪽 엄지 끝끼리 맞닿음
      && dist(top.at, bottom.at) > palm * HOLE   // 위아래로 벌어져 있고
      && dist(a[9], b[9]) > palm * HOLE;         // 두 손바닥이 양옆으로 떨어져 있음 (가운데가 빔, 박수와 구분)
}

// ----- 엑스 -----
// 팔을 엇갈리면 팔뚝에서 교차해서, 손만 보면 그냥 V자로 든 손과 똑같아 보여요.
// 그래서 "왼손 · 오른손이 서로 자리를 바꿨는지"로 알아봐요.
//  · 손 인식이 알려 주는 왼손(Left) · 오른손(Right)과 화면에서의 왼쪽 · 오른쪽 순서를 비교
//  · 평소(두 손이 멀리 떨어져 있을 때) 순서를 기억해 두고, 그 순서가 뒤집히면 엇갈린 것
const FAR = 2.5;    // 손목끼리 손바닥 길이의 이만큼보다 멀면 "평소 자세"로 보고 순서를 기억
const NEAR = 2.5;   // 엑스일 때 손목끼리 이만큼보다 가까워야 함
let normalSide = 1; // 평소에 (왼손 x - 오른손 x)의 부호 (처음엔 4차시에 확인한 대로: 카메라 원본에서 왼손이 오른쪽)

function centerX(h) {
  return [0, 5, 9, 13, 17].reduce((s, i) => s + h[i].x, 0) / 5;
}

// 방법 ②: 손목 두 개가 딱 붙어 있고, 두 손이 V자로 벌어져 있음
// (왼손 · 오른손 구분이 틀려도 알아볼 수 있게. 엇갈린 팔은 손목이 붙고 손이 양쪽으로 벌어져 보임)
// (진짜 웹캠 기록: 엑스는 손목 간격이 손바닥 길이의 0.1 ~ 1.0배, 손바닥 쪽 간격이 손목보다 넓음, 각도 30 ~ 55도
//                  동그라미는 손바닥 쪽 간격이 손목보다 좁음 → 이 차이로 구분)
const X_WRIST_NEAR = 1.6;  // 손목끼리 손바닥 길이의 이만큼 안
const X_SPREAD = 1.2;      // 손바닥 쪽 간격이 손목 간격의 이만큼보다 넓음
const X_ANGLE = 25;        // 두 손 방향이 이 각도(도) 이상 벌어짐

function wristsTogetherV(a, b) {
  const palm = (dist(a[0], a[9]) + dist(b[0], b[9])) / 2;
  const wristGap = dist(a[0], b[0]);
  if (wristGap > palm * X_WRIST_NEAR) return false;                 // 손목끼리 가까움
  if (dist(a[9], b[9]) <= wristGap * X_SPREAD) return false;        // 손바닥 쪽이 더 벌어짐 (V자)
  const u = { x: a[9].x - a[0].x, y: a[9].y - a[0].y };
  const v = { x: b[9].x - b[0].x, y: b[9].y - b[0].y };
  const cos = (u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y));
  return cos < Math.cos((X_ANGLE * Math.PI) / 180);                  // 두 손 방향이 벌어짐
}

export function isX(result, aspect) {
  const hands = twoHands(result, aspect);
  if (!hands) return false;
  if (wristsTogetherV(hands[0], hands[1])) return true;     // 방법 ②

  // 방법 ①: 왼손 · 오른손이 서로 자리를 바꿨는지
  const labels = result.handedness.map((h) => h?.[0]?.categoryName);
  const li = labels.indexOf('Left');
  const ri = labels.indexOf('Right');
  if (li < 0 || ri < 0) return false; // 왼손 · 오른손이 하나씩 보여야 함

  const L = hands[li];
  const R = hands[ri];
  const palm = (dist(L[0], L[9]) + dist(R[0], R[9])) / 2;
  const wristGap = dist(L[0], R[0]);
  const side = Math.sign(centerX(L) - centerX(R));
  if (side === 0) return false;

  if (wristGap > palm * FAR) { // 멀리 떨어진 평소 자세 → 순서 기억
    normalSide = side;
    return false;
  }
  return side !== normalSide && wristGap < palm * NEAR; // 순서가 뒤집혔고 손목이 가까움 → 엑스
}
