/* 布局截图工具：启动应用 → 打开测试模型 → 截图（侧栏/表视图/搜索下拉）
 * 注意：本脚本作为 electron 入口运行，main.js 的 IPC 不会注册，
 * 因此这里需自行注册截图流程用到的最小 IPC（cache:load）。 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
/* 与 `electron .` 运行时共用同一 userData（缓存/localStorage 才能命中） */
app.setName('PDM模型浏览器');

/* 与 main.js 相同实现的解析缓存读取（供秒开路径验证） */
function cacheDir() { return path.join(app.getPath('userData'), 'pdm-cache'); }
function cachePathFor(p) {
  return path.join(cacheDir(), crypto.createHash('sha1').update(p.toLowerCase()).digest('hex') + '.json');
}
ipcMain.handle('cache:load', (_e, filePath) => {
  try {
    const st = fs.statSync(filePath);
    const cp = cachePathFor(filePath);
    const fd = fs.openSync(cp, 'r');
    const head = Buffer.alloc(512);
    const n = fs.readSync(fd, head, 0, 512, 0);
    fs.closeSync(fd);
    const nl = head.indexOf('\n');
    if (nl < 0 || nl >= n) return null;
    const meta = JSON.parse(head.slice(0, nl).toString('utf-8'));
    if (!(meta && meta.mtime === st.mtimeMs && meta.size === st.size)) return null;
    const raw = fs.readFileSync(cp, 'utf-8');
    return { mtime: st.mtimeMs, size: st.size, body: raw.slice(raw.indexOf('\n') + 1) };
  } catch (e) { return null; }
});
/* 截图场景的兜底/旁路 IPC（正常流程由 main.js 提供） */
ipcMain.handle('file:read', (_e, filePath) => {
  const st = fs.statSync(filePath);
  return { name: path.basename(filePath), path: filePath, size: st.size, mtime: st.mtimeMs, content: fs.readFileSync(filePath, 'utf-8') };
});
ipcMain.handle('file:watch', () => true);
ipcMain.handle('file:unwatch', () => true);
ipcMain.handle('recent:add', () => true);

const OUT = process.env.SHOT_OUT || path.join(__dirname, 'shot.png');
const sleep = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1360, height: 860, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, spellcheck: false
    }
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  await sleep(800);

  const t = async (code) => { try { return await win.webContents.executeJavaScript(code); } catch (e) { return String(e); } };

  /* 打开测试模型（优先走磁盘缓存路径） */
  const testFile = process.env.PDM_E2E_FILE || path.join(__dirname, 'test-model.pdm');
  console.log('[SHOT] cache hit: ' + JSON.stringify(await t(`(async () => !!await window.native.loadCache(${JSON.stringify(testFile)}))()`)));
  await t(`window.App.__test.openPaths(${JSON.stringify([testFile])})`);
  await sleep(1500);

  /* 1. 主界面（侧栏展开 + 概览） */
  await t(`(() => { const s = window.App.__test.getState(); s.models.forEach(m => s.expanded.add(m.id)); window.App.__test.openObject('overview'); })()`);
  await sleep(400);
  fs.writeFileSync(OUT, (await win.webContents.capturePage()).toPNG());

  /* 2. 表视图 */
  await t(`(() => { const s = window.App.__test.getState(); if (s.models.length) window.App.__test.openObject('table', s.models[0].model.tables.find(x => x.code === 'SYS_USER').id); })()`);
  await sleep(600);
  fs.writeFileSync(OUT.replace('.png', '-table.png'), (await win.webContents.capturePage()).toPNG());

  /* 3. 搜索下拉 */
  await t(`(() => { const i = document.getElementById('global-search'); i.value = 'USER'; window.App.__test.doSearch('USER'); })()`);
  await sleep(500);
  fs.writeFileSync(OUT.replace('.png', '-search.png'), (await win.webContents.capturePage()).toPNG());

  console.log('[SHOT] saved: ' + OUT + ' / -table.png / -search.png');
  const models = await t(`window.App.__test.getState().models.length`);
  console.log('[SHOT] restored models: ' + models);
  app.exit(0);
});
