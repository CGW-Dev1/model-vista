const { app, BrowserWindow, Menu, ipcMain, dialog, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const APP_NAME = 'ModelVista';
const START_TS = Date.now();
const APP_ID = 'com.modelvista.app';

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

/* 用户数据目录：显式指定，避免中文产品名产生奇怪路径 */
const userDataPath = path.join(app.getPath('appData'), APP_NAME);
try { app.setPath('userData', userDataPath); } catch (e) { /* ignore */ }

/* ---------- 从旧版本（PDM模型浏览器）平滑迁移设置与缓存 ---------- */
function migrateLegacyData() {
  try {
    const legacy = path.join(app.getPath('appData'), 'PDM模型浏览器');
    if (!fs.existsSync(legacy)) return;
    const hasNew = ['recent.json', 'open-files.json'].some(f => fs.existsSync(path.join(userDataPath, f)));
    if (hasNew) return;
    fs.mkdirSync(userDataPath, { recursive: true });
    for (const f of ['recent.json', 'open-files.json', 'window-state.json']) {
      const src = path.join(legacy, f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(userDataPath, f));
    }
    const legacyCache = path.join(legacy, 'pdm-cache');
    if (fs.existsSync(legacyCache)) fs.cpSync(legacyCache, path.join(userDataPath, 'pdm-cache'), { recursive: true });
  } catch (e) { /* ignore */ }
}
migrateLegacyData();

let mainWindow = null;
const watchedFiles = new Map(); // filePath -> watcher
let pendingOpenPath = null;

/* E2E/自动化验证场景禁用硬件加速与 GPU 合成，避免无 GPU 环境崩溃 */
if (process.argv.includes('--e2e-test')) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
}

let recentFiles = [];

/* ---------- 最近文件（主进程维护，供菜单使用） ---------- */
function recentStorePath() { return path.join(app.getPath('userData'), 'recent.json'); }
function loadRecents() {
  try { recentFiles = JSON.parse(fs.readFileSync(recentStorePath(), 'utf-8')) || []; }
  catch (e) { recentFiles = []; }
}
function persistRecents() {
  try { fs.writeFileSync(recentStorePath(), JSON.stringify(recentFiles), 'utf-8'); } catch (e) { /* ignore */ }
}
function addRecentPath(p) {
  recentFiles = [p].concat(recentFiles.filter(x => x !== p)).slice(0, 12);
  persistRecents();
  buildMenu();
}

/* ---------- 已打开文件列表持久化 ---------- */
function openFilesStorePath() { return path.join(app.getPath('userData'), 'open-files.json'); }
function loadSavedOpenFiles() {
  try {
    if (fs.existsSync(openFilesStorePath())) {
      const list = JSON.parse(fs.readFileSync(openFilesStorePath(), 'utf-8'));
      if (Array.isArray(list)) return list.filter(p => p && fs.existsSync(p));
    }
  } catch (e) { /* ignore */ }
  return [];
}
function saveOpenFiles(list) {
  try { fs.writeFileSync(openFilesStorePath(), JSON.stringify(list || []), 'utf-8'); } catch (e) { /* ignore */ }
}

/* ---------- 窗口状态记忆 ---------- */
function winStatePath() { return path.join(app.getPath('userData'), 'window-state.json'); }
function loadWinState() {
  try { return JSON.parse(fs.readFileSync(winStatePath(), 'utf-8')); }
  catch (e) { return null; }
}
function saveWinState() {
  if (!mainWindow) return;
  try {
    fs.writeFileSync(winStatePath(), JSON.stringify({
      bounds: mainWindow.getNormalBounds ? mainWindow.getNormalBounds() : mainWindow.getBounds(),
      maximized: mainWindow.isMaximized()
    }));
  } catch (e) { /* ignore */ }
}

/* ---------- 命令行 / 文件关联 ---------- */
function findPdmArg(argv) {
  const args = (argv || []).slice(1);
  for (const a of args) {
    if (!a || a.startsWith('-')) continue;
    if (/\.(pdm|xml)$/i.test(a) && fs.existsSync(a)) return path.resolve(a);
  }
  return null;
}

