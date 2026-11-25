// ===== 야구장 좌석 배치도 (SVG로 그림) =====
// 위에서 내려다본 야구장. 홈플레이트가 아래 가운데, 오른쪽이 1루 · 왼쪽이 3루.
// 각 좌석 구역은 홈플레이트를 중심으로 한 "부채꼴 띠" 모양 (반지름 r1 ~ r2, 각도 a1 ~ a2)
// 각도: 오른쪽 = 0°, 위쪽 = -90°, 아래쪽 = 90° (SVG는 y가 아래로 커지기 때문)

const HOME = { x: 200, y: 250 };

// 구역 id는 app.js의 SEATS와 같음. 한 구역이 두 덩어리(1루 쪽 · 3루 쪽)일 수도 있음
const ZONES = [
  { id: 'vip', parts: [[14, 30, 45, 135]], label: [[0, 22, 90]] },
  { id: 'table', parts: [[36, 62, -5, 185]], label: [[0, 50, 90]] },
  { id: 'infield', parts: [[72, 172, -42, -8], [72, 172, -172, -138]], label: [[1, 128, -25], [1, 128, -155]] },
  { id: 'outfield', parts: [[182, 214, -134, -102], [182, 214, -78, -46]], label: [[2, 198, -118], [2, 198, -62]] },
  { id: 'lawn', parts: [[182, 222, -100, -80]], label: [[0, 202, -90]] },
];
// 구역 이름 (그림 안에 쓸 짧은 글자). label의 첫 번째 숫자: 0 = 그냥, 1 = 1루/3루, 2 = 우익/좌익
const ZONE_TEXT = { vip: 'VIP', table: '테이블석', infield: '내야', outfield: '외야', lawn: '잔디' };

function pt(r, deg) {
  const a = (deg * Math.PI) / 180;
  return [(HOME.x + r * Math.cos(a)).toFixed(1), (HOME.y + r * Math.sin(a)).toFixed(1)];
}

// 부채꼴 띠 모양 경로
function band(r1, r2, a1, a2) {
  const large = a2 - a1 > 180 ? 1 : 0;
  const [x1, y1] = pt(r2, a1);
  const [x2, y2] = pt(r2, a2);
  const [x3, y3] = pt(r1, a2);
  const [x4, y4] = pt(r1, a1);
  return `M${x1},${y1} A${r2},${r2} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${r1},${r1} 0 ${large} 0 ${x4},${y4} Z`;
}

function sideName(kind, deg) {
  const right = Math.cos((deg * Math.PI) / 180) > 0;
  if (kind === 1) return right ? '1루 ' : '3루 ';
  if (kind === 2) return right ? '우익 ' : '좌익 ';
  return '';
}

// 배치도 그리기
//  mine   : 내 자리 구역 id (빨갛게 강조, 없으면 null)
//  counts : { 구역 id: 그 구역을 잡은 횟수 } (있으면 글자 옆에 ×2 처럼 표시)
export function draw(box, mine = null, counts = {}) {
  const [b1x, b1y] = pt(62, -45);  // 1루
  const [b2x, b2y] = pt(88, -90);  // 2루
  const [b3x, b3y] = pt(62, -135); // 3루
  const [d1x, d1y] = pt(80, -45);  // 내야 흙 (베이스보다 조금 크게)
  const [d2x, d2y] = pt(113, -90);
  const [d3x, d3y] = pt(80, -135);
  const [mx, my] = pt(44, -90);    // 투수 마운드

  let zones = '';
  let labels = '';
  ZONES.forEach((z) => {
    const cls = `zone zone-${z.id}${z.id === mine ? ' mine' : ''}`;
    z.parts.forEach((p) => { zones += `<path class="${cls}" d="${band(...p)}"/>`; });
    z.label.forEach(([kind, r, deg]) => {
      const [x, y] = pt(r, deg);
      // (몇 번 잡았는지는 옆 안내에 표시)
      labels += `<text class="zone-text${z.id === mine ? ' mine' : ''}" x="${x}" y="${y}">${sideName(kind, deg)}${ZONE_TEXT[z.id]}</text>`;
    });
  });

  // 내 자리 핀
  let pin = '';
  if (mine) {
    const z = ZONES.find((zz) => zz.id === mine);
    const [, r, deg] = z.label[0];
    const [x, y] = pt(r, deg);
    pin = `<g class="pin"><rect x="${Number(x) - 26}" y="${Number(y) - 30}" width="52" height="17" rx="8"/>`
        + `<text x="${x}" y="${Number(y) - 18}">내 자리</text></g>`;
  }

  box.innerHTML = `<svg class="stadium" viewBox="0 0 400 330" role="img" aria-label="야구장 좌석 배치도">
    <path class="field" d="${band(0.1, 176, -135, -45)}"/>
    <polygon class="dirt" points="${HOME.x},${HOME.y + 8} ${d1x},${d1y} ${d2x},${d2y} ${d3x},${d3y}"/>
    <polygon class="infield-grass" points="${HOME.x},${HOME.y - 10} ${pt(50, -45)} ${pt(72, -90)} ${pt(50, -135)}"/>
    <line class="foul" x1="${HOME.x}" y1="${HOME.y}" x2="${pt(176, -45)[0]}" y2="${pt(176, -45)[1]}"/>
    <line class="foul" x1="${HOME.x}" y1="${HOME.y}" x2="${pt(176, -135)[0]}" y2="${pt(176, -135)[1]}"/>
    <circle class="mound" cx="${mx}" cy="${my}" r="5"/>
    <rect class="base" x="${b1x - 4}" y="${b1y - 4}" width="8" height="8" transform="rotate(45 ${b1x} ${b1y})"/>
    <rect class="base" x="${b2x - 4}" y="${b2y - 4}" width="8" height="8" transform="rotate(45 ${b2x} ${b2y})"/>
    <rect class="base" x="${b3x - 4}" y="${b3y - 4}" width="8" height="8" transform="rotate(45 ${b3x} ${b3y})"/>
    <polygon class="base" points="${HOME.x - 5},${HOME.y - 4} ${HOME.x + 5},${HOME.y - 4} ${HOME.x + 5},${HOME.y + 1} ${HOME.x},${HOME.y + 5} ${HOME.x - 5},${HOME.y + 1}"/>
    ${zones}
    ${labels}
    ${pin}
  </svg>`;
}

// 배치도 옆 안내: 색 · 구역 이름 · 반응 속도 범위
export function legend(box, seats, mine = null, counts = {}) {
  let prev = 0;
  box.innerHTML = seats.map((s) => {
    const range = s.max === Infinity ? `${prev}ms 이상` : `${prev ? `${prev} ~ ` : ''}${s.max}ms 미만`;
    prev = s.max;
    const n = counts[s.id] ? `<b class="cnt">×${counts[s.id]}</b>` : '';
    return `<li class="${s.id === mine ? 'mine' : ''}"><span class="swatch zone-${s.id}"></span>`
         + `<span class="lg-name">${s.name}</span><span class="lg-range">${range}</span>${n}</li>`;
  }).join('');
}
