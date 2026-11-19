// MediaPipe 손 · 몸 인식 모델을 models 폴더에 내려받기 (npm run models)
const https = require('https');
const fs = require('fs');
const path = require('path');

const MODELS = {
  'hand_landmarker.task':
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  'pose_landmarker_lite.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
};

const dir = path.join(__dirname, '..', 'models');
fs.mkdirSync(dir, { recursive: true });

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`${url} → HTTP ${res.statusCode}`));
      }
      const tmp = `${dest}.part`;
      const file = fs.createWriteStream(tmp);
      res.pipe(file);
      file.on('finish', () => file.close(() => {
        fs.renameSync(tmp, dest);
        resolve();
      }));
      file.on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  for (const [name, url] of Object.entries(MODELS)) {
    const dest = path.join(dir, name);
    if (fs.existsSync(dest)) {
      console.log(`이미 있음: ${name}`);
      continue;
    }
    console.log(`내려받는 중: ${name}`);
    await download(url, dest);
    console.log(`완료: ${name} (${fs.statSync(dest).size} bytes)`);
  }
})().catch((err) => {
  console.error('모델을 내려받지 못했어요:', err.message);
  process.exit(1);
});