function openPathFromOutside(p) {
  if (!p) return;
  if (!mainWindow) { pendingOpenPath = p; return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (mainWindow.webContents.isLoading()) pendingOpenPath = p;
  else mainWindow.webContents.send('menu-action', { action: 'menu:open-path', arg: p });
}

function createWindow() {
  const isE2E = process.argv.includes('--e2e-test');
  const workArea = screen.getPrimaryDisplay().workArea;
  const defaultW = Math.max(1024, Math.min(1400, workArea.width - 40));
  const defaultH = Math.max(660, Math.min(880, workArea.height - 40));
  const winOpts = {
    width: defaultW,
    height: defaultH,
    x: Math.round(workArea.x + (workArea.width - defaultW) / 2),
    y: Math.round(workArea.y + (workArea.height - defaultH) / 2),
    minWidth: 1024,
    minHeight: 660,
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'win32'
      ? { color: '#ffffff', symbolColor: '#51617a', height: 50 }
      : false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'resources', 'icon.ico'),
    title: APP_NAME,
    backgroundColor: '#f3f6fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      v8CacheOptions: 'code'
    }
  };
  /* 恢复上次窗口位置与大小（校验后夹回可视区域） */
  const saved = loadWinState();
  if (saved && saved.bounds && saved.bounds.width >= 500 && saved.bounds.height >= 400) {
    try {
      const area = screen.getDisplayMatching(saved.bounds).workArea;
      const b = saved.bounds;
      b.width = Math.min(b.width, area.width);
      b.height = Math.min(b.height, area.height);
      b.x = Math.max(area.x, Math.min(b.x, area.x + area.width - b.width));
      b.y = Math.max(area.y, Math.min(b.y, area.y + area.height - b.height));
      winOpts.x = b.x; winOpts.y = b.y;
      winOpts.width = b.width; winOpts.height = b.height;
    } catch (e) { /* ignore */ }
  }
  mainWindow = new BrowserWindow(winOpts);

  if (isE2E) {
    /* 默认使用内置样例；设置 PDM_E2E_FILE 可验证任意真实文件（宽松断言 real=1） */
    const e2eFile = process.env.PDM_E2E_FILE || path.join(__dirname, 'test', 'test-model.pdm');
    const real = process.env.PDM_E2E_FILE ? '&real=1' : '';
    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'),
      { search: 'e2e=1&file=' + encodeURIComponent(e2eFile) + real });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  }

  mainWindow.webContents.on('did-finish-load', () => {
    if (saved && saved.maximized) mainWindow.maximize();
    if (pendingOpenPath) {
      const p = pendingOpenPath;
      pendingOpenPath = null;
      setTimeout(() => mainWindow.webContents.send('menu-action', { action: 'menu:open-path', arg: p }), 120);
    }
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[load-fail]', code, desc, url);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[render-gone]', details.reason);
  });
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (message && message.indexOf('[E2E-RESULT]') === 0) {
      console.log(message);
      try {
        const payload = JSON.parse(message.slice('[E2E-RESULT]'.length).trim());
        app.exit(payload.fail === 0 ? 0 : 1);
      } catch (err) { app.exit(1); }
      return;
    }
    if (message && message.indexOf('[REAL]') === 0) console.log(message);
    if (level >= 2) console.error('[renderer]', message, sourceId + ':' + line);
  });
  if (isE2E) {
    setTimeout(() => { console.error('[E2E-TIMEOUT] 45s 未完成'); app.exit(2); }, 45000);
  }
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.env.MV_TRACE_STARTUP) console.log('[startup] window shown at', Date.now() - START_TS, 'ms');
  });

  mainWindow.on('close', saveWinState);
  mainWindow.on('closed', () => { mainWindow = null; });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '文件',
      submenu: [
        { label: '打开 PDM 文件…', accelerator: 'CmdOrCtrl+O', click: () => sendAction('menu:open-file') },
        {
          label: '打开最近文件',
          submenu: [
            ...(recentFiles.length
              ? recentFiles.map(p => ({
                  label: p.length > 72 ? '…' + p.slice(-71) : p,
                  click: () => sendAction('menu:open-path', p)
                }))
              : [{ label: '（暂无记录）', enabled: false }]),
            { type: 'separator' },
            {
              label: '清除最近文件记录',
              click: () => {
                recentFiles = [];
                persistRecents();
                buildMenu();
                sendAction('menu:clear-recent');
              }
            }
          ]
        },
        { type: 'separator' },
        {
          label: '导出当前对象',
          submenu: [
            { label: '导出为 Word', click: () => sendAction('menu:export', 'word') },
            { label: '导出为 Excel', click: () => sendAction('menu:export', 'excel') },
            { label: '导出为 HTML', click: () => sendAction('menu:export', 'html') },
            { label: '导出为 Markdown', click: () => sendAction('menu:export', 'markdown') },
            { label: '导出为 CSV', click: () => sendAction('menu:export', 'csv') },
            { label: '导出为 PDF', click: () => sendAction('menu:export', 'pdf') }
          ]
        },
        { label: '导出整个模型…', click: () => sendAction('menu:export-all') },
        { type: 'separator' },
        { label: '退出', accelerator: 'Alt+F4', role: 'quit' }
      ]
    },
    {
      label: '查看',
      submenu: [
        { label: '刷新视图', accelerator: 'F5', click: () => sendAction('menu:refresh') },
        { type: 'separator' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'resetZoom', label: '重置缩放' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: '开发者工具' }
      ]
    },
    {
      label: '工具',
      submenu: [
        { label: '生成建表 SQL', click: () => sendAction('menu:gen-sql') },
        { label: '模型关系图', click: () => sendAction('menu:diagram') },
        { label: '模型对比', click: () => sendAction('menu:diff') }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '使用说明', click: () => sendAction('menu:help') },
        { label: '关于 ModelVista', click: () => sendAction('menu:about') }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function sendAction(action, arg) {
  if (mainWindow) mainWindow.webContents.send('menu-action', { action, arg });
}

/* ---------------- IPC ---------------- */

ipcMain.handle('dialog:openPdm', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '打开 PDM 模型文件',
    filters: [
      { name: 'PowerDesigner PDM', extensions: ['pdm'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile', 'multiSelections']
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle('recent:add', (_e, p) => { addRecentPath(p); return true; });
ipcMain.handle('recent:remove', (_e, p) => {
  recentFiles = recentFiles.filter(x => x !== p);
  persistRecents();
  buildMenu();
  return true;
});
ipcMain.handle('recent:clear', () => {
  recentFiles = [];
  persistRecents();
  buildMenu();
  return true;
});
ipcMain.handle('files:getOpenList', () => loadSavedOpenFiles());
ipcMain.handle('files:saveOpenList', (_e, list) => { saveOpenFiles(list); return true; });

ipcMain.handle('file:read', async (_e, filePath) => {
  const stat = fs.statSync(filePath);
  const buf = fs.readFileSync(filePath);
  let content;
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    /* UTF-8 BOM */
    content = buf.toString('utf-8');
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  } else {
    content = buf.toString('utf-8');
    if (content.includes('\uFFFD')) {
      /* UTF-8 解码出现替换符 → 尝试 GBK（老版本 PowerDesigner 中文环境常见） */
      try { content = new TextDecoder('gbk').decode(buf); }
      catch (e) { /* 环境不支持 GBK 则保持原样 */ }
    }
  }
  return { name: path.basename(filePath), path: filePath, size: stat.size, mtime: stat.mtimeMs, content };
});

ipcMain.handle('file:watch', (_e, filePath) => {
  if (watchedFiles.has(filePath)) return;
  try {
    let timer = null;
    const watcher = fs.watch(filePath, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (mainWindow) mainWindow.webContents.send('file-changed', filePath);
      }, 800);
    });
    watchedFiles.set(filePath, watcher);
  } catch (err) { /* ignore */ }
});

ipcMain.handle('file:unwatch', (_e, filePath) => {
  const w = watchedFiles.get(filePath);
  if (w) { try { w.close(); } catch (e) {} watchedFiles.delete(filePath); }
});

ipcMain.handle('dialog:saveFile', async (_e, { defaultName, filters }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '保存文件',
    defaultPath: defaultName,
    filters: filters || [{ name: '所有文件', extensions: ['*'] }]
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

ipcMain.handle('file:writeBinary', async (_e, { filePath, base64 }) => {
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
  return true;
});

ipcMain.handle('file:writeText', async (_e, { filePath, content }) => {
  fs.writeFileSync(filePath, content, 'utf-8');
  return true;
});

ipcMain.handle('shell:showInFolder', async (_e, filePath) => {
  shell.showItemInFolder(filePath);
  return true;
});

ipcMain.handle('shell:openExternal', async (_e, url) => {
  try {
    if (typeof url === 'string' && /^https:\/\//i.test(url)) await shell.openExternal(url);
  } catch (e) { /* ignore */ }
  return true;
});

/* PDF 导出：隐藏窗口渲染 HTML → printToPDF */
ipcMain.handle('export:pdf', async (_e, { defaultName, html }) => {
  if (!html) return null;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '保存 PDF 数据字典',
    defaultPath: defaultName || '数据字典.pdf',
    filters: [{ name: 'PDF 文档', extensions: ['pdf'] }]
  });
  if (result.canceled || !result.filePath) return null;
  const printWin = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, sandbox: true, javascript: false }
  });
  const tmpHtml = path.join(app.getPath('temp'), 'modelvista-print-' + Date.now() + '.html');
  try {
    fs.writeFileSync(tmpHtml, html, 'utf-8');
    await printWin.loadFile(tmpHtml);
    const pdf = await printWin.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'custom', top: 0.45, bottom: 0.45, left: 0.4, right: 0.4 }
    });
    fs.writeFileSync(result.filePath, pdf);
    return result.filePath;
  } finally {
    if (!printWin.isDestroyed()) printWin.destroy();
    try { fs.unlinkSync(tmpHtml); } catch (e) { /* ignore */ }
  }
});

