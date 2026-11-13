const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('native', {
  openPdmDialog: () => ipcRenderer.invoke('dialog:openPdm'),
  readFile: (path) => ipcRenderer.invoke('file:read', path),
  watchFile: (path) => ipcRenderer.invoke('file:watch', path),
  unwatchFile: (path) => ipcRenderer.invoke('file:unwatch', path),
  saveFileDialog: (opts) => ipcRenderer.invoke('dialog:saveFile', opts),
  writeBinaryFile: (opts) => ipcRenderer.invoke('file:writeBinary', opts),
  writeTextFile: (opts) => ipcRenderer.invoke('file:writeText', opts),
  exportPdf: (opts) => ipcRenderer.invoke('export:pdf', opts),
  showInFolder: (path) => ipcRenderer.invoke('shell:showInFolder', path),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  appInfo: () => ipcRenderer.invoke('app:info'),
  setTitle: (title) => ipcRenderer.invoke('app:setTitle', title),
  /* Electron 32+ 移除了渲染进程 File.path，必须经 webUtils 获取拖拽文件路径 */
  filePathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch (e) { return ''; }
  },
  addRecent: (p) => ipcRenderer.invoke('recent:add', p),
  removeRecent: (p) => ipcRenderer.invoke('recent:remove', p),
  clearRecents: () => ipcRenderer.invoke('recent:clear'),
  getOpenList: () => ipcRenderer.invoke('files:getOpenList'),
  saveOpenList: (list) => ipcRenderer.invoke('files:saveOpenList', list),
  /* PDM 解析缓存：命中时跳过 XML 解析，启动秒开（body 为模型 JSON 字符串，渲染进程一次 parse） */
  loadCache: (path) => ipcRenderer.invoke('cache:load', path),
  saveCache: (path, bodyString) => ipcRenderer.invoke('cache:save', path, bodyString),
  clearCache: () => ipcRenderer.invoke('cache:clear'),
  setThemeOverlay: (dark) => ipcRenderer.send('theme:set', !!dark),
  onMenuAction: (cb) => ipcRenderer.on('menu-action', (_e, payload) => cb(payload)),
  onFileChanged: (cb) => ipcRenderer.on('file-changed', (_e, path) => cb(path)),
  platform: process.platform
});
