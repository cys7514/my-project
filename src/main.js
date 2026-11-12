const { app, BrowserWindow, protocol, session } = require('electron');
const path = require('path');
const fs = require('fs/promises');

// 프로젝트 폴더(number-baseball)를 app://local/ 주소로 보여 주기
// file:// 로는 MediaPipe가 모델·wasm 파일을 fetch로 읽지 못해서 전용 주소를 씀
const ROOT = path.join(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

async function serveFile(request) {
  const { pathname } = new URL(request.url);
  const filePath = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));

  // 프로젝트 폴더 밖의 파일은 못 읽게 막기
  if (!filePath.startsWith(ROOT + path.sep)) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const data = await fs.readFile(filePath);
    const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    return new Response(data, { headers: { 'Content-Type': type } });
  } catch {
    return new Response('Not Found', { status: 404 });
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 820,
    title: '손가락 숫자야구',
    backgroundColor: '#111418',
  });

  win.setMenuBarVisibility(false);
  win.loadURL('app://local/src/renderer/index.html');
}

app.whenReady().then(() => {
  protocol.handle('app', serveFile);

  // 웹캠(카메라) 사용 허락
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media');
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