/* 无边框标题栏随主题换色 */
ipcMain.on('theme:set', (_e, dark) => {
  if (!mainWindow || process.platform !== 'win32') return;
  try {
    mainWindow.setTitleBarOverlay({
      color: dark ? '#121a25' : '#ffffff',
      symbolColor: dark ? '#c6d2e2' : '#51617a',
      height: 50
    });
  } catch (err) { /* ignore */ }
});

ipcMain.handle('app:info', () => ({
  name: APP_NAME,
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node
}));

ipcMain.handle('app:setTitle', (_e, title) => {
  if (mainWindow && typeof title === 'string' && title) {
    try { mainWindow.setTitle(title); } catch (e) { /* ignore */ }
  }
  return true;
});

/* ---------- PDM 解析缓存（启动秒开） ----------
 * 解析结果按文件路径哈希存到 userData/pdm-cache/*.json，
 * 文件格式：第一行元数据 {"mtime","size"}，换行后为模型 JSON 字符串体。
 * 主进程只解析头部做失效校验，字符串体原样传给渲染进程一次 parse——
 * 避免主进程整模型 JSON.parse + IPC 结构化克隆大对象图的双重开销。 */
function cacheDir() { return path.join(app.getPath('userData'), 'pdm-cache'); }
function cachePathFor(p) {
  const key = crypto.createHash('sha1').update(p.toLowerCase()).digest('hex');
  return path.join(cacheDir(), key + '.json');
}

