/* ============================================================
 * Diagram - ER 关系图（SVG）
 * 以选中表为中心，左侧父表、右侧子表，支持平移缩放
 * ============================================================ */
(function () {
  'use strict';

  const Diagram = {};
  const NS = 'http://www.w3.org/2000/svg';

  const BOX_W = 250, HEAD_H = 26, ROW_H = 19, MAX_ROWS = 8, PAD = 6;
  const GAP = 36;

  function el(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function txt(parent, x, y, content, cls, anchor) {
    const t = el('text', { x, y, 'class': cls || '', 'text-anchor': anchor || 'start' }, parent);
    t.textContent = content;
    return t;
  }

  /* 计算某表显示的行 */
  function visibleCols(model, table) {
    const colIds = new Set();
    /* FK 列 */
    for (const r of model.references) {
      if (r.childTableId === table.id || r.parentTableId === table.id) {
        for (const j of r.joins) { if (j.childColId && r.childTableId === table.id) colIds.add(j.childColId); }
      }
    }
    const rows = [];
    const pk = table.keys.find(k => k.id === table.primaryKeyId);
    for (const c of table.columns.slice(0, MAX_ROWS)) {
      rows.push({ code: c.code, pk: c.isPK, fk: colIds.has(c.id) });
    }
    if (!rows.length && table.columns.length) rows.push({ code: table.columns[0].code, pk: !!table.columns[0].isPK, fk: colIds.has(table.columns[0].id) });
    return { rows, total: table.columns.length, pkCols: pk ? pk.columns.length : 0 };
  }

  function boxHeight(info) {
    return HEAD_H + PAD + Math.min(info.rows.length, MAX_ROWS) * ROW_H + PAD;
  }

  /**
   * 渲染 ER 图
   * @param container  容器元素
   * @param model      模型对象
   * @param centerTable 中心表（可空：整体概览）
   * @param onOpenTable 点击表回调 (table)=>{}
   */
  Diagram.render = function (container, model, centerTable, onOpenTable) {
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'diagram-wrap';
    const svg = el('svg', { 'class': 'diagram-svg' });
    wrap.appendChild(svg);
    container.appendChild(wrap);

    const gRoot = el('g', {}, svg);
    const gEdges = el('g', {}, gRoot);
    const gNodes = el('g', {}, gRoot);

    /* 收集节点：中心 + 父 + 子 */
    const center = centerTable;
    const parents = [], children = [];
    if (center) {
      for (const r of model.references) {
        if (r.childTableId === center.id) {
          const pt = model.tables.find(t => t.id === r.parentTableId);
          if (pt && !parents.includes(pt)) parents.push(pt);
        }
        if (r.parentTableId === center.id) {
          const ct = model.tables.find(t => t.id === r.childTableId);
          if (ct && !children.includes(ct)) children.push(ct);
        }
      }
    } else {
      /* 概览：取字段数最多的前 10 张表 */
      const tops = [...model.tables].sort((a, b) => b.columns.length - a.columns.length).slice(0, 10);
      tops.forEach(t => children.push(t));
    }

    /* 布局 */
    const allTables = [];
    if (center) allTables.push({ t: center, col: 'c' });
    parents.forEach(t => allTables.push({ t, col: 'l' }));
    children.forEach(t => allTables.push({ t, col: 'r' }));

    const layout = new Map();
    const colX = { l: 30, c: 30 + BOX_W + GAP * 2.2, r: 30 + (BOX_W + GAP * 2.2) * 2 };
    for (const col of ['l', 'c', 'r']) {
      const items = allTables.filter(x => x.col === col);
      let y = 30;
      for (const it of items) {
        const info = visibleCols(model, it.t);
        const h = boxHeight(info);
        layout.set(it.t.id, { x: colX[col], y, w: BOX_W, h, info, table: it.t });
        y += h + 26;
      }
    }
    const bounds = { w: 0, h: 0 };
    layout.forEach(v => { bounds.w = Math.max(bounds.w, v.x + v.w); bounds.h = Math.max(bounds.h, v.y + v.h); });

    /* 画边（引用） */
    function edgeBetween(parentId, childId, ref) {
      const p = layout.get(parentId), c = layout.get(childId);
      if (!p || !c) return;
      const x1 = p.x + p.w, y1 = p.y + p.h / 2;
      const x2 = c.x, y2 = c.y + c.h / 2;
      const mx = (x1 + x2) / 2;
      const isHl = center && (parentId === center.id || childId === center.id);
      const path = el('path', {
        d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`,
        'class': 'er-edge' + (isHl ? ' hl' : '')
      }, gEdges);
      if (ref && ref.name) {
        const lb = txt(gEdges, mx, (y1 + y2) / 2 - 6, ref.name.replace(/^(FK_|fk_)/, ''), 'er-label', 'middle');
      }
      /* 端点标注 1 / N */
      txt(gEdges, x1 + 5, y1 - 5, '1', 'er-label');
      txt(gEdges, x2 - 12, y2 - 5, 'N', 'er-label');
    }
    if (center) {
      for (const r of model.references) {
        if (r.childTableId === center.id) edgeBetween(r.parentTableId, r.childTableId, r);
        else if (r.parentTableId === center.id) edgeBetween(r.parentTableId, r.childTableId, r);
      }
    }

    /* 画表框 */
    layout.forEach(v => {
      const t = v.table;
      const grp = el('g', { 'class': 'er-table' + (center && center.id === t.id ? ' center' : ''), 'data-id': t.id }, gNodes);
      grp.style.transformOrigin = `${v.x}px ${v.y}px`;
      el('rect', { x: v.x, y: v.y, width: v.w, height: v.h, rx: 8, 'class': 'box' }, grp);
      el('rect', { x: v.x, y: v.y, width: v.w, height: HEAD_H, rx: 8, 'class': 'header' }, grp);
      el('rect', { x: v.x, y: v.y + HEAD_H - 8, width: v.w, height: 8, 'class': 'header' }, grp);
      txt(grp, v.x + 10, v.y + HEAD_H - 8, t.code || t.name, 'tbl-name');
      const cnt = txt(grp, v.x + v.w - 8, v.y + HEAD_H - 8, v.total + ' 列', 'er-label', 'end');
      cnt.setAttribute('fill', 'rgba(255,255,255,.85)');

      let yy = v.y + HEAD_H + PAD + 12;
      for (const row of v.info.rows) {
        let cls = 'col' + (row.pk ? ' pk' : '') + (row.fk ? ' fk' : '');
        txt(grp, v.x + 10, yy, (row.pk ? '⚿ ' : row.fk ? '⇢ ' : '') + row.code, cls);
        yy += ROW_H;
      }
      if (v.total > MAX_ROWS) {
        txt(grp, v.x + 10, yy, `… 还有 ${v.total - MAX_ROWS} 个字段`, 'colMore');
      }
      grp.addEventListener('click', () => onOpenTable && onOpenTable(t));
    });

    /* 平移缩放 */
    let tx = 20, ty = 20, scale = 1;
    function apply() {
      gRoot.setAttribute('transform', `translate(${tx},${ty}) scale(${scale})`);
    }
    apply();

    let dragging = false, sx = 0, sy = 0, stx = 0, sty = 0;
    svg.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      dragging = true; sx = e.clientX; sy = e.clientY; stx = tx; sty = ty;
      svg.classList.add('dragging');
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      tx = stx + (e.clientX - sx); ty = sty + (e.clientY - sy);
      apply();
    });
    window.addEventListener('mouseup', () => { dragging = false; svg.classList.remove('dragging'); });
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 0.9;
      const ns = Math.min(3, Math.max(0.2, scale * factor));
      tx = mx - (mx - tx) * (ns / scale);
      ty = my - (my - ty) * (ns / scale);
      scale = ns;
      apply();
    }, { passive: false });

    /* 工具按钮 */
    const bar = document.createElement('div');
    bar.className = 'diagram-toolbar';
    bar.innerHTML = `
      <button class="btn btn-mini" data-z="in">放大 +</button>
      <button class="btn btn-mini" data-z="out">缩小 −</button>
      <button class="btn btn-mini" data-z="fit">适应画布</button>
      <button class="btn btn-mini" data-z="png">导出 PNG</button>`;
    wrap.appendChild(bar);
    bar.addEventListener('click', async e => {
      const z = e.target.getAttribute && e.target.getAttribute('data-z');
      if (!z) return;
      if (z === 'in') { scale = Math.min(3, scale * 1.2); apply(); }
      else if (z === 'out') { scale = Math.max(0.2, scale / 1.2); apply(); }
      else if (z === 'fit') {
        const rect = svg.getBoundingClientRect();
        scale = Math.min(rect.width / (bounds.w + 60), rect.height / (bounds.h + 60), 1.4);
        tx = (rect.width - bounds.w * scale) / 2 - 15;
        ty = (rect.height - bounds.h * scale) / 2 - 15;
        apply();
      } else if (z === 'png') {
        try {
          const clone = svg.cloneNode(true);
          clone.setAttribute('width', bounds.w + 40);
          clone.setAttribute('height', bounds.h + 40);
          const bg = el('rect', { x: 0, y: 0, width: bounds.w + 40, height: bounds.h + 40, fill: '#f5f7fb' });
          clone.insertBefore(bg, clone.firstChild);
          const xml = new XMLSerializer().serializeToString(clone);
          const img = new Image();
          const b64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
          await new Promise(res => { img.onload = res; img.src = b64; });
          const canvas = document.createElement('canvas');
          canvas.width = bounds.w + 40; canvas.height = bounds.h + 40;
          const ctx = canvas.getContext('2d');
          ctx.scale(2, 2);
          ctx.drawImage(img, 0, 0, canvas.width / 2, canvas.height / 2);
          const pngB64 = canvas.toDataURL('image/png').split(',')[1];
          const r = await window.Exporter.saveBinary('关系图.png', pngB64, [{ name: 'PNG 图片', extensions: ['png'] }]);
          if (r.ok) window.App.toast('关系图已导出：' + r.path, 'ok');
        } catch (err) { window.App.toast('导出失败：' + err.message, 'err'); }
      }
    });

    const hint = document.createElement('div');
    hint.className = 'diagram-hint';
    hint.textContent = '拖动平移 · 滚轮缩放 · 点击表框查看表结构';
    wrap.appendChild(hint);

    /* 初始 fit */
    setTimeout(() => {
      const rect = svg.getBoundingClientRect();
      if (rect.width > 0 && bounds.w > 0) {
        scale = Math.min(rect.width / (bounds.w + 60), rect.height / (bounds.h + 60), 1.4);
        tx = (rect.width - bounds.w * scale) / 2 - 15;
        ty = (rect.height - bounds.h * scale) / 2 - 15;
        apply();
      }
    }, 30);
  };

  window.Diagram = Diagram;
})();
