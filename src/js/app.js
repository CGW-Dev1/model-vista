/* ============================================================
 * ModelVista 模型视界 - 主逻辑
 * 支持多标签页浏览(MDI Tabs)、树显示模式自由切换、模块分组/平铺、
 * 树内即时过滤、精度标度展示、多数据库方言DDL、现代后端代码生成、
 * 批量自定义勾选导出与离线交互式HTML数据字典
 * ============================================================ */
(function () {
  'use strict';

  /* ---------------- 状态 ---------------- */
  const state = {
    models: [],        // {id, path, name, size, mtime, model}
    activeId: null,
    current: null,     // {kind, id} 当前打开对象
    expanded: new Set(),  // 侧栏中展开的 PDM 节点 id
    seq: 0,
    tabs: [],          // [{ id, modelId, kind, objId, title, subTitle, icon }]
    activeTabId: null,
    treeDisplayMode: localStorage.getItem('mv_tree_display_mode') || 'code-name',
    treeGroupMode: localStorage.getItem('mv_tree_group_mode') || 'package',
    ddlDialect: localStorage.getItem('mv_ddl_dialect') || 'mysql'
  };

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtSize = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? (n / 1024).toFixed(0) + ' KB' : n + ' B';

  /* 统一线性图标 */
  const ICON_MAP = {
    tables: 'table', views: 'view', references: 'link', procedures: 'cog',
    sequences: 'hash', triggers: 'bolt', packages: 'box',
    overview: 'database', table: 'table', diagram: 'network', diff: 'diff',
    view: 'view', reference: 'link', procedure: 'cog', sequence: 'hash', trigger: 'bolt'
  };
  function iconSvg(name, cls) {
    const id = ICON_MAP[name] || name || 'file';
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '"><use href="#i-' + id + '"/></svg>';
  }

  function toast(msg, type) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast' + (type ? ' ' + type : '');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add('hidden'), 2800);
  }

  let loadingDepth = 0;
  function showLoading(text) {
    const m = $('#loading-mask');
    if (!m) return;
    loadingDepth++;
    $('#loading-text').textContent = text || '正在处理…';
    m.classList.remove('hidden');
    setStatusDot('busy');
  }
  function hideLoading() {
    loadingDepth = Math.max(0, loadingDepth - 1);
    if (loadingDepth === 0) {
      const m = $('#loading-mask');
      if (m) m.classList.add('hidden');
      setStatusDot('ok');
    }
  }
  const nextPaint = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  function setStatusDot(state) {
    const d = $('#st-dot');
    if (d) d.className = 'st-dot' + (state ? ' ' + state : '');
  }

  const activeModel = () => state.models.find(m => m.id === state.activeId);

  /* ---------------- 主题 ---------------- */
  function applyTheme(dark) {
    document.body.classList.toggle('dark', dark);
    const b = document.querySelector('#btn-theme');
    if (b) {
      const use = b.querySelector('use');
      if (use) use.setAttribute('href', dark ? '#i-sun' : '#i-moon');
      b.title = dark ? '切换浅色主题' : '切换深色主题';
    }
    try { localStorage.setItem('mv_theme', dark ? 'dark' : 'light'); } catch (e) { /* ignore */ }
    if (window.native && window.native.setThemeOverlay) window.native.setThemeOverlay(dark);
  }

  /* ---------------- 最近文件 ---------------- */
  const RECENT_KEY = 'mv_recent';
  function getRecent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; }
    catch (e) { return []; }
  }
  function pushRecent(path) {
    let list = getRecent().filter(p => p !== path);
    list.unshift(path);
    list = list.slice(0, 10);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    window.native.addRecent(path);
  }

  /* ---------------- 已打开文件持久化 ---------------- */
  const OPEN_KEY = 'mv_open_files';
  function syncOpenList() {
    const paths = state.models.map(m => m.path);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(paths)); } catch (e) { /* ignore */ }
    if (window.native && window.native.saveOpenList) {
      window.native.saveOpenList(paths);
    }
  }
  async function getSavedOpenPaths() {
    let list = [];
    if (window.native && window.native.getOpenList) {
      try { list = await window.native.getOpenList(); } catch (e) { /* ignore */ }
    }
    if (!list || !list.length) {
      try { list = JSON.parse(localStorage.getItem(OPEN_KEY)) || []; } catch (e) { list = []; }
    }
    return list || [];
  }

  /* ---------------- 打开文件 ---------------- */
  async function openDialog() {
    const paths = await window.native.openPdmDialog();
    if (paths && paths.length) await openPaths(paths);
  }

  function scheduleCacheSave(path, model) {
    setTimeout(() => {
      try { window.native.saveCache(path, JSON.stringify(model)); } catch (e) { /* ignore */ }
    }, 60);
  }

  async function openPaths(paths) {
    let lastId = null;
    let cacheHits = 0;
    let parseMs = 0;
    let parseCount = 0;

    /* 先并行读取缓存头部/内容，多文件恢复更快 */
    const cacheResults = await Promise.all((paths || []).map(p =>
      window.native.loadCache(p).catch(() => null)
    ));

    for (let idx = 0; idx < paths.length; idx++) {
      const p = paths[idx];
      const exist = state.models.find(m => m.path === p);
      if (exist) { lastId = exist.id; continue; }
      try {
        let entry = null;
        const cached = cacheResults[idx];
        if (cached && cached.body) {
          const model = JSON.parse(cached.body);
          if (model && model.stats) {
            entry = {
              id: 'm' + (++state.seq),
              path: p, name: model.fileName || p.split(/[\\/]/).pop(),
              size: cached.size, mtime: cached.mtime,
              model, fromCache: true
            };
            cacheHits++;
          }
        }
        if (!entry) {
          showLoading('正在解析 ' + p.split(/[\\/]/).pop() + ' …');
          await nextPaint();
          const file = await window.native.readFile(p);
          const t0 = performance.now();
          const model = PDMParser.parse(file.content, file.name);
          parseMs += performance.now() - t0;
          parseCount++;
          if (model.stats.tables === 0 && model.stats.views === 0 && model.stats.references === 0) {
            toast('警告：' + file.name + ' 未识别到任何数据对象，可能是不支持的格式', 'err');
          }
          entry = {
            id: 'm' + (++state.seq),
            path: file.path, name: file.name, size: file.size, mtime: file.mtime,
            model
          };
          scheduleCacheSave(file.path, model);
          hideLoading();
        }
        state.models.push(entry);
        window.native.watchFile(p);
        pushRecent(p);
        lastId = entry.id;
      } catch (err) {
        hideLoading();
        console.error(err);
        toast('打开失败：' + p + ' — ' + err.message, 'err');
      }
    }
    if (lastId) {
      state.activeId = lastId;
      state.expanded.add(lastId);
      syncOpenList();
      renderTabs();
      openObject('overview');
      const bits = [];
      if (cacheHits) bits.push('缓存秒开 ' + cacheHits + ' 个');
      if (parseCount) bits.push('解析 ' + parseCount + ' 个 · ' + Math.round(parseMs) + ' ms');
      setStatus(bits.join(' · ') || '就绪');
    }
  }

  async function reloadModel(entry) {
    try {
      const file = await window.native.readFile(entry.path);
      const model = PDMParser.parse(file.content, file.name);
      entry.model = model; entry.size = file.size; entry.mtime = file.mtime;
      scheduleCacheSave(entry.path, model);
      renderTabs();
      renderDocTabs();
      renderContent();
      toast('已重新加载：' + entry.name, 'ok');
    } catch (err) { toast('重新加载失败：' + err.message, 'err'); }
  }

  function closeModel(id) {
    const idx = state.models.findIndex(m => m.id === id);
    if (idx < 0) return;
    window.native.unwatchFile(state.models[idx].path);
    state.models.splice(idx, 1);
    state.expanded.delete(id);
    state.tabs = state.tabs.filter(t => t.modelId !== id);
    syncOpenList();

    if (state.activeId === id) {
      state.activeId = state.models.length ? state.models[Math.max(0, idx - 1)].id : null;
      if (state.tabs.length) {
        const nextTab = state.tabs[state.tabs.length - 1];
        state.activeTabId = nextTab.id;
        state.activeId = nextTab.modelId;
        state.current = { kind: nextTab.kind, id: nextTab.objId };
      } else {
        state.activeTabId = null;
        state.current = state.models.length ? { kind: 'overview' } : null;
      }
    }
    renderTabs();
    renderDocTabs();
    renderContent();
  }

  function setStatus(text) {
    const el = document.getElementById('status-right');
    if (el) el.textContent = text || '';
  }

  function updateWindowTitle() {
    const m = activeModel();
    if (!m) {
      document.title = 'ModelVista 模型视界';
      return;
    }
    const modelName = m.model.name || m.name;
    let sub = '';
    const cur = state.current;
    if (cur && cur.kind === 'table') {
      const t = findTable(m.model, cur.id);
      if (t) sub = t.code + ' · ';
    } else if (cur && cur.kind === 'diagram') {
      sub = '关系图 · ';
    } else if (cur && cur.kind === 'diff') {
      sub = '模型对比 · ';
    }
    document.title = sub + modelName + ' — ModelVista';
  }

  /* ---------------- 树节点文本格式化（对标 PDMReader 显示模式） ---------------- */
  function formatTreeLabel(code, name, isRef) {
    code = code || '';
    name = name || '';
    if (isRef) return { main: name || code, sub: (name && code && name !== code) ? code : '' };
    const mode = state.treeDisplayMode || 'code-name';
    if (mode === 'name-code') {
      const main = name || code;
      const sub = (code && code !== main) ? code : '';
      return { main, sub };
    }
    if (mode === 'name-only') {
      return { main: name || code, sub: '' };
    }
    if (mode === 'code-only') {
      return { main: code || name, sub: '' };
    }
    /* 默认 code-name: 代码 (名称) */
    const main = code || name;
    const sub = (name && name !== main) ? name : '';
    return { main, sub };
  }

  /* ---------------- 侧栏：PDM 树 ---------------- */
  function renderTabs() {
    const box = $('#file-tabs');
    if (!box) return;
    box.innerHTML = '';
    if (!state.models.length) {
      box.innerHTML = '<div class="file-tab-empty">' + iconSvg('database') + '尚未打开模型<br>点击“打开文件”或拖入 .pdm 文件</div>';
      setStatus('');
      renderDocTabs();
      return;
    }
    let totalTables = 0;
    for (const m of state.models) {
      box.appendChild(buildFileNode(m));
      totalTables += m.model.stats.tables;
    }
    setStatus('已加载 ' + state.models.length + ' 个模型 · 共 ' + totalTables + ' 张表');
  }

  function buildFileNode(entry) {
    const node = document.createElement('div');
    node.className = 'file-tab-node';
    const s = entry.model.stats;
    const expanded = state.expanded.has(entry.id);
    const row = document.createElement('div');
    row.className = 'file-tab' + (entry.id === state.activeId ? ' active' : '') + (expanded ? ' expanded' : '');
    row.dataset.modelId = entry.id;
    const subBits = [];
    if (entry.model.dbms) subBits.push(entry.model.dbms);
    subBits.push('表 ' + s.tables + (s.views ? ' · 视图 ' + s.views : ''));
    subBits.push(fmtSize(entry.size));
    row.innerHTML =
      '<span class="tw" title="展开 / 折叠">' + iconSvg('chevron') + '</span>' +
      '<div class="ft-main">' +
      '<span class="name" title="' + esc(entry.path) + '">' + iconSvg('database') + esc(entry.name) + '</span>' +
      '<span class="ft-sub">' + esc(subBits.join(' · ')) + '</span>' +
      '</div>' +
      '<span class="close" title="关闭">×</span>';
    const children = document.createElement('div');
    children.className = 'tree-children' + (expanded ? '' : ' collapsed');
    children._built = false;
    node.appendChild(row);
    node.appendChild(children);

    if (expanded) buildFileChildren(children, entry);

    row.addEventListener('click', e => {
      if (e.target.closest('.close')) { closeModel(entry.id); return; }
      if (e.target.closest('.tw')) { toggleFileNode(node, entry); return; }
      if (state.activeId !== entry.id) {
        state.activeId = entry.id;
        if (!state.expanded.has(entry.id)) state.expanded.add(entry.id);
        renderTabs();
        openObject('overview');
      } else {
        toggleFileNode(node, entry);
      }
    });
    return node;
  }

  function buildFileChildren(container, entry) {
    const model = entry.model;
    container.innerHTML = '';
    container.appendChild(buildGroupNode(model, { key: 'tables', label: '表', icon: 'table', cls: 'ico-table', open: true }));
    container.appendChild(buildGroupNode(model, { key: 'views', label: '视图', icon: 'view', cls: 'ico-view', open: true }));
    const more = [
      { key: 'references', label: '外键关系', icon: 'link', cls: 'ico-ref' },
      { key: 'procedures', label: '存储过程', icon: 'cog', cls: 'ico-proc' },
      { key: 'sequences', label: '序列', icon: 'hash', cls: 'ico-seq' },
      { key: 'triggers', label: '触发器', icon: 'bolt', cls: 'ico-trg' }
    ].filter(g => collectGroupItems(model, g.key).length);
    if (more.length) container.appendChild(buildMoreNode(model, more));
    container._built = true;
  }

  function toggleFileNode(node, entry) {
    const row = node.querySelector('.file-tab');
    const children = node.querySelector('.tree-children');
    if (!children._built) buildFileChildren(children, entry);
    const willExpand = children.classList.contains('collapsed');
    children.classList.toggle('collapsed', !willExpand);
    row.classList.toggle('expanded', willExpand);
    if (willExpand) state.expanded.add(entry.id); else state.expanded.delete(entry.id);
  }

  function buildMoreNode(model, groups) {
    const node = document.createElement('div');
    node.className = 'tree-node';
    const count = groups.reduce((n, g) => n + collectGroupItems(model, g.key).length, 0);
    const row = document.createElement('div');
    row.className = 'tree-row';
    row.innerHTML = '<span class="tw">' + iconSvg('chevron') + '</span><span class="ico ico-more">' + iconSvg('box') + '</span>' +
      '<span class="label">其他对象</span><span class="count">' + count + '</span>';
    const children = document.createElement('div');
    children.className = 'tree-children collapsed';
    for (const g of groups) children.appendChild(buildGroupNode(model, g));
    row.addEventListener('click', () => {
      row.classList.toggle('expanded');
      children.classList.toggle('collapsed');
    });
    node.appendChild(row);
    node.appendChild(children);
    return node;
  }

  function buildGroupNode(model, g) {
    const node = document.createElement('div');
    node.className = 'tree-node';
    const items = collectGroupItems(model, g.key);
    const expanded = !!g.open && items.length > 0;
    const row = document.createElement('div');
    row.className = 'tree-row' + (expanded ? ' expanded' : '');
    row.innerHTML = (items.length ? '<span class="tw">' + iconSvg('chevron') + '</span>' : '<span class="tw" style="visibility:hidden">' + iconSvg('chevron') + '</span>') +
      '<span class="ico ' + g.cls + '">' + iconSvg(g.icon) + '</span>' +
      '<span class="label">' + g.label + '</span>' +
      (items.length ? '<span class="count">' + items.length + '</span>' : '');
    node.appendChild(row);
    const children = document.createElement('div');
    children.className = 'tree-children' + (expanded ? '' : ' collapsed');
    node.appendChild(children);

    if (!items.length) return node;

    const isFlat = state.treeGroupMode === 'flat';
    const pkgGroups = groupByPackage(model, g.key);

    if (!isFlat && pkgGroups.multi) {
      let html = '';
      for (const pg of pkgGroups.groups) {
        html += '<div class="tree-row"><span class="tw">' + iconSvg('chevron') + '</span><span class="ico ico-pkg">' + iconSvg('box') + '</span>' +
          '<span class="label" title="' + esc(pg.name) + '">' + esc(pg.name) + '</span>' +
          '<span class="count">' + pg.items.length + '</span></div>' +
          '<div class="tree-children collapsed">' +
          pg.items.map(it => itemRowHtml(g, it)).join('') +
          '</div>';
      }
      children.innerHTML = html;
      children.querySelectorAll(':scope > .tree-row').forEach(pkgRow => {
        pkgRow.addEventListener('click', () => {
          pkgRow.classList.toggle('expanded');
          pkgRow.nextElementSibling.classList.toggle('collapsed');
        });
      });
    } else {
      children.innerHTML = (pkgGroups.multi && isFlat ? items : pkgGroups.groups[0].items).map(it => itemRowHtml(g, it)).join('');
    }

    row.addEventListener('click', () => {
      row.classList.toggle('expanded');
      children.classList.toggle('collapsed');
    });
    return node;
  }

  function collectGroupItems(model, key) {
    const out = [];
    (function walk(pkg) {
      (pkg[key] || []).forEach(x => out.push(x));
      (pkg.packages || []).forEach(walk);
    })(model.rootPackage);
    return out;
  }

  function groupByPackage(model, key) {
    const groups = [];
    (function walk(pkg) {
      const items = pkg[key] || [];
      if (items.length) groups.push({ name: pkg === model.rootPackage ? '（根）' : (pkg.name || pkg.code || '未命名包'), items: items });
      (pkg.packages || []).forEach(walk);
    })(model.rootPackage);
    return { multi: groups.length > 1, groups: groups.length ? groups : [{ name: '', items: [] }] };
  }

  function itemRowHtml(g, it) {
    const isRef = g.key === 'references';
    const { main, sub } = formatTreeLabel(it.code, it.name, isRef);
    return '<div class="tree-row" data-open="' + g.key + ':' + it.id + '">' +
      '<span class="tw" style="visibility:hidden">' + iconSvg('chevron') + '</span>' +
      '<span class="ico ' + g.cls + '">' + iconSvg(g.icon) + '</span>' +
      '<span class="label" title="' + esc(it.code + (it.name ? ' — ' + it.name : '') + (it.comment ? '\n' + it.comment : '')) + '">' +
      esc(main) +
      (sub ? ' <span style="color:var(--text-3);font-size:10.5px">' + esc(sub) + '</span>' : '') +
      '</span></div>';
  }

  /* ---------------- 侧栏快速过滤与控制 ---------------- */
  function filterTree(kw) {
    const allRows = $$('#file-tabs .tree-row[data-open]');
    if (!kw) {
      $$('#file-tabs .tree-row').forEach(r => r.style.display = '');
      $$('#file-tabs .tree-children').forEach(c => c.style.display = '');
      return;
    }
    allRows.forEach(r => {
      const text = r.textContent.toLowerCase();
      const match = text.includes(kw);
      r.style.display = match ? '' : 'none';
      if (match) {
        let p = r.parentElement;
        while (p && p.id !== 'file-tabs') {
          if (p.classList.contains('tree-children')) {
            p.classList.remove('collapsed');
            p.style.display = '';
            const prev = p.previousElementSibling;
            if (prev && prev.classList.contains('tree-row')) {
              prev.classList.add('expanded');
              prev.style.display = '';
            }
          }
          p = p.parentElement;
        }
      }
    });
  }

  function bindTreeFilter() {
    const input = $('#tree-filter');
    const clearBtn = $('#tree-filter-clear');
    if (!input) return;

    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      if (clearBtn) clearBtn.classList.toggle('hidden', !q);
      filterTree(q);
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        input.value = '';
        clearBtn.classList.add('hidden');
        filterTree('');
        input.focus();
      });
    }

    const expBtn = $('#btn-tree-expand-all');
    if (expBtn) {
      expBtn.addEventListener('click', () => {
        $$('#file-tabs .tree-children').forEach(c => c.classList.remove('collapsed'));
        $$('#file-tabs .tree-row').forEach(r => r.classList.add('expanded'));
        $$('#file-tabs .file-tab').forEach(r => r.classList.add('expanded'));
      });
    }

    const colBtn = $('#btn-tree-collapse-all');
    if (colBtn) {
      colBtn.addEventListener('click', () => {
        $$('#file-tabs .tree-children').forEach(c => c.classList.add('collapsed'));
        $$('#file-tabs .tree-row').forEach(r => r.classList.remove('expanded'));
        $$('#file-tabs .file-tab').forEach(r => r.classList.remove('expanded'));
      });
    }

    const dispSel = $('#tree-display-mode');
    if (dispSel) {
      dispSel.value = state.treeDisplayMode;
      dispSel.addEventListener('change', () => {
        state.treeDisplayMode = dispSel.value;
        try { localStorage.setItem('mv_tree_display_mode', dispSel.value); } catch (e) {}
        renderTabs();
        renderDocTabs();
      });
    }

    const grpSel = $('#tree-group-mode');
    if (grpSel) {
      grpSel.value = state.treeGroupMode;
      grpSel.addEventListener('change', () => {
        state.treeGroupMode = grpSel.value;
        try { localStorage.setItem('mv_tree_group_mode', grpSel.value); } catch (e) {}
        renderTabs();
      });
    }
  }

  /* ---------------- MDI 便签页栏控制 ---------------- */
  function renderDocTabs() {
    const bar = $('#doc-tabs-bar');
    const container = $('#doc-tabs');
    if (!container) return;
    if (!state.models.length || !state.tabs.length) {
      if (bar) bar.style.display = 'none';
      container.innerHTML = '';
      return;
    }
    if (bar) bar.style.display = 'flex';
    container.innerHTML = state.tabs.map(tab => {
      const active = tab.id === state.activeTabId ? ' active' : '';
      return `<div class="doc-tab${active}" data-doc-tab-id="${tab.id}" title="${esc(tab.subTitle || tab.title)}">
        <span class="dt-ico">${iconSvg(tab.icon)}</span>
        <span class="dt-title">${esc(tab.title)}</span>
        <span class="dt-close" title="关闭标签页 (Ctrl+W)">×</span>
      </div>`;
    }).join('');

    const act = container.querySelector('.doc-tab.active');
    if (act) act.scrollIntoView({ inline: 'nearest', behavior: 'smooth' });
  }

  function activateDocTab(tabId) {
    const tab = state.tabs.find(t => t.id === tabId);
    if (!tab) return;
    state.activeTabId = tab.id;
    state.activeId = tab.modelId;
    state.current = { kind: tab.kind, id: tab.objId };
    renderDocTabs();
    markTree();
    renderContent();
  }

  function closeDocTab(tabId) {
    const idx = state.tabs.findIndex(t => t.id === tabId);
    if (idx < 0) return;
    const isCur = state.activeTabId === tabId;
    state.tabs.splice(idx, 1);
    if (isCur) {
      if (state.tabs.length > 0) {
        const nextTab = state.tabs[Math.min(idx, state.tabs.length - 1)];
        state.activeTabId = nextTab.id;
        state.activeId = nextTab.modelId;
        state.current = { kind: nextTab.kind, id: nextTab.objId };
      } else {
        state.activeTabId = null;
        state.current = state.models.length ? { kind: 'overview' } : null;
      }
    }
    renderDocTabs();
    markTree();
    renderContent();
  }

  function closeOtherDocTabs(keepTabId) {
    state.tabs = state.tabs.filter(t => t.id === keepTabId);
    if (state.tabs.length) {
      state.activeTabId = state.tabs[0].id;
      state.activeId = state.tabs[0].modelId;
      state.current = { kind: state.tabs[0].kind, id: state.tabs[0].objId };
    }
    renderDocTabs();
    markTree();
    renderContent();
  }

  function closeRightDocTabs(tabId) {
    const idx = state.tabs.findIndex(t => t.id === tabId);
    if (idx < 0) return;
    state.tabs = state.tabs.slice(0, idx + 1);
    if (!state.tabs.some(t => t.id === state.activeTabId)) {
      state.activeTabId = tabId;
      const cur = state.tabs.find(t => t.id === tabId);
      if (cur) {
        state.activeId = cur.modelId;
        state.current = { kind: cur.kind, id: cur.objId };
      }
    }
    renderDocTabs();
    markTree();
    renderContent();
  }

  function closeAllDocTabs() {
    state.tabs = [];
    state.activeTabId = null;
    state.current = state.models.length ? { kind: 'overview' } : null;
    renderDocTabs();
    markTree();
    renderContent();
  }

  function bindDocTabs() {
    const container = $('#doc-tabs');
    const menu = $('#tab-context-menu');
    let contextTabId = null;
    if (!container) return;

    container.addEventListener('click', e => {
      const tabEl = e.target.closest('.doc-tab');
      if (!tabEl) return;
      const tabId = tabEl.dataset.docTabId;
      if (e.target.classList.contains('dt-close')) {
        closeDocTab(tabId);
        return;
      }
      activateDocTab(tabId);
    });

    container.addEventListener('auxclick', e => {
      if (e.button === 1) {
        const tabEl = e.target.closest('.doc-tab');
        if (tabEl) closeDocTab(tabEl.dataset.docTabId);
      }
    });

    container.addEventListener('contextmenu', e => {
      const tabEl = e.target.closest('.doc-tab');
      if (!tabEl || !menu) return;
      e.preventDefault();
      contextTabId = tabEl.dataset.docTabId;
      menu.style.left = e.clientX + 'px';
      menu.style.top = e.clientY + 'px';
      menu.classList.remove('hidden');
    });

    document.addEventListener('click', () => {
      if (menu) menu.classList.add('hidden');
    });

    if (menu) {
      menu.addEventListener('click', e => {
        const item = e.target.closest('.cm-item');
        if (!item || !contextTabId) return;
        const act = item.dataset.action;
        if (act === 'close') closeDocTab(contextTabId);
        else if (act === 'close-others') closeOtherDocTabs(contextTabId);
        else if (act === 'close-right') closeRightDocTabs(contextTabId);
        else if (act === 'close-all') closeAllDocTabs();
        menu.classList.add('hidden');
      });
    }

    const btnOther = $('#btn-tab-close-other');
    if (btnOther) btnOther.addEventListener('click', () => { if (state.activeTabId) closeOtherDocTabs(state.activeTabId); });
    const btnAll = $('#btn-tab-close-all');
    if (btnAll) btnAll.addEventListener('click', () => closeAllDocTabs());
  }

  /* ---------------- 查找工具 ---------------- */
  function findObject(model, kind, id) {
    const all = [];
    (function walk(pkg) {
      for (const key of ['tables', 'views', 'references', 'procedures', 'sequences', 'triggers']) {
        (pkg[key] || []).forEach(x => all.push(x));
      }
      (pkg.packages || []).forEach(walk);
    })(model.rootPackage);
    return all.find(x => x.id === id && matchKind(x, kind));
  }
  function matchKind(obj, kind) {
    if (kind === 'tables') return obj.type === 'table';
    if (kind === 'views') return obj.type === 'view';
    if (kind === 'references') return obj.type === 'reference';
    if (kind === 'procedures') return obj.type === 'procedure';
    if (kind === 'sequences') return obj.type === 'sequence';
    if (kind === 'triggers') return obj.type === 'trigger';
    return false;
  }
  function findTable(model, id) { return model.tables.find(t => t.id === id); }

  /* 统一的“打开对象”入口（联动多标签页） */
  function openObject(kind, id, opts) {
    state.current = { kind, id };
    const m = activeModel();

    if (m) {
      let tab = state.tabs.find(t => t.modelId === state.activeId && t.kind === kind && (id ? t.objId === id : true));
      if (!tab) {
        let title = '', subTitle = '', icon = 'table';
        if (kind === 'overview') {
          title = m.model.name || m.name;
          subTitle = m.path;
          icon = 'overview';
        } else if (kind === 'diagram') {
          const targetTable = id ? findTable(m.model, id) : null;
          title = targetTable ? (targetTable.code + ' 关系图') : '模型关系图';
          icon = 'diagram';
        } else if (kind === 'diff') {
          title = '模型对比';
          icon = 'diff';
        } else if (kind === 'table') {
          const t = findTable(m.model, id);
          if (t) {
            const lbl = formatTreeLabel(t.code, t.name, false);
            title = lbl.main + (lbl.sub ? ` (${lbl.sub})` : '');
            subTitle = t.code + ' ' + (t.name || '') + (t.comment ? ' — ' + t.comment : '');
            icon = 'table';
          } else {
            title = '数据表';
          }
        } else if (kind === 'views') {
          const v = findObject(m.model, 'views', id);
          title = v ? (v.code || v.name) : '视图';
          icon = 'view';
        } else if (kind === 'references') {
          const r = findObject(m.model, 'references', id);
          title = r ? (r.code || r.name) : '外键关系';
          icon = 'reference';
        } else if (kind === 'procedures') {
          const p = findObject(m.model, 'procedures', id);
          title = p ? (p.code || p.name) : '存储过程';
          icon = 'procedure';
        } else if (kind === 'sequences') {
          const s = findObject(m.model, 'sequences', id);
          title = s ? (s.code || s.name) : '序列';
          icon = 'sequence';
        } else if (kind === 'triggers') {
          const trg = findObject(m.model, 'triggers', id);
          title = trg ? (trg.code || trg.name) : '触发器';
          icon = 'trigger';
        }
        tab = {
          id: 'tab_' + (++state.seq),
          modelId: state.activeId,
          kind,
          objId: id,
          title: title || '新标签',
          subTitle: subTitle || '',
          icon
        };
        state.tabs.push(tab);
      }
      state.activeTabId = tab.id;
    }

    renderDocTabs();
    markTree();
    renderContent(opts);
  }

  /* ---------------- 内容渲染 ---------------- */
  function renderContent(opts) {
    const box = $('#content');
    if (!box) return;
    box.className = 'content';
    box.innerHTML = '';
    updateWindowTitle();
    const m = activeModel();
    if (!m || !state.current) { renderWelcome(box); return; }
    const kind = state.current.kind, id = state.current.id;
    if (kind === 'overview') return renderOverview(box, m);
    if (kind === 'diagram') return renderDiagram(box, m, id ? findTable(m.model, id) : null);
    if (kind === 'diff') return renderDiffPage(box, m);
    if (kind === 'table') { const t = findTable(m.model, id); if (t) return renderTable(box, m, t, opts); }
    if (kind === 'views') { const v = findObject(m.model, 'views', id); if (v) return renderView(box, m, v); }
    if (kind === 'references') { const r = findObject(m.model, 'references', id); if (r) return renderReference(box, m, r); }
    if (kind === 'procedures') { const p = findObject(m.model, 'procedures', id); if (p) return renderProcedure(box, p); }
    if (kind === 'sequences') { const s = findObject(m.model, 'sequences', id); if (s) return renderSequence(box, s); }
    if (kind === 'triggers') { const t = findObject(m.model, 'triggers', id); if (t) return renderTriggerTop(box, t); }
    renderOverview(box, m);
  }

  /* ---- 欢迎页 ---- */
  function renderWelcome(box) {
    const recents = getRecent();
    const recentHtml = recents.length ? (
      '<div class="card recent-panel">' +
      '<div class="recent-head"><svg class="ic" style="color:var(--text-3)"><use href="#i-refresh"/></svg>' +
      '<h3>最近打开</h3><span class="rc-hint">双击列表快速继续上次的工作</span>' +
      '<button class="btn btn-mini" id="wl-clear-recent">清空记录</button></div>' +
      '<div class="recent-list">' + recents.map(p => {
        const base = p.split(/[\\/]/).pop();
        return '<div class="recent-item" data-path="' + esc(p) + '">' + iconSvg('file') +
          '<span class="ri-name">' + esc(base) + '</span><span class="path" title="' + esc(p) + '">' + esc(p) + '</span>' +
          '<span class="ri-del" data-del="' + esc(p) + '" title="从列表移除">×</span></div>';
      }).join('') + '</div></div>'
    ) : '';
    box.innerHTML =
      '<div class="welcome">' +
      '<div class="wl-hero">' +
      '<img class="wl-mark" src="../resources/icon.png" alt="ModelVista" />' +
      '<div class="wl-eyebrow">PowerDesigner Model Studio</div>' +
      '<h1>把每一个数据模型<br><span>看得更清楚</span></h1>' +
      '<p>打开 PDM，秒搜表与字段，导出漂亮的数据字典。<br>ModelVista 让数据模型阅读变成一种享受。</p>' +
      '<div class="wl-actions"><button class="btn btn-primary btn-lg" id="wl-open">' + iconSvg('folder') + ' 打开 PDM 文件</button>' +
      '<button class="btn btn-lg" id="wl-help">' + iconSvg('keyboard') + ' 快捷键</button></div>' +
      '<div class="wl-drop-hint">或将 <b>.pdm</b> 文件直接拖入窗口</div>' +
      '</div>' +
      '<div class="wl-grid">' +
      '<div class="card wl-card"><div class="wc-ico">' + iconSvg('search') + '</div><div><h3>极速搜索</h3><p>输入关键字即时定位表、字段与注释，支持跨多个模型文件</p></div></div>' +
      '<div class="card wl-card"><div class="wc-ico">' + iconSvg('table') + '</div><div><h3>表结构查看</h3><p>字段精度、主键约束、索引、外键、触发器与多方言 DDL 一应俱全</p></div></div>' +
      '<div class="card wl-card"><div class="wc-ico">' + iconSvg('network') + '</div><div><h3>ER 关系图</h3><p>可视化展示表间引用关系，支持缩放平移与高清图片导出</p></div></div>' +
      '<div class="card wl-card"><div class="wc-ico">' + iconSvg('download') + '</div><div><h3>多格式导出</h3><p>交互式 HTML / Word / Excel / Markdown / CSV / SQL / PDF</p></div></div>' +
      '</div>' + recentHtml + '</div>';

    $('#wl-open').addEventListener('click', openDialog);
    $('#wl-help').addEventListener('click', showAbout);
    const clearBtn = $('#wl-clear-recent');
    if (clearBtn) clearBtn.addEventListener('click', e => {
      e.stopPropagation();
      localStorage.removeItem(RECENT_KEY);
      window.native.clearRecents();
      renderContent();
      toast('最近文件记录已清除', 'ok');
    });
    const rl = box.querySelector('.recent-list');
    if (rl) rl.addEventListener('click', e => {
      const del = e.target.closest('.ri-del');
      if (del) {
        e.stopPropagation();
        const p = del.dataset.del;
        const list = getRecent().filter(x => x !== p);
        localStorage.setItem(RECENT_KEY, JSON.stringify(list));
        window.native.removeRecent(p);
        renderContent();
        return;
      }
      const item = e.target.closest('.recent-item');
      if (item) openPaths([item.dataset.path]);
    });
  }

  /* ---- 模型概览 ---- */
  function renderOverview(box, m) {
    const s = m.model.stats;
    const model = m.model;
    const tableRows = model.tables.map((t, i) =>
      '<tr data-open="tables:' + t.id + '" style="cursor:pointer">' +
      '<td class="tc">' + (i + 1) + '</td>' +
      '<td class="mono">' + esc(t.code) + '</td>' +
      '<td>' + esc(t.name) + '</td>' +
      '<td class="tc">' + t.columns.length + '</td>' +
      '<td>' + esc(t.comment || '') + '</td></tr>'
    ).join('');
    box.innerHTML =
      '<div class="panel-pad">' +
      '<div class="oh-title-row" style="margin-bottom:14px"><div>' +
      '<div class="oh-crumb">' + esc(m.path) + '</div>' +
      '<div class="oh-title" style="font-size:20px">' + esc(model.name || m.name) + '</div>' +
      (model.comment ? '<div class="oh-comment">' + esc(model.comment) + '</div>' : '') +
      '</div></div>' +
      (s.tables === 0 && s.views === 0 ?
        '<div class="warn-banner">⚠ 该模型未识别到任何数据表。可能原因：文件不是 PowerDesigner 标准格式、编码异常或文件损坏。' +
        '如果此文件在 PowerDesigner 中能正常打开，请提供该文件样例以增强兼容性。</div>' : '') +
      '<div class="stat-grid">' +
      '<div class="card stat-card accent"><div class="num">' + s.tables + '</div><div class="lbl">数据表</div></div>' +
      '<div class="card stat-card"><div class="num">' + s.columns + '</div><div class="lbl">字段总数</div></div>' +
      '<div class="card stat-card"><div class="num">' + s.views + '</div><div class="lbl">视图</div></div>' +
      '<div class="card stat-card"><div class="num">' + s.references + '</div><div class="lbl">外键关系</div></div>' +
      '<div class="card stat-card"><div class="num">' + s.procedures + '</div><div class="lbl">存储过程</div></div>' +
      '<div class="card stat-card"><div class="num">' + s.triggers + '</div><div class="lbl">触发器</div></div>' +
      '</div>' +
      (model.tables.length ?
        '<div class="cols-toolbar" style="margin-bottom:10px">' +
        '<input id="ov-filter" type="text" placeholder="过滤数据表（代码 / 名称 / 备注）…" style="height:28px;padding:0 10px;border:1px solid var(--border-strong);border-radius:6px;outline:none;width:300px;flex-shrink:0" />' +
        '<span id="ov-count" style="font-size:11.5px;color:var(--text-3)">共 ' + model.tables.length + ' 张</span>' +
        '</div>' +
        '<div class="card card-fill"><table class="data-table">' +
        '<thead><tr><th style="width:44px">#</th><th style="width:220px">表代码</th><th>表名称</th><th style="width:70px">字段数</th><th>备注</th></tr></thead>' +
        '<tbody id="ov-tbody">' + tableRows + '</tbody></table></div>' : '') +
      '</div>';

    const ovf = box.querySelector('#ov-filter');
    if (ovf) {
      const tbody = box.querySelector('#ov-tbody');
      const rows = Array.from(tbody.rows);
      rows.forEach(tr => {
        tr.dataset.search = (tr.cells[1].textContent + '\n' + tr.cells[2].textContent + '\n' + tr.cells[4].textContent).toLowerCase();
      });
      const cnt = box.querySelector('#ov-count');
      ovf.addEventListener('input', () => {
        const kw = ovf.value.trim().toLowerCase();
        let shown = 0;
        for (const tr of rows) {
          const hit = !kw || tr.dataset.search.indexOf(kw) >= 0;
          tr.style.display = hit ? '' : 'none';
          if (hit) shown++;
        }
        if (cnt) cnt.textContent = kw ? ('匹配 ' + shown + ' / ' + rows.length + ' 张') : ('共 ' + rows.length + ' 张');
      });
    }
  }

  /* ---- 表结构视图 ---- */
  function renderTable(box, m, table, opts) {
    box.classList.add('content-table');
    const model = m.model;
    const fks = model.references.filter(r => r.childTableId === table.id);
    const fkd = model.references.filter(r => r.parentTableId === table.id);

    const colRows = table.columns.map((c, i) => {
      const isFk = fks.some(r => r.joins.some(j => j.childColId === c.id));
      return '<tr data-col="' + c.id + '">' +
        '<td class="tc">' + (i + 1) + '</td>' +
        '<td class="mono"><b>' + esc(c.code) + '</b>' + (c.isPK ? '<span class="pk-tag">PK</span>' : '') + (isFk ? '<span class="fk-tag">FK</span>' : '') + '</td>' +
        '<td>' + esc(c.name) + '</td>' +
        '<td class="mono tc">' + esc(c.dataType || (c.length ? '(' + c.length + (c.precision ? ',' + c.precision : '') + ')' : '')) + '</td>' +
        '<td class="tc">' + esc(c.length || '') + '</td>' +
        '<td class="tc mono" style="color:var(--text-2)">' + esc(c.precision || '') + '</td>' +
        '<td class="tc">' + (c.mandatory ? '<span class="nn">NOT NULL</span>' : '') + '</td>' +
        '<td class="tc">' + (c.identity ? '自增' : '') + '</td>' +
        '<td class="mono">' + esc(c.defaultValue || '') + '</td>' +
        '<td class="col-comment">' + esc(c.comment || '') + '</td></tr>';
    }).join('');

    const ixRows = table.indexes.map(ix => {
      const cols = ix.columns.map(x => {
        const c = table.columns.find(cc => cc.id === x.colId);
        return esc(c ? c.code : '?') + (x.sortOrder === 'DESC' ? ' DESC' : '');
      }).join(', ');
      return '<tr><td class="mono"><b>' + esc(ix.code || ix.name) + '</b></td><td>' + esc(ix.name || '') + '</td>' +
        '<td class="tc">' + (ix.unique ? '<span class="pk-tag">UNIQUE</span>' : '普通') + '</td>' +
        '<td class="mono">' + cols + '</td></tr>';
    }).join('');

    function fkHtml(list, isChild) {
      if (!list.length) return '<div style="color:var(--text-3);padding:8px">无</div>';
      return '<div class="ref-list">' + list.map(r => {
        const other = findTable(model, isChild ? r.parentTableId : r.childTableId);
        const joins = r.joins.map(j => {
          const cc = table.columns.find(c => c.id === j.childColId);
          const pc = other ? other.columns.find(c => c.id === j.parentColId) : null;
          return esc(cc ? cc.code : '?') + ' <span class="arrow">→</span> ' + esc(other ? other.code : '?') + '.' + esc(pc ? pc.code : '?');
        }).join('；');
        return '<div class="card ref-item">' +
          '<div class="ri-head"><span class="mono"><b>' + esc(r.code || r.name) + '</b></span>' +
          '<span style="color:var(--text-3);font-weight:400">' + esc(r.name || '') + '</span></div>' +
          '<div>' + (isChild ? '引用' : '被引用') + '：<a class="ri-link" data-open="tables:' + (other ? other.id : '') + '">' +
          esc(other ? (other.code + ' — ' + other.name) : '(外部表)') + '</a></div>' +
          '<div class="mono" style="font-size:11px">' + (joins || '（未定义字段映射）') + '</div></div>';
      }).join('') + '</div>';
    }

    const trgRows = table.triggers.map(t =>
      '<tr><td class="mono">' + esc(t.code || t.name) + '</td><td>' + esc(t.name || '') + '</td>' +
      '<td class="tc">' + esc(t.timing || '') + '</td><td class="tc">' + esc(t.event || '') + '</td></tr>'
    ).join('');

    const pk = table.keys.find(k => k.id === table.primaryKeyId);
    let curDialect = state.ddlDialect || 'mysql';
    let ddl = Exporter.genTableSql(model, table, curDialect);
    const pkLine = pk ? '<div style="margin-left:auto;font-size:12px;color:var(--text-2)">主键：<b class="mono">' +
      esc(pk.columns.map(id2 => { const c = table.columns.find(cc => cc.id === id2); return c ? c.code : ''; }).join(', ')) +
      '</b></div>' : '';
    const trgSql = table.triggers.filter(t => t.sql)
      .map(t => '<h4 style="margin:14px 0 6px;font-size:12px">' + esc(t.code || t.name) + '</h4><pre class="sql">' + sqlHighlight(t.sql) + '</pre>').join('');

    box.innerHTML =
      '<div class="obj-header">' +
      '<div class="oh-title-row">' +
      '<span class="oh-icon">' + iconSvg('table') + '</span>' +
      '<span class="oh-title">' + esc(table.code) + '</span>' +
      '<span class="oh-code">' + esc(table.name) + '</span>' +
      '<div class="oh-actions">' +
      '<button class="btn btn-mini" data-act="copy-cols" title="复制所有字段名 (逗号分隔)">' + iconSvg('copy') + ' 复制全部字段</button>' +
      '<button class="btn btn-mini" data-act="copy-cols-alias" title="复制带别名字段名 (如 t.USER_ID, ...)">' + iconSvg('copy') + ' 带别名复制</button>' +
      '<button class="btn btn-mini" data-act="sql">生成 SQL</button>' +
      '<button class="btn btn-mini" data-act="er">关系图</button>' +
      '<button class="btn btn-mini" data-act="copy-sql">复制建表 SQL</button>' +
      '</div></div>' +
      (table.comment ? '<p class="oh-comment">' + esc(table.comment) + '</p>' : '') +
      '</div>' +
      '<div class="tabs">' +
      '<div class="tab active" data-tab="cols">字段<span class="n">' + table.columns.length + '</span></div>' +
      '<div class="tab" data-tab="keys">约束<span class="n">' + table.keys.length + '</span></div>' +
      '<div class="tab" data-tab="ix">索引<span class="n">' + table.indexes.length + '</span></div>' +
      '<div class="tab" data-tab="fk">外键<span class="n">' + (fks.length + fkd.length) + '</span></div>' +
      '<div class="tab" data-tab="trg">触发器<span class="n">' + table.triggers.length + '</span></div>' +
      '<div class="tab" data-tab="ddl">DDL</div>' +
      '</div>' +
      '<div class="obj-body" data-pane="cols">' +
      '<div class="cols-toolbar">' +
      '<input id="col-filter" type="text" placeholder="在当前表内过滤字段… (Ctrl+F)" style="height:28px;padding:0 10px;border:1px solid var(--border-strong);border-radius:6px;outline:none;width:280px;flex-shrink:0" />' +
      pkLine + '</div>' +
      '<div class="card card-fill"><table class="data-table" id="col-table">' +
      '<thead><tr><th style="width:40px" class="tc">#</th><th style="width:190px">字段代码</th><th>字段名称</th>' +
      '<th style="width:130px">类型</th><th style="width:50px">长度</th><th style="width:50px" class="tc">精度</th><th style="width:84px">约束</th>' +
      '<th style="width:44px">自增</th><th style="width:90px">默认值</th><th>备注</th></tr></thead>' +
      '<tbody>' + colRows + '</tbody></table></div></div>' +
      '<div class="obj-body hidden" data-pane="keys">' +
      (table.keys.length ? '<div class="card" style="overflow:auto"><table class="data-table">' +
        '<thead><tr><th>约束代码</th><th>约束名称</th><th style="width:150px">类型</th><th>所含字段</th></tr></thead>' +
        '<tbody>' + table.keys.map(k => {
          const isPk = k.id === table.primaryKeyId;
          const colNames = k.columns.map(id2 => { const c = table.columns.find(cc => cc.id === id2); return c ? c.code : id2; }).join(', ');
          return '<tr><td class="mono"><b>' + esc(k.code || k.name) + '</b></td><td>' + esc(k.name || '') + '</td>' +
            '<td>' + (isPk ? '<span class="pk-tag">主键约束 (PK)</span>' : '<span class="fk-tag">唯一键约束</span>') + '</td>' +
            '<td class="mono">' + esc(colNames) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div style="color:var(--text-3)">该表未定义显式键约束</div>') +
      '</div>' +
      '<div class="obj-body hidden" data-pane="ix">' +
      (ixRows ? '<div class="card" style="overflow:auto"><table class="data-table">' +
        '<thead><tr><th>索引代码</th><th>索引名称</th><th style="width:90px">类型</th><th>字段</th></tr></thead>' +
        '<tbody>' + ixRows + '</tbody></table></div>' : '<div style="color:var(--text-3)">该表未定义索引</div>') +
      '</div>' +
      '<div class="obj-body hidden" data-pane="fk">' +
      '<h3 style="font-size:13px;margin:0 0 8px">本表引用（' + fks.length + '）</h3>' + fkHtml(fks, true) +
      '<h3 style="font-size:13px;margin:16px 0 8px">被引用（' + fkd.length + '）</h3>' + fkHtml(fkd, false) +
      '</div>' +
      '<div class="obj-body hidden" data-pane="trg">' +
      (trgRows ? '<div class="card" style="overflow:auto"><table class="data-table">' +
        '<thead><tr><th>触发器</th><th>名称</th><th style="width:80px">时机</th><th style="width:80px">事件</th></tr></thead>' +
        '<tbody>' + trgRows + '</tbody></table></div>' : '<div style="color:var(--text-3)">该表未定义触发器</div>') +
      trgSql + '</div>' +
      '<div class="obj-body hidden" data-pane="ddl">' +
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">' +
      '<span style="font-size:12px;color:var(--text-2)">SQL 方言：</span>' +
      '<select id="ddl-dialect" class="sel">' +
      '<option value="mysql"' + (curDialect === 'mysql' ? ' selected' : '') + '>MySQL</option>' +
      '<option value="oracle"' + (curDialect === 'oracle' ? ' selected' : '') + '>Oracle</option>' +
      '<option value="pg"' + (curDialect === 'pg' ? ' selected' : '') + '>PostgreSQL</option>' +
      '<option value="sqlserver"' + (curDialect === 'sqlserver' ? ' selected' : '') + '>SQL Server</option>' +
      '<option value="dm"' + (curDialect === 'dm' ? ' selected' : '') + '>达梦 (DM)</option>' +
      '</select>' +
      '<button class="btn btn-mini" data-act="copy-ddl">复制当前 SQL</button>' +
      '<button class="btn btn-mini" data-act="save-ddl">另存为 .sql 文件</button>' +
      '</div>' +
      '<pre class="sql" id="ddl-code">' + sqlHighlight(ddl) + '</pre></div>';

    box.querySelector('.tabs').addEventListener('click', e => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      box.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
      box.querySelectorAll('[data-pane]').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== tab.dataset.tab));
    });

    /* 方言切换 */
    const dialectSel = box.querySelector('#ddl-dialect');
    if (dialectSel) {
      dialectSel.addEventListener('change', () => {
        curDialect = dialectSel.value;
        state.ddlDialect = curDialect;
        try { localStorage.setItem('mv_ddl_dialect', curDialect); } catch (e) {}
        ddl = Exporter.genTableSql(model, table, curDialect);
        const codeEl = box.querySelector('#ddl-code');
        if (codeEl) codeEl.innerHTML = sqlHighlight(ddl);
      });
    }

    const copyDdlBtn = box.querySelector('[data-act="copy-ddl"]');
    if (copyDdlBtn) {
      copyDdlBtn.addEventListener('click', async () => {
        await navigator.clipboard.writeText(ddl);
        toast('当前 SQL 脚本已复制到剪贴板', 'ok');
      });
    }
    const saveDdlBtn = box.querySelector('[data-act="save-ddl"]');
    if (saveDdlBtn) {
      saveDdlBtn.addEventListener('click', async () => {
        const r = await Exporter.saveText(Exporter.safeName(table.code) + '.sql', ddl, [{ name: 'SQL 文件', extensions: ['sql'] }]);
        if (r && r.ok) { toast('已保存：' + r.path, 'ok'); window.native.showInFolder(r.path); }
      });
    }

    box.querySelector('.oh-actions').addEventListener('click', async e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'sql') { box.querySelector('.tab[data-tab="ddl"]').click(); }
      else if (act === 'er') { openDiagram(m, table); }
      else if (act === 'copy-sql') {
        await navigator.clipboard.writeText(ddl);
        toast('建表 SQL 已复制到剪贴板', 'ok');
      }
      else if (act === 'copy-cols') {
        const cols = table.columns.map(c => c.code).join(', ');
        await navigator.clipboard.writeText(cols);
        toast('已复制 ' + table.columns.length + ' 个字段名（逗号分隔）', 'ok');
      }
      else if (act === 'copy-cols-alias') {
        const alias = table.code.slice(0, 1).toLowerCase() + '.';
        const cols = table.columns.map(c => alias + c.code).join(', ');
        await navigator.clipboard.writeText(cols);
        toast('已复制带别名字段名（' + alias + '...）', 'ok');
      }
    });

    const filter = box.querySelector('#col-filter');
    filter.addEventListener('input', () => {
      const q = filter.value.trim().toLowerCase();
      box.querySelectorAll('#col-table tbody tr').forEach(tr => {
        tr.style.display = (!q || tr.textContent.toLowerCase().includes(q)) ? '' : 'none';
      });
    });

    if (opts && opts.highlightCol) {
      const tr = box.querySelector('tr[data-col="' + opts.highlightCol + '"]');
      if (tr) {
        tr.style.background = '#fff3a3';
        setTimeout(() => { tr.style.transition = 'background 1.2s'; tr.style.background = ''; }, 1400);
        tr.scrollIntoView({ block: 'center' });
      }
    }
  }

  /* ---- 视图 ---- */
  function renderView(box, m, view) {
    const rows = view.columns.map((c, i) =>
      '<tr><td class="tc">' + (i + 1) + '</td><td class="mono">' + esc(c.code) + '</td><td>' + esc(c.name) + '</td>' +
      '<td class="mono tc">' + esc(c.dataType || '') + '</td><td>' + esc(c.comment || '') + '</td></tr>'
    ).join('');
    box.innerHTML =
      '<div class="obj-header"><div class="oh-title-row">' +
      '<span class="oh-icon" style="color:#8b5cf6;background:#f4ecff">' + iconSvg('view') + '</span>' +
      '<span class="oh-title">' + esc(view.code) + '</span>' +
      '<span class="oh-code">' + esc(view.name) + '</span></div>' +
      (view.comment ? '<p class="oh-comment">' + esc(view.comment) + '</p>' : '') + '</div>' +
      '<div class="obj-body">' +
      (rows ? '<div class="card" style="overflow:auto;margin-bottom:16px"><table class="data-table">' +
        '<thead><tr><th style="width:40px" class="tc">#</th><th style="width:200px">列代码</th><th>列名称</th>' +
        '<th style="width:140px">类型</th><th>备注</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '') +
      (view.sql ? '<h3 style="font-size:13px;margin:0 0 8px">视图 SQL</h3><pre class="sql">' + sqlHighlight(view.sql) + '</pre>'
        : '<div style="color:var(--text-3)">无 SQL 定义</div>') +
      '</div>';
  }

  /* ---- 外键关系 ---- */
  function renderReference(box, m, ref) {
    const model = m.model;
    const pt = findTable(model, ref.parentTableId);
    const ct = findTable(model, ref.childTableId);
    const joinRows = ref.joins.map(j => {
      const pc = pt ? pt.columns.find(c => c.id === j.parentColId) : null;
      const cc = ct ? ct.columns.find(c => c.id === j.childColId) : null;
      return '<tr><td class="mono">' + esc(pc ? pc.code : '?') + '</td><td class="tc">→</td><td class="mono">' + esc(cc ? cc.code : '?') + '</td></tr>';
    }).join('');
    box.innerHTML =
      '<div class="obj-header"><div class="oh-title-row">' +
      '<span class="oh-icon" style="color:var(--orange);background:#fff2e5">' + iconSvg('link') + '</span>' +
      '<span class="oh-title">' + esc(ref.code || ref.name) + '</span>' +
      '<span class="oh-code">' + esc(ref.name || '') + '</span></div></div>' +
      '<div class="obj-body">' +
      '<div class="card ref-item" style="margin-bottom:14px">' +
      '<div>子表（Many）：<a class="ri-link" data-open="tables:' + (ct ? ct.id : '') + '">' + esc(ct ? ct.code + ' — ' + ct.name : '(外部表)') + '</a></div>' +
      '<div>父表（One）：<a class="ri-link" data-open="tables:' + (pt ? pt.id : '') + '">' + esc(pt ? pt.code + ' — ' + pt.name : '(外部表)') + '</a></div>' +
      (ref.cardinality ? '<div style="font-size:11.5px;color:var(--text-2)">基数：' + esc(ref.cardinality) + '</div>' : '') +
      '</div>' +
      '<h3 style="font-size:13px;margin:0 0 8px">字段映射（父 → 子）</h3>' +
      '<div class="card" style="max-width:560px"><table class="data-table">' +
      '<thead><tr><th>父表字段</th><th style="width:50px" class="tc"></th><th>子表字段</th></tr></thead>' +
      '<tbody>' + (joinRows || '<tr><td colspan="3" style="color:var(--text-3)">未定义</td></tr>') + '</tbody></table></div>' +
      '<div style="margin-top:14px"><button class="btn btn-mini" id="ref-er">查看关系图</button></div>' +
      '</div>';
    box.querySelector('#ref-er').addEventListener('click', () => { if (ct) openDiagram(m, ct); });
  }

  /* ---- 存储过程 / 序列 / 顶层触发器 ---- */
  function renderProcedure(box, p) {
    box.innerHTML =
      '<div class="obj-header"><div class="oh-title-row">' +
      '<span class="oh-icon" style="color:#a16207;background:#fdf3da">' + iconSvg('cog') + '</span>' +
      '<span class="oh-title">' + esc(p.code || p.name) + '</span>' +
      '<span class="oh-code">' + esc(p.name || '') + '</span></div></div>' +
      '<div class="obj-body">' +
      (p.sql ? '<pre class="sql">' + sqlHighlight(p.sql) + '</pre>' : '<div style="color:var(--text-3)">无 SQL 定义</div>') +
      '</div>';
  }
  function renderSequence(box, s) {
    box.innerHTML =
      '<div class="obj-header"><div class="oh-title-row">' +
      '<span class="oh-icon" style="color:var(--green);background:#e6f7ef">' + iconSvg('hash') + '</span>' +
      '<span class="oh-title">' + esc(s.code || s.name) + '</span>' +
      '<span class="oh-code">' + esc(s.name || '') + '</span></div></div>' +
      '<div class="obj-body"><div class="card" style="max-width:480px"><table class="data-table">' +
      '<tr><th style="width:110px">起始值</th><td class="mono">' + esc(s.start || '-') + '</td></tr>' +
      '<tr><th>增量</th><td class="mono">' + esc(s.increment || '-') + '</td></tr>' +
      '<tr><th>最小值</th><td class="mono">' + esc(s.minValue || '-') + '</td></tr>' +
      '<tr><th>最大值</th><td class="mono">' + esc(s.maxValue || '-') + '</td></tr>' +
      '<tr><th>循环</th><td>' + esc(s.cycle || '-') + '</td></tr>' +
      (s.comment ? '<tr><th>备注</th><td>' + esc(s.comment) + '</td></tr>' : '') +
      '</table></div></div>';
  }
  function renderTriggerTop(box, t) {
    box.innerHTML =
      '<div class="obj-header"><div class="oh-title-row">' +
      '<span class="oh-icon" style="color:var(--red);background:#ffe9ea">' + iconSvg('bolt') + '</span>' +
      '<span class="oh-title">' + esc(t.code || t.name) + '</span>' +
      '<span class="oh-code">' + esc(t.name || '') + '</span></div></div>' +
      '<div class="obj-body">' +
      (t.sql ? '<pre class="sql">' + sqlHighlight(t.sql) + '</pre>' : '<div style="color:var(--text-3)">无 SQL 定义</div>') +
      '</div>';
  }

  /* ---- 模型对比 ---- */
  function renderDiffPage(box) {
    if (!state.models.length) { box.innerHTML = '<div class="panel-pad"><div style="color:var(--text-3)">请先打开 PDM 文件</div></div>'; return; }
    const opts = state.models.map(m => '<option value="' + m.id + '">' + esc(m.model.name || m.name) + '</option>').join('');
    const otherId = state.models.length > 1 ? state.models.find(m => m.id !== state.activeId).id : state.activeId;
    box.innerHTML =
      '<div class="panel-pad">' +
      '<div class="oh-title-row" style="margin-bottom:4px"><div class="oh-title" style="font-size:18px">模型对比</div></div>' +
      '<div style="color:var(--text-2);font-size:12px;margin-bottom:14px">比较两个模型的数据字典差异：新增 / 删除 / 修改的表与字段（数据字典校对）</div>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px">' +
      '<select id="diff-a" class="sel" style="min-width:220px">' + opts + '</select>' +
      '<span style="color:var(--text-3);font-size:12px">对比</span>' +
      '<select id="diff-b" class="sel" style="min-width:220px"><option value="' + otherId + '" selected>' + esc(state.models.find(m => m.id === otherId).model.name || state.models.find(m => m.id === otherId).name) + '</option></select>' +
      '<button class="btn btn-primary btn-mini" id="diff-run">开始对比</button>' +
      '<button class="btn btn-mini hidden" id="diff-md">导出 Markdown 报告</button>' +
      '</div>' +
      '<div id="diff-result" style="margin-top:14px"></div></div>';

    const selB = box.querySelector('#diff-b');
    selB.innerHTML = opts;
    selB.value = otherId;
    const selA = box.querySelector('#diff-a');
    selA.value = state.activeId;
    let lastR = null, lastNames = null;

    box.querySelector('#diff-run').addEventListener('click', () => {
      const ea = state.models.find(m => m.id === selA.value);
      const eb = state.models.find(m => m.id === selB.value);
      if (!ea || !eb) { toast('请选择要对比的模型', 'err'); return; }
      lastR = window.Diff.compare(ea.model, eb.model);
      lastNames = [ea.model.name || ea.name, eb.model.name || eb.name];
      renderDiffResult(lastR);
      box.querySelector('#diff-md').classList.remove('hidden');
    });
    box.querySelector('#diff-md').addEventListener('click', async () => {
      if (!lastR) return;
      const md = window.Diff.toMarkdown(lastR, lastNames[0], lastNames[1]);
      const r = await Exporter.saveText('模型对比报告.md', md, [{ name: 'Markdown 文件', extensions: ['md'] }]);
      if (r.ok) { toast('已导出：' + r.path, 'ok'); window.native.showInFolder(r.path); }
    });
  }

  function renderDiffResult(r) {
    const el = document.querySelector('#diff-result');
    let html = '<div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">' +
      '<div class="card stat-card"><div class="num" style="color:var(--green)">' + r.summary.added + '</div><div class="lbl">新增表（仅 B 有）</div></div>' +
      '<div class="card stat-card"><div class="num" style="color:var(--red)">' + r.summary.removed + '</div><div class="lbl">删除表（仅 A 有）</div></div>' +
      '<div class="card stat-card"><div class="num" style="color:var(--orange)">' + r.summary.changed + '</div><div class="lbl">内容有变化</div></div>' +
      '<div class="card stat-card"><div class="num">' + r.summary.same + '</div><div class="lbl">完全一致</div></div></div>';
    const section = (title, inner) => '<h3 style="font-size:13px;margin:16px 0 8px">' + title + '</h3><div class="card" style="padding:10px 14px">' + inner + '</div>';
    if (!r.summary.added && !r.summary.removed && !r.summary.changed) {
      html += '<div class="card" style="padding:20px;text-align:center;color:var(--text-2)">两个数据字典内容完全一致 ✓</div>';
    } else {
      if (r.added.length) {
        html += section('新增表（' + r.added.length + '）', r.added.map(t =>
          '<div class="diff-line"><span class="mono">' + iconSvg('table') + ' ' + esc(t.code) + '</span><span>' + esc(t.name) + '</span><span class="col-comment">' + esc(t.comment || '') + '</span></div>').join(''));
      }
      if (r.removed.length) {
        html += section('删除表（' + r.removed.length + '）', r.removed.map(t =>
          '<div class="diff-line"><span class="mono">' + iconSvg('table') + ' ' + esc(t.code) + '</span><span>' + esc(t.name) + '</span><span class="col-comment">' + esc(t.comment || '') + '</span></div>').join(''));
      }
      if (r.changed.length) {
        html += '<h3 style="font-size:13px;margin:16px 0 8px">变更表（' + r.changed.length + '）</h3>' +
          r.changed.map(x => '<div class="card diff-table-card" style="margin-bottom:10px">' +
            '<div style="font-weight:700;margin-bottom:6px"><span class="mono">' + esc(x.b.code) + '</span> — ' + esc(x.b.name) + '</div>' +
            x.changes.map(c => '<div class="diff-line"><span class="diff-type">' + esc(c.type) + '</span><span>' + esc(c.detail) + '</span></div>').join('') +
            '</div>').join('');
      }
      if (r.views.added.length || r.views.removed.length) {
        let inner = '';
        if (r.views.added.length) inner += r.views.added.map(v => '<div class="diff-line"><span class="diff-type">新增视图</span><span class="mono">' + esc(v.code) + '</span><span>' + esc(v.name) + '</span></div>').join('');
        if (r.views.removed.length) inner += r.views.removed.map(v => '<div class="diff-line"><span class="diff-type">删除视图</span><span class="mono">' + esc(v.code) + '</span><span>' + esc(v.name) + '</span></div>').join('');
        html += section('视图差异', inner);
      }
    }
    el.innerHTML = html;
  }

  /* ---- ER 图 ---- */
  function renderDiagram(box, m, table) {
    box.classList.add('content-table');
    box.innerHTML = '';
    const holder = document.createElement('div');
    holder.style.cssText = 'flex:1 1 auto; min-height:0;';
    box.appendChild(holder);
    Diagram.render(holder, m.model, table, t => {
      openObject('table', t.id);
    });
    if (table) markTree();
  }
  function openDiagram(m, table) {
    openObject('diagram', table ? table.id : null);
  }

  /* ---------------- SQL 高亮 ---------------- */
  function sqlHighlight(sql) {
    let s = esc(sql);
    s = s.replace(/(--[^\n]*)/g, '<span class="cm">$1</span>');
    s = s.replace(/('(?:[^'\\]|\\.)*')/g, '<span class="str">$1</span>');
    s = s.replace(/\b(CREATE|TABLE|PRIMARY|KEY|FOREIGN|REFERENCES|CONSTRAINT|NOT|NULL|DEFAULT|COMMENT|UNIQUE|INDEX|ON|ALTER|DROP|ADD|VIEW|AS|SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|AND|OR|BEGIN|END|IF|EXISTS|AUTO_INCREMENT|TRIGGER|PROCEDURE|FUNCTION|RETURNS|DECLARE|ENGINE|CHARSET)\b/gi, '<span class="kw">$1</span>');
    return s;
  }

  /* ---------------- 全局搜索 ---------------- */
  const SEARCH_RENDER_LIMIT = 80;
  const SEARCH_COLLECT_LIMIT = 2000;
  function doSearch(q) {
    const panel = $('#search-results');
    const list = $('#sr-list');
    const summary = $('#sr-summary');
    q = q.trim();
    if (!q) { panel.classList.add('hidden'); list.innerHTML = ''; panel._results = null; if (summary) summary.textContent = ''; return; }
    const kw = q.toLowerCase();
    const scopeAll = document.getElementById('opt-scope-all').checked;
    const withCols = document.getElementById('opt-include-cols').checked;
    const results = [];
    let truncated = false;
    const models = scopeAll ? state.models : (activeModel() ? [activeModel()] : []);

    outer:
    for (const entry of models) {
      const model = entry.model;
      for (const t of model.tables) {
        if (results.length >= SEARCH_COLLECT_LIMIT) { truncated = true; break outer; }
        if ((t.code || '').toLowerCase().includes(kw) || (t.name || '').toLowerCase().includes(kw) || (t.comment || '').toLowerCase().includes(kw)) {
          results.push({ entry: entry, type: 'table', id: t.id, code: t.code, name: t.name, comment: t.comment, file: entry.name, pkg: t._pkg || '', table: t });
        }
        if (withCols) {
          for (const c of t.columns) {
            if (results.length >= SEARCH_COLLECT_LIMIT) { truncated = true; break outer; }
            if ((c.code || '').toLowerCase().includes(kw) || (c.name || '').toLowerCase().includes(kw) || (c.comment || '').toLowerCase().includes(kw)) {
              results.push({ entry: entry, type: 'column', id: c.id, code: c.code, name: c.name, comment: c.comment, file: entry.name, tableCode: t.code, table: t });
            }
          }
        }
      }
      for (const v of model.views) {
        if (results.length >= SEARCH_COLLECT_LIMIT) { truncated = true; break outer; }
        if ((v.code || '').toLowerCase().includes(kw) || (v.name || '').toLowerCase().includes(kw)) {
          results.push({ entry: entry, type: 'view', id: v.id, code: v.code, name: v.name, comment: '', file: entry.name });
        }
      }
      for (const p of model.procedures) {
        if (results.length >= SEARCH_COLLECT_LIMIT) { truncated = true; break outer; }
        if ((p.code || '').toLowerCase().includes(kw) || (p.name || '').toLowerCase().includes(kw)) {
          results.push({ entry: entry, type: 'proc', id: p.id, code: p.code, name: p.name, comment: '', file: entry.name });
        }
      }
    }

    if (!results.length) {
      list.innerHTML = '<div class="search-empty">未找到匹配结果，试试更短的关键词</div>';
      if (summary) summary.textContent = '0 条';
    } else {
      const typeMap = { table: ['表', 't-table'], column: ['字段', 't-column'], view: ['视图', 't-view'], proc: ['过程', 't-proc'] };
      const rootNameOf = r => r.entry.model.name || r.entry.name;
      const re = hlRegex(q);
      list.innerHTML = results.slice(0, SEARCH_RENDER_LIMIT).map((r, i) => {
        const pair = typeMap[r.type];
        const nameText = (r.name || '') + (r.comment ? ' — ' + r.comment : '');
        let loc = '';
        if (r.type === 'column') loc = '表 ' + r.tableCode;
        else if (r.type === 'table' && r.pkg && r.pkg !== rootNameOf(r)) loc = r.pkg;
        return '<div class="search-result-item' + (i === 0 ? ' active' : '') + '" data-i="' + i + '">' +
          '<div class="sr-row">' +
          '<span class="sr-badge ' + pair[1] + '">' + pair[0] + '</span>' +
          '<span class="sr-code">' + hl(r.code, q, re) + '</span>' +
          '<span class="sr-name">' + hl(nameText, q, re) + '</span>' +
          '</div>' +
          '<div class="sr-row sr-row2">' +
          '<span class="sr-loc">' + esc(loc) + '</span>' +
          '<span class="sr-file" title="' + esc(r.entry.path) + '">' + esc(r.file) + '</span>' +
          '</div></div>';
      }).join('') +
        (results.length > SEARCH_RENDER_LIMIT
          ? '<div class="search-empty">共 ' + results.length + (truncated ? '+' : '') + ' 条结果，仅显示前 ' + SEARCH_RENDER_LIMIT + ' 条，请细化关键词</div>'
          : '');
      if (summary) summary.textContent = '共 ' + results.length + (truncated ? '+' : '') + ' 条';
    }
    panel.classList.remove('hidden');
    panel._results = results;
    panel._active = 0;
  }

  function setSearchActive(idx) {
    const panel = $('#search-results');
    const items = $$('#sr-list .search-result-item');
    if (!items.length) return;
    idx = Math.max(0, Math.min(idx, items.length - 1));
    items.forEach((el, i) => el.classList.toggle('active', i === idx));
    panel._active = idx;
    items[idx].scrollIntoView({ block: 'nearest' });
  }

  function hlRegex(q) {
    try {
      return new RegExp(esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    } catch (err) { return null; }
  }

  function hl(text, q, re) {
    const s = esc(text || '');
    if (!q) return s;
    const rx = re || hlRegex(q);
    if (!rx) return s;
    try {
      return s.replace(rx, m2 => '<mark>' + m2 + '</mark>');
    } catch (err) { return s; }
  }

  function gotoResult(r) {
    if (state.activeId !== r.entry.id) {
      state.activeId = r.entry.id;
      state.expanded.add(r.entry.id);
      renderTabs();
    }
    const m = r.entry;
    if (r.type === 'table') {
      openObject('table', r.id);
    } else if (r.type === 'column') {
      openObject('table', r.table.id, { highlightCol: r.id });
    } else if (r.type === 'view') {
      openObject('views', r.id);
    } else if (r.type === 'proc') {
      openObject('procedures', r.id);
    }
  }

  /* ---------------- 侧栏高亮联动 ---------------- */
  function markTree() {
    $$('#file-tabs .tree-row').forEach(r => r.classList.remove('active'));
    $$('#file-tabs .file-tab').forEach(r => r.classList.remove('active'));
    const actRow = document.querySelector('#file-tabs .file-tab[data-model-id="' + state.activeId + '"]');
    if (actRow) actRow.classList.add('active');
    if (!state.current || !state.current.id) return;
    const kind = state.current.kind;
    const id = state.current.id;
    const want = kind === 'table' ? 'tables' : kind;
    const findRow = () => $$('#file-tabs .tree-row').find(r => r.dataset.open === want + ':' + id);
    let target = findRow();
    if (!target && !state.expanded.has(state.activeId)) {
      state.expanded.add(state.activeId);
      renderTabs();
      target = findRow();
    }
    if (!target) return;
    target.classList.add('active');
    let p = target.parentElement;
    while (p && p.id !== 'file-tabs') {
      if (p.classList.contains('tree-children')) p.classList.remove('collapsed');
      const prev = p.previousElementSibling;
      if (prev && prev.classList.contains('tree-row')) prev.classList.add('expanded');
      p = p.parentElement;
    }
    target.scrollIntoView({ block: 'nearest' });
  }

  /* ---------------- 事件委托 ---------------- */
  function bindDelegates() {
    $('#file-tabs').addEventListener('click', e => {
      const row = e.target.closest('.tree-row');
      if (!row || !row.dataset.open) return;
      const parts = row.dataset.open.split(':');
      const kind = parts[0], id = parts[1];
      openObject(kind === 'tables' ? 'table' : kind, id);
    });

    $('#content').addEventListener('click', e => {
      const link = e.target.closest('[data-open]');
      if (!link || link.closest('.tree')) return;
      const parts = link.dataset.open.split(':');
      const kind = parts[0], id = parts[1];
      if (!id) return;
      openObject(kind === 'tables' ? 'table' : kind, id);
    });

    /* 双击单元格复制 */
    $('#content').addEventListener('dblclick', async e => {
      const td = e.target.closest('td');
      if (!td) return;
      const text = (td.innerText || '').trim();
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        toast('已复制：' + (text.length > 24 ? text.slice(0, 24) + '…' : text), 'ok');
      } catch (err) { toast('复制失败', 'err'); }
    });

    const resizer = $('#sidebar-resizer');
    let resizing = false;
    resizer.addEventListener('mousedown', () => { resizing = true; document.body.style.cursor = 'col-resize'; document.body.classList.add('resizing'); });
    window.addEventListener('mousemove', e => {
      if (!resizing) return;
      const w = Math.min(Math.max(e.clientX, 220), window.innerWidth * 0.55);
      document.documentElement.style.setProperty('--sidebar-w', w + 'px');
    });
    window.addEventListener('mouseup', () => {
      if (!resizing) return;
      resizing = false;
      document.body.style.cursor = '';
      document.body.classList.remove('resizing');
      try {
        const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w'), 10);
        if (w) localStorage.setItem('mv_sidebar_w', String(w));
      } catch (e) { /* ignore */ }
    });
  }

  function restoreSidebarWidth() {
    try {
      const w = parseInt(localStorage.getItem('mv_sidebar_w'), 10);
      if (w && w >= 220 && w <= window.innerWidth * 0.55) {
        document.documentElement.style.setProperty('--sidebar-w', w + 'px');
      }
    } catch (e) { /* ignore */ }
  }

  /* ---------------- 导出菜单 & 批量导出 ---------------- */
  function currentExportTarget() {
    const m = activeModel();
    if (!m || !state.current) return null;
    if (state.current.kind === 'table') {
      const t = findTable(m.model, state.current.id);
      if (t) return { model: m.model, table: t };
    }
    if (state.current.kind === 'views') {
      const v = findObject(m.model, 'views', state.current.id);
      if (v) return {
        model: m.model,
        table: {
          code: v.code || v.name, name: v.name, comment: v.comment,
          columns: v.columns.map(c => ({
            id: c.id, code: c.code, name: c.name, comment: c.comment,
            dataType: c.dataType, length: '', precision: '',
            isPK: false, mandatory: false, identity: false, defaultValue: ''
          })),
          keys: [], indexes: [], triggers: []
        }
      };
    }
    return null;
  }

  function bindExportMenu() {
    const menu = $('#export-menu');
    $('#btn-export').addEventListener('click', e => { e.stopPropagation(); menu.classList.toggle('hidden'); });
    document.addEventListener('click', () => menu.classList.add('hidden'));

    menu.addEventListener('click', async e => {
      const a = e.target.closest('a');
      if (!a) return;
      menu.classList.add('hidden');
      const act = a.dataset.act, fmt = a.dataset.fmt;
      const m = activeModel();
      if (!m) { toast('请先打开 PDM 文件', 'err'); return; }

      if (act === 'modal') {
        openExportModal(m);
        return;
      }

      try {
        let r;
        if (fmt === 'pdf') {
          r = await exportModelPdf(m.model);
        } else if (act === 'model') {
          r = await Exporter.exportModel(m.model, fmt);
        } else {
          const target = currentExportTarget();
          if (!target) { toast('请先选中要导出的表或视图', 'err'); return; }
          r = await Exporter.exportTable(target.model, target.table, fmt);
        }
        if (r && r.ok) { toast('已导出：' + r.path, 'ok'); window.native.showInFolder(r.path); }
        else if (r && r.canceled) { /* user canceled */ }
      } catch (err) { toast('导出失败：' + err.message, 'err'); }
    });

    bindExportModal();
  }

  async function exportTablePdf(model, table) {
    showLoading('正在生成 PDF，请稍候…');
    try {
      const html = Exporter.tableToHtml(model, table);
      const path = await window.native.exportPdf({ defaultName: Exporter.safeName(table.code || table.name) + '.pdf', html });
      return path ? { ok: true, path } : { ok: false, canceled: true };
    } finally {
      hideLoading();
    }
  }

  async function exportModelPdf(model, tableIds) {
    showLoading('正在生成 PDF，请稍候…');
    try {
      const html = Exporter.modelToHtml(model, tableIds);
      const base = Exporter.safeName(model.name || model.fileName.replace(/\.pdm$/i, ''));
      const path = await window.native.exportPdf({ defaultName: base + '_数据字典.pdf', html });
      return path ? { ok: true, path } : { ok: false, canceled: true };
    } finally {
      hideLoading();
    }
  }

  function openExportModal(m) {
    const modal = $('#export-modal');
    if (!modal) return;
    const model = m.model;
    const listEl = $('#em-table-list');
    const filterInput = $('#em-filter');
    if (filterInput) filterInput.value = '';

    listEl.innerHTML = model.tables.map(t => {
      return `<label class="em-table-item" data-table-code="${esc(t.code)}" data-table-name="${esc(t.name || '')}">
        <input type="checkbox" value="${t.id}" checked>
        <span class="mono" style="font-weight:600">${esc(t.code)}</span>
        <span style="color:var(--text-2);margin-left:4px">${esc(t.name || '')}</span>
      </label>`;
    }).join('');

    updateExportModalCount();
    modal.classList.remove('hidden');
  }

  function updateExportModalCount() {
    const total = $$('#em-table-list input[type="checkbox"]').length;
    const checked = $$('#em-table-list input[type="checkbox"]:checked').length;
    const cnt = $('#em-selected-count');
    if (cnt) cnt.textContent = `已选 ${checked} / ${total} 张表`;
  }

  function bindExportModal() {
    const modal = $('#export-modal');
    if (!modal) return;
    const closeBtn = $('#export-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
    const cancelBtn = $('#export-modal-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => modal.classList.add('hidden'));

    const selAll = $('#em-select-all');
    if (selAll) {
      selAll.addEventListener('click', () => {
        $$('#em-table-list input[type="checkbox"]').forEach(c => {
          if (c.closest('.em-table-item').style.display !== 'none') c.checked = true;
        });
        updateExportModalCount();
      });
    }

    const selNone = $('#em-select-none');
    if (selNone) {
      selNone.addEventListener('click', () => {
        $$('#em-table-list input[type="checkbox"]').forEach(c => {
          if (c.closest('.em-table-item').style.display !== 'none') c.checked = !c.checked;
        });
        updateExportModalCount();
      });
    }

    const listEl = $('#em-table-list');
    if (listEl) listEl.addEventListener('change', () => updateExportModalCount());

    const filterInput = $('#em-filter');
    if (filterInput) {
      filterInput.addEventListener('input', () => {
        const q = filterInput.value.trim().toLowerCase();
        $$('#em-table-list .em-table-item').forEach(item => {
          const match = !q || item.dataset.tableCode.toLowerCase().includes(q) || item.dataset.tableName.toLowerCase().includes(q);
          item.style.display = match ? '' : 'none';
        });
      });
    }

    $$('input[name="export-fmt"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const isSql = radio.value === 'sql';
        const dialectRow = $('#em-dialect-row');
        if (dialectRow) dialectRow.style.display = isSql ? 'flex' : 'none';
      });
    });

    const confirmBtn = $('#export-modal-confirm');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', async () => {
        const m = activeModel();
        if (!m) return;
        const checkedBoxes = Array.from($$('#em-table-list input[type="checkbox"]:checked'));
        if (!checkedBoxes.length) {
          toast('请至少勾选一张数据表', 'err');
          return;
        }
        const tableIds = checkedBoxes.map(b => b.value);
        const fmtRadio = document.querySelector('input[name="export-fmt"]:checked');
        const fmt = fmtRadio ? fmtRadio.value : 'html';
        const dialect = $('#export-sql-dialect') ? $('#export-sql-dialect').value : 'mysql';

        modal.classList.add('hidden');
        toast(`正在导出 ${tableIds.length} 张表...`);
        try {
          const r = fmt === 'pdf'
            ? await exportModelPdf(m.model, tableIds)
            : await Exporter.exportModel(m.model, fmt, dialect, tableIds);
          if (r && r.ok) {
            toast('数据字典已成功导出：' + r.path, 'ok');
            window.native.showInFolder(r.path);
          }
        } catch (err) {
          toast('导出失败：' + err.message, 'err');
        }
      });
    }
  }

  /* ---------------- 菜单动作（主进程） ---------------- */
  function bindMenuActions() {
    window.native.onMenuAction(payload => {
      const action = payload.action, arg = payload.arg;
      switch (action) {
        case 'menu:open-file':
          openDialog();
          break;
        case 'menu:export': {
          const m = activeModel();
          if (!m) { toast('请先打开 PDM 文件', 'err'); return; }
          const target = currentExportTarget();
          if (!target) { toast('请先选中要导出的表或视图', 'err'); return; }
          (arg === 'pdf' ? exportTablePdf(target.model, target.table) : Exporter.exportTable(target.model, target.table, arg)).then(r => {
            if (r && r.ok) { toast('已导出：' + r.path, 'ok'); window.native.showInFolder(r.path); }
          }).catch(err => toast('导出失败：' + err.message, 'err'));
          break;
        }
        case 'menu:export-all': {
          const m = activeModel();
          if (!m) { toast('请先打开 PDM 文件', 'err'); return; }
          Exporter.exportModel(m.model, 'html').then(r => {
            if (r.ok) { toast('已导出：' + r.path, 'ok'); window.native.showInFolder(r.path); }
          }).catch(err => toast('导出失败：' + err.message, 'err'));
          break;
        }
        case 'menu:gen-sql': {
          const m = activeModel();
          if (!m) { toast('请先打开 PDM 文件', 'err'); return; }
          Exporter.exportModel(m.model, 'sql').then(r => {
            if (r.ok) { toast('已导出建表脚本：' + r.path, 'ok'); window.native.showInFolder(r.path); }
          }).catch(err => toast('导出失败：' + err.message, 'err'));
          break;
        }
        case 'menu:diagram': {
          const m = activeModel();
          if (!m) { toast('请先打开 PDM 文件', 'err'); return; }
          const t = (state.current && state.current.kind === 'table') ? findTable(m.model, state.current.id) : null;
          openDiagram(m, t);
          break;
        }
        case 'menu:diff':
          if (!state.models.length) { toast('请先打开 PDM 文件', 'err'); return; }
          openObject('diff');
          break;
        case 'menu:refresh':
          renderTabs(); renderDocTabs(); renderContent();
          break;
        case 'menu:help':
          showAbout();
          break;
        case 'menu:about':
          showAbout();
          break;
        case 'menu:open-path':
          if (arg) openPaths([arg]);
          break;
        case 'menu:clear-recent':
          localStorage.removeItem(RECENT_KEY);
          window.native.clearRecents();
          toast('最近文件记录已清除', 'ok');
          if (!state.models.length) renderContent();
          break;
      }
    });
  }

  /* ---------------- 文件变更监听 ---------------- */
  function bindFileChange() {
    let pendingPath = null;
    window.native.onFileChanged(path => {
      pendingPath = path;
      const entry = state.models.find(m => m.path === path);
      document.getElementById('reload-msg').textContent = '检测到文件已修改：' + (entry ? entry.name : path);
      document.getElementById('reload-bar').classList.remove('hidden');
    });
    document.getElementById('btn-reload').addEventListener('click', () => {
      document.getElementById('reload-bar').classList.add('hidden');
      const entry = state.models.find(m => m.path === pendingPath);
      if (entry) reloadModel(entry);
    });
    document.getElementById('btn-ignore-reload').addEventListener('click', () => {
      document.getElementById('reload-bar').classList.add('hidden');
    });
  }

  /* ---------------- 搜索选项 ---------------- */
  const OPTS_KEY = 'mv_search_opts';
  function getSavedSearchOpts() {
    try { return JSON.parse(localStorage.getItem(OPTS_KEY)); } catch (e) { return null; }
  }
  function applySearchOpts() {
    const saved = getSavedSearchOpts();
    const all = document.getElementById('opt-scope-all');
    const cols = document.getElementById('opt-include-cols');
    if (!all || !cols) return;
    all.checked = saved ? !!saved.all : true;
    cols.checked = saved ? !!saved.cols : false;
  }
  function persistSearchOpts() {
    try {
      localStorage.setItem(OPTS_KEY, JSON.stringify({
        all: document.getElementById('opt-scope-all').checked,
        cols: document.getElementById('opt-include-cols').checked
      }));
    } catch (e) { /* ignore */ }
  }

  /* ---------------- 搜索框 ---------------- */
  function bindSearch() {
    const input = $('#global-search'), panel = $('#search-results'), list = $('#sr-list');
    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => doSearch(input.value), 180);
    });
    input.addEventListener('focus', () => { if (input.value.trim()) doSearch(input.value); });
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { panel.classList.add('hidden'); input.blur(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (panel.classList.contains('hidden')) doSearch(input.value);
        else setSearchActive((panel._active || 0) + 1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSearchActive((panel._active || 0) - 1);
        return;
      }
      if (e.key === 'Enter') {
        if (panel._results && panel._results.length) {
          const idx = panel._active || 0;
          gotoResult(panel._results[idx] || panel._results[0]);
          panel.classList.add('hidden');
        }
      }
    });
    list.addEventListener('mousemove', e => {
      const item = e.target.closest('.search-result-item');
      if (item) setSearchActive(+item.dataset.i);
    });
    list.addEventListener('click', e => {
      const item = e.target.closest('.search-result-item');
      if (!item || !panel._results) return;
      gotoResult(panel._results[+item.dataset.i]);
      panel.classList.add('hidden');
    });
    document.getElementById('opt-scope-all').addEventListener('change', () => {
      persistSearchOpts();
      if (input.value.trim()) doSearch(input.value);
    });
    document.getElementById('opt-include-cols').addEventListener('change', () => {
      persistSearchOpts();
      if (input.value.trim()) doSearch(input.value);
    });
    document.addEventListener('click', e => {
      if (!$('#search-box').contains(e.target)) panel.classList.add('hidden');
    });
  }

  /* ---------------- 拖拽打开 ---------------- */
  function bindDrop() {
    const mask = $('#drop-mask');
    let counter = 0;
    window.addEventListener('dragenter', e => { e.preventDefault(); counter++; mask.classList.remove('hidden'); });
    window.addEventListener('dragleave', e => { e.preventDefault(); counter--; if (counter <= 0) { counter = 0; mask.classList.add('hidden'); } });
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => {
      e.preventDefault();
      counter = 0; mask.classList.add('hidden');
      const files = Array.from(e.dataTransfer.files || []);
      const paths = files.map(f => {
        if (typeof f.path === 'string' && f.path) return f.path;
        return window.native.filePathForFile(f);
      }).filter(p => p && /\.(pdm|xml)$/i.test(p));
      if (!paths.length) { if (files.length) toast('请拖入 .pdm 文件', 'err'); return; }
      openPaths(paths);
    });
  }

  /* ---------------- 快捷键 ---------------- */
  function bindKeys() {
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); openDialog(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        if (state.activeTabId) closeDocTab(state.activeTabId);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        const colFilter = document.getElementById('col-filter');
        const colPane = colFilter ? colFilter.closest('[data-pane]') : null;
        if (colFilter && colPane && !colPane.classList.contains('hidden') &&
            state.current && state.current.kind === 'table') {
          colFilter.focus(); colFilter.select();
        } else {
          $('#global-search').focus(); $('#global-search').select();
        }
      }
    });
  }

  /* ---------------- 关于 ---------------- */
  function showAbout() {
    const modal = $('#about-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    window.native.appInfo().then(info => {
      const v = $('#about-version');
      if (v) v.textContent = 'v' + info.version + ' · Electron ' + info.electron;
      const sv = $('#sb-version');
      if (sv) sv.textContent = 'v' + info.version;
      const av = document.getElementById('about-version');
      if (av) av.title = 'Chromium ' + info.chrome + ' / Node ' + info.node;
    }).catch(() => {});
  }

  function bindAbout() {
    const modal = $('#about-modal');
    if (!modal) return;
    const close = $('#about-close');
    if (close) close.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
    const link = $('#about-github');
    if (link) link.addEventListener('click', () => window.native.openExternal('https://github.com/CGW-Dev1/model-vista'));
  }

  /* ---------------- 工具栏按钮 ---------------- */
  function bindToolbar() {
    $('#btn-open').addEventListener('click', openDialog);
    $('#btn-diff').addEventListener('click', () => {
      if (!state.models.length) { toast('请先打开 PDM 文件', 'err'); return; }
      openObject('diff');
    });
    $('#btn-theme').addEventListener('click', () => {
      applyTheme(!document.body.classList.contains('dark'));
    });
    $('#btn-diagram').addEventListener('click', () => {
      const m = activeModel();
      if (!m) { toast('请先打开 PDM 文件', 'err'); return; }
      const t = (state.current && state.current.kind === 'table') ? findTable(m.model, state.current.id) : null;
      openDiagram(m, t);
    });
    $('#btn-about').addEventListener('click', showAbout);
  }

  /* ---------------- 启动 ---------------- */
  async function init() {
    applyTheme(localStorage.getItem('mv_theme') === 'dark');
    applySearchOpts();
    restoreSidebarWidth();
    renderTabs();
    renderDocTabs();
    renderContent();

    window.native.appInfo().then(info => {
      const sv = $('#sb-version');
      if (sv) sv.textContent = 'v' + info.version;
      if (info.platform === 'win32') document.body.classList.add('platform-win32');
    }).catch(() => {});

    const isE2EMode = new URLSearchParams(location.search).has('e2e');
    if (!isE2EMode) {
      const savedPaths = await getSavedOpenPaths();
      if (savedPaths && savedPaths.length) {
        /* 让欢迎页先完成首帧绘制，再在后台恢复上次会话 */
        requestAnimationFrame(() => { openPaths(savedPaths); });
      }
    }
    bindDelegates();
    bindDocTabs();
    bindTreeFilter();
    bindExportMenu();
    bindMenuActions();
    bindFileChange();
    bindSearch();
    bindDrop();
    bindKeys();
    bindToolbar();
    bindAbout();

    window.App = {
      toast: toast,
      __test: {
        openPaths, openObject, openDiagram,
        doSearch,
        applySearchOpts,
        closeDocTab,
        activateDocTab,
        getSearchOptsState: () => ({
          all: document.getElementById('opt-scope-all').checked,
          cols: document.getElementById('opt-include-cols').checked
        }),
        getState: () => state
      }
    };

    const params = new URLSearchParams(location.search);
    if (params.has('e2e')) {
      const s = document.createElement('script');
      s.src = 'js/e2e.js';
      document.body.appendChild(s);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