ipcMain.handle('cache:load', (_e, filePath) => {
  try {
    const st = fs.statSync(filePath);
    const cp = cachePathFor(filePath);
    /* 只读头部 512 字节校验元数据，命中才整体读取 */
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

ipcMain.handle('cache:save', (_e, filePath, body) => {
  try {
    const st = fs.statSync(filePath);
    fs.mkdirSync(cacheDir(), { recursive: true });
    const finalPath = cachePathFor(filePath);
    const tmp = finalPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ mtime: st.mtimeMs, size: st.size }) + '\n' + body);
    fs.renameSync(tmp, finalPath);
    return true;
  } catch (e) { return false; }
});

ipcMain.handle('cache:clear', () => {
  try {
    for (const f of fs.readdirSync(cacheDir())) {
      try { fs.unlinkSync(path.join(cacheDir(), f)); } catch (e) { /* ignore */ }
    }
    return true;
  } catch (e) { return false; }
});

/* ---------------- 单实例 & lifecycle ---------------- */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const p = findPdmArg(argv);
    if (p) openPathFromOutside(p);
    else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    openPathFromOutside(filePath);
  });

  app.whenReady().then(() => {
    loadRecents();
    createWindow();
    buildMenu();
    const initial = findPdmArg(process.argv);
    if (initial) pendingOpenPath = initial;
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    watchedFiles.forEach(w => { try { w.close(); } catch (e) {} });
    if (process.platform !== 'darwin') app.quit();
  });
}
