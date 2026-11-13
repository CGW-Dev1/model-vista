/* ============================================================
 * Exporter - 数据字典导出（Word / Excel / 交互式HTML / Markdown / CSV / 多方言SQL）
 * ============================================================ */
(function () {
  'use strict';

  const Exporter = {};

  const nowStr = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const escMd = s => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const safeName = s => String(s || 'export').replace(/[\\/:*?"<>|]/g, '_');

  /* ---------- 表结构 -> 列定义行 ---------- */
  function colType(c) {
    if (c.dataType) return c.dataType;
    let t = '';
    if (c.length) t = c.precision ? `(${c.length},${c.precision})` : `(${c.length})`;
    return t;
  }

  function tableRowsHtml(model, table) {
    return table.columns.map((c, i) => {
      const pk = c.isPK ? '<span class="pk-mark">PK</span>' : '';
      return `<tr>
        <td class="tc">${i + 1}</td>
        <td>${esc(c.code)} ${pk}</td>
        <td>${esc(c.name)}</td>
        <td class="tc">${esc(colType(c))}</td>
        <td class="tc">${esc(c.length || '')}</td>
        <td class="tc">${c.mandatory ? 'Y' : ''}</td>
        <td class="tc">${c.identity ? '是' : ''}</td>
        <td>${esc(c.defaultValue || '')}</td>
        <td>${esc(c.comment || '')}</td>
      </tr>`;
    }).join('');
  }

  function tableHtml(model, table) {
    let html = `<h2 class="tbl-title" id="t-${esc(table.code)}">${esc(table.code)}（${esc(table.name)}）</h2>`;
    if (table.comment) html += `<p class="tbl-comment">${esc(table.comment)}</p>`;
    html += `<table>
      <thead><tr>
        <th style="width:36px">序号</th><th style="width:150px">字段代码</th><th>字段名称</th>
        <th style="width:120px">数据类型</th><th style="width:50px">长度</th>
        <th style="width:36px">非空</th><th style="width:40px">自增</th>
        <th style="width:90px">默认值</th><th>备注</th>
      </tr></thead>
      <tbody>${tableRowsHtml(model, table)}</tbody></table>`;

    /* 主键 */
    const pk = table.keys.find(k => k.id === table.primaryKeyId);
    if (pk && pk.columns.length) {
      const names = pk.columns.map(id => {
        const col = table.columns.find(c => c.id === id);
        return col ? col.code : id;
      }).join(', ');
      html += `<p class="obj-line"><b>主键：</b>${esc(names)}</p>`;
    }
    /* 外键 */
    const fks = model.references.filter(r => r.childTableId === table.id);
    if (fks.length) {
      html += `<p class="obj-line"><b>外键：</b></p><ul class="obj-list">`;
      for (const r of fks) {
        const pt = model.tables.find(t => t.id === r.parentTableId);
        const joins = r.joins.map(j => {
          const cc = table.columns.find(c => c.id === j.childColId);
          const pc = pt ? pt.columns.find(c => c.id === j.parentColId) : null;
          return `${esc(cc ? cc.code : '?')} → ${esc(pt ? pt.code : '?')}.${esc(pc ? pc.code : '?')}`;
        }).join('；');
        html += `<li>${esc(r.code)}（${esc(r.name)}）：${joins}</li>`;
      }
      html += `</ul>`;
    }
    /* 索引 */
    if (table.indexes.length) {
      html += `<p class="obj-line"><b>索引：</b></p><ul class="obj-list">`;
      for (const ix of table.indexes) {
        const cols = ix.columns.map(x => {
          const c = table.columns.find(cc => cc.id === x.colId);
          return (c ? c.code : '?') + (x.sortOrder === 'DESC' ? ' DESC' : '');
        }).join(', ');
        html += `<li>${esc(ix.code || ix.name)}${ix.unique ? ' [UNIQUE]' : ''}：${esc(cols)}</li>`;
      }
      html += `</ul>`;
    }
    return html;
  }

  /* ---------- Word（.doc，HTML 内容） ---------- */
  const wordStyle = `
    <style>
      body { font-family: "Microsoft YaHei", "Segoe UI", SimSun, sans-serif; font-size: 12px; color:#222; margin: 24px; line-height: 1.5; }
      h1 { font-size: 22px; text-align:center; color:#1a3c76; margin-bottom: 6px; }
      h2 { font-size: 15px; margin: 20px 0 6px; border-bottom: 2px solid #3563a7; color:#1a3c76; padding-bottom:4px;}
      h3 { font-size: 13px; margin: 14px 0 4px; color:#333; }
      table { border-collapse: collapse; width: 100%; margin: 6px 0 14px; table-layout: fixed; }
      th, td { border: 1px solid #7f9db9; padding: 5px 7px; font-size: 11px; word-break: break-word; }
      th { background: #dce6f1; font-weight: bold; text-align: center; color: #1a3c76; }
      .tc { text-align: center; }
      .pk-mark { color:#c00; font-weight:bold; font-size:10px; margin-left:2px; }
      .tbl-comment { color:#555; margin:0 0 6px; font-size:11.5px; }
      .obj-line { margin:5px 0 3px; font-size:12px; }
      .obj-list { margin:2px 0 10px 24px; padding:0; font-size:11px; }
      .meta { text-align:center; color:#666; font-size:11px; margin-bottom:20px; }
      .toc-table th { background: #e9eef5; }
    </style>`;

  function wordDoc(title, bodyHtml) {
    return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>${esc(title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
${wordStyle}</head><body>
<h1>${esc(title)}</h1>
<p class="meta">导出时间：${nowStr()}　|　ModelVista 模型视界</p>
${bodyHtml}
</body></html>`;
  }

  /* ---------- Excel（.xls，HTML 表格） ---------- */
  function excelDoc(title, bodyHtml) {
    return `<html xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  table { border-collapse: collapse; margin-bottom: 20px; }
  th, td { border: 1px solid #999; padding: 4px 7px; font-size: 11px; mso-number-format:"\\@"; }
  th { background: #dce6f1; font-weight:bold; color: #1a3c76; }
  .tc { text-align: center; }
  h2 { font-size: 14px; margin: 16px 0 6px; color: #1a3c76; }
  .pk-mark { color:#c00; font-weight:bold; }
</style></head><body>
<h2>${esc(title)}（导出时间：${nowStr()}）</h2>
${bodyHtml}
</body></html>`;
  }

  /* ---------- 单个表 -> 各种格式 ---------- */
  function tableToHtml(model, table) {
    return `<h1>${esc(table.code)}（${esc(table.name)}）</h1>${wordStyle}${tableHtml(model, table)}`;
  }

  function tableToMarkdown(model, table) {
    let md = `# ${table.code}（${table.name}）\n\n`;
    if (table.comment) md += `> ${table.comment}\n\n`;
    md += `| 序号 | 字段代码 | 字段名称 | 数据类型 | 长度 | 精度 | 非空 | 自增 | 默认值 | 备注 |\n`;
    md += `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`;
    table.columns.forEach((c, i) => {
      md += `| ${i + 1} | ${escMd(c.code)}${c.isPK ? ' **PK**' : ''} | ${escMd(c.name)} | ${escMd(colType(c))} | ${escMd(c.length || '')} | ${escMd(c.precision || '')} | ${c.mandatory ? 'Y' : ''} | ${c.identity ? '是' : ''} | ${escMd(c.defaultValue || '')} | ${escMd(c.comment || '')} |\n`;
    });
    const pk = table.keys.find(k => k.id === table.primaryKeyId);
    if (pk && pk.columns.length) {
      const names = pk.columns.map(id => { const col = table.columns.find(c => c.id === id); return col ? col.code : ''; }).join(', ');
      md += `\n**主键：** ${names}\n`;
    }
    const fks = model.references.filter(r => r.childTableId === table.id);
    if (fks.length) {
      md += `\n**外键：**\n`;
      for (const r of fks) {
        const pt = model.tables.find(t => t.id === r.parentTableId);
        const joins = r.joins.map(j => {
          const cc = table.columns.find(c => c.id === j.childColId);
          const pc = pt ? pt.columns.find(c => c.id === j.parentColId) : null;
          return `${cc ? cc.code : '?'} → ${pt ? pt.code : '?'}.${pc ? pc.code : '?'}`;
        }).join('；');
        md += `- ${r.code}（${r.name}）：${joins}\n`;
      }
    }
    if (table.indexes.length) {
      md += `\n**索引：**\n`;
      for (const ix of table.indexes) {
        const cols = ix.columns.map(x => { const c = table.columns.find(cc => cc.id === x.colId); return (c ? c.code : '?') + (x.sortOrder === 'DESC' ? ' DESC' : ''); }).join(', ');
        md += `- ${ix.code || ix.name}${ix.unique ? ' [UNIQUE]' : ''}：${cols}\n`;
      }
    }
    return md;
  }

  function tableToCsv(model, table) {
    const rows = [['序号', '字段代码', '字段名称', '数据类型', '长度', '精度', '非空', '自增', '默认值', '备注']];
    table.columns.forEach((c, i) => {
      rows.push([i + 1, c.code, c.name, colType(c), c.length || '', c.precision || '', c.mandatory ? 'Y' : '', c.identity ? '是' : '', c.defaultValue || '', c.comment || '']);
    });
    return '\uFEFF' + rows.map(r => r.map(v => {
      v = String(v == null ? '' : v);
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(',')).join('\n');
  }

  /* ---------- 整模型 / 选中表导出 ---------- */
  function filterTables(model, tableIds) {
    if (!tableIds || !tableIds.length) return model.tables;
    const idSet = new Set(tableIds);
    return model.tables.filter(t => idSet.has(t.id));
  }

  function modelBodyHtml(model, tableIds) {
    const tables = filterTables(model, tableIds);
    let html = '';
    /* 表清单（目录） */
    html += '<h2 style="margin-top:10px">一、数据表目录</h2>';
    html += '<table class="toc-table"><thead><tr><th style="width:40px">序号</th><th style="width:200px">表代码</th><th>表名称</th><th style="width:60px">字段数</th><th>说明</th></tr></thead><tbody>';
    tables.forEach((t, i) => {
      html += `<tr><td class="tc">${i + 1}</td><td><b><a href="#t-${esc(t.code)}">${esc(t.code)}</a></b></td><td>${esc(t.name)}</td><td class="tc">${t.columns.length}</td><td>${esc(t.comment || '')}</td></tr>`;
    });
    html += '</tbody></table>';

    /* 表明细 */
    html += '<h2 style="margin-top:24px">二、表结构明细</h2>';
    for (const t of tables) {
      html += tableHtml(model, t) + '<div style="page-break-after:always; margin-bottom: 24px;"></div>';
    }

    if (!tableIds && model.views && model.views.length) {
      html += '<h2 style="margin-top:30px">三、视图</h2>';
      for (const v of model.views) {
        html += `<h3>${esc(v.code)}（${esc(v.name)}）</h3>`;
        if (v.comment) html += `<p class="tbl-comment">${esc(v.comment)}</p>`;
        if (v.sql) html += `<pre class="sql">${esc(v.sql)}</pre>`;
      }
    }
    return html;
  }

  function modelToHtml(model, tableIds) {
    return wordDoc(model.name, modelBodyHtml(model, tableIds));
  }

  /* 单文件独立交互式离线 HTML 数据字典 (比码猴更现代强大的交付件) */
  function modelToInteractiveHtml(model, tableIds) {
    const tables = filterTables(model, tableIds);
    const title = model.name || model.fileName;
    const tablesJson = JSON.stringify(tables.map(t => ({
      id: t.id,
      code: t.code,
      name: t.name,
      comment: t.comment || '',
      colCount: t.columns.length,
      pkg: t._pkg || ''
    })));

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} - 数据字典</title>
  <style>
    :root {
      --bg: #f8fafc; --panel: #ffffff; --border: #e2e8f0; --text: #1e293b; --text-sub: #64748b;
      --primary: #2563eb; --primary-light: #eff6ff; --radius: 8px;
    }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Microsoft YaHei", sans-serif; background: var(--bg); color: var(--text); font-size: 13px; line-height: 1.5; }
    .layout { display: flex; height: 100vh; overflow: hidden; }
    .sidebar { width: 320px; background: var(--panel); border-right: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; }
    .sb-header { padding: 14px 16px; border-bottom: 1px solid var(--border); }
    .sb-title { font-size: 16px; font-weight: 700; color: #0f172a; margin-bottom: 4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .sb-meta { font-size: 11px; color: var(--text-sub); }
    .sb-search { padding: 10px 14px; border-bottom: 1px solid var(--border); }
    .sb-search input { width: 100%; height: 32px; padding: 0 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 12px; outline: none; }
    .sb-search input:focus { border-color: var(--primary); }
    .sb-list { flex: 1; overflow-y: auto; padding: 6px; }
    .sb-item { display: block; padding: 7px 10px; border-radius: 6px; text-decoration: none; color: inherit; margin-bottom: 2px; transition: background .15s; cursor: pointer; }
    .sb-item:hover, .sb-item.active { background: var(--primary-light); color: var(--primary); }
    .sb-code { font-weight: 600; font-size: 12.5px; font-family: Consolas, monospace; }
    .sb-name { font-size: 11.5px; color: var(--text-sub); margin-top: 1px; }
    .main { flex: 1; overflow-y: auto; padding: 24px 36px 60px; scroll-behavior: smooth; }
    .tbl-card { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .tbl-header { display: flex; align-items: baseline; gap: 10px; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 12px; }
    .tbl-title-code { font-size: 18px; font-weight: 700; font-family: Consolas, monospace; color: #0f172a; }
    .tbl-title-name { font-size: 14px; color: var(--text-sub); }
    .tbl-desc { color: #475569; font-size: 12px; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0 14px; font-size: 12px; }
    th, td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
    th { background: #f1f5f9; font-weight: 600; color: #334155; }
    .tc { text-align: center; }
    .mono { font-family: Consolas, monospace; }
    .pk { display: inline-block; background: #fef3c7; color: #b45309; padding: 0 4px; border-radius: 3px; font-size: 10px; font-weight: 700; }
    .fk { display: inline-block; background: #e0f2fe; color: #0369a1; padding: 0 4px; border-radius: 3px; font-size: 10px; font-weight: 700; }
    .nn { color: #dc2626; font-weight: 700; }
    .extra-info { font-size: 11.5px; color: var(--text-sub); margin-top: 6px; }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="sb-header">
        <div class="sb-title" title="${esc(title)}">🗄 ${esc(title)}</div>
        <div class="sb-meta">共 ${tables.length} 张数据表 · 导出时间 ${nowStr()}</div>
      </div>
      <div class="sb-search">
        <input type="text" id="q" placeholder="过滤表代码 / 名称..." autocomplete="off">
      </div>
      <div class="sb-list" id="list"></div>
    </aside>
    <main class="main" id="main">
      ${tables.map(t => {
        const pk = t.keys.find(k => k.id === t.primaryKeyId);
        const pkNames = pk ? pk.columns.map(id => { const c = t.columns.find(cc => cc.id === id); return c ? c.code : id; }).join(', ') : '';
        return `<section class="tbl-card" id="card-${esc(t.code)}">
          <div class="tbl-header">
            <span class="tbl-title-code">${esc(t.code)}</span>
            <span class="tbl-title-name">${esc(t.name)}</span>
          </div>
          ${t.comment ? `<div class="tbl-desc">${esc(t.comment)}</div>` : ''}
          <table>
            <thead><tr><th style="width:40px" class="tc">#</th><th>字段代码</th><th>字段名称</th><th>类型</th><th style="width:60px" class="tc">长度</th><th style="width:50px" class="tc">精度</th><th style="width:60px" class="tc">非空</th><th style="width:50px" class="tc">自增</th><th>默认值</th><th>备注</th></tr></thead>
            <tbody>
              ${t.columns.map((c, i) => `<tr>
                <td class="tc">${i + 1}</td>
                <td class="mono"><b>${esc(c.code)}</b> ${c.isPK ? '<span class="pk">PK</span>' : ''}</td>
                <td>${esc(c.name)}</td>
                <td class="mono tc">${esc(colType(c))}</td>
                <td class="tc">${esc(c.length || '')}</td>
                <td class="tc">${esc(c.precision || '')}</td>
                <td class="tc">${c.mandatory ? '<span class="nn">Y</span>' : ''}</td>
                <td class="tc">${c.identity ? '是' : ''}</td>
                <td class="mono">${esc(c.defaultValue || '')}</td>
                <td>${esc(c.comment || '')}</td>
              </tr>`).join('')}
            </tbody>
          </table>
          ${pkNames ? `<div class="extra-info"><b>主键约束：</b><span class="mono">${esc(pkNames)}</span></div>` : ''}
        </section>`;
      }).join('')}
    </main>
  </div>
  <script>
    const tables = ${tablesJson};
    const list = document.getElementById('list');
    const q = document.getElementById('q');
    function render(filter) {
      const kw = (filter || '').toLowerCase();
      list.innerHTML = tables.filter(t => !kw || t.code.toLowerCase().includes(kw) || t.name.toLowerCase().includes(kw) || t.comment.toLowerCase().includes(kw))
        .map(t => '<a class="sb-item" href="#card-' + t.code + '"><div class="sb-code">' + t.code + '</div><div class="sb-name">' + t.name + '</div></a>').join('');
    }
    render('');
    q.addEventListener('input', e => render(e.target.value));
  </script>
</body>
</html>`;
  }

  function modelToMarkdown(model, tableIds) {
    const tables = filterTables(model, tableIds);
    let md = `# ${model.name || model.fileName} 数据字典\n\n`;
    if (model.comment) md += `> ${model.comment}\n\n`;
    md += `| 对象 | 数量 |\n| --- | --- |\n| 导出数据表 | ${tables.length} |\n| 视图 | ${model.stats ? model.stats.views : 0} |\n| 外键关系 | ${model.stats ? model.stats.references : 0} |\n\n`;
    md += `## 表清单\n\n| 序号 | 表代码 | 表名称 | 字段数 | 备注 |\n| --- | --- | --- | --- | --- |\n`;
    tables.forEach((t, i) => md += `| ${i + 1} | ${escMd(t.code)} | ${escMd(t.name)} | ${t.columns.length} | ${escMd(t.comment || '')} |\n`);
    md += `\n---\n\n`;
    for (const t of tables) { md += tableToMarkdown(model, t) + `\n---\n\n`; }
    return md;
  }

  /* ---------- 多数据库方言 SQL 生成 ---------- */
  function sqlType(c) {
    return c.dataType || colType(c) || 'VARCHAR(255)';
  }

  function genTableSql(model, table, dialect) {
    /* 未显式指定方言时，遵循标准 SQL / Oracle 双引号格式，兼容既有测试与通用建表；若指定 mysql 则使用反引号 */
    const d = (dialect || 'standard').toLowerCase();
    const isMysql = d === 'mysql';
    const isSqlserver = d === 'sqlserver' || d === 'mssql';
    const isOracle = d === 'oracle' || d === 'dm';
    const isPg = d === 'pg' || d === 'postgresql';

    const q = name => isMysql ? `\`${name}\`` : isSqlserver ? `[${name}]` : `"${name}"`;

    const lines = [];
    const colDefs = [];
    const commentStatements = [];

    for (const c of table.columns) {
      let tname = sqlType(c);
      if (isOracle) {
        if (/VARCHAR\b/i.test(tname) && !/VARCHAR2/i.test(tname)) tname = tname.replace(/VARCHAR/i, 'VARCHAR2');
        if (/DATETIME/i.test(tname)) tname = 'TIMESTAMP';
      }
      let def = `    ${q(c.code)} ${tname}`;

      if (isMysql) {
        if (c.identity) def += ' AUTO_INCREMENT';
        if (c.mandatory || c.isPK) def += ' NOT NULL';
        if (c.defaultValue && !c.identity) def += ` DEFAULT ${c.defaultValue}`;
        if (c.comment || c.name) def += ` COMMENT '${(c.comment || c.name).replace(/'/g, "''")}'`;
      } else if (isSqlserver) {
        if (c.identity) def += ' IDENTITY(1,1)';
        if (c.mandatory || c.isPK) def += ' NOT NULL';
        if (c.defaultValue && !c.identity) def += ` DEFAULT ${c.defaultValue}`;
      } else {
        /* Oracle / PG */
        if (c.mandatory || c.isPK) def += ' NOT NULL';
        if (c.defaultValue) def += ` DEFAULT ${c.defaultValue}`;
        if (c.comment || c.name) {
          commentStatements.push(`COMMENT ON COLUMN ${q(table.code)}.${q(c.code)} IS '${(c.comment || c.name).replace(/'/g, "''")}';`);
        }
      }
      colDefs.push(def);
    }

    const pk = table.keys.find(k => k.id === table.primaryKeyId);
    if (pk && pk.columns.length) {
      const names = pk.columns.map(id => { const col = table.columns.find(c => c.id === id); return q(col ? col.code : id); }).join(', ');
      colDefs.push(`    PRIMARY KEY (${names})`);
    }

    /* 外键 */
    const fks = model.references ? model.references.filter(r => r.childTableId === table.id) : [];
    fks.forEach((r, i) => {
      const pt = model.tables.find(t => t.id === r.parentTableId);
      if (!pt || !r.joins.length) return;
      const childCols = r.joins.map(j => { const c = table.columns.find(c => c.id === j.childColId); return c ? q(c.code) : null; }).filter(Boolean);
      const parentCols = r.joins.map(j => { const c = pt.columns.find(c => c.id === j.parentColId); return c ? q(c.code) : null; }).filter(Boolean);
      colDefs.push(`    CONSTRAINT ${q(r.code || 'FK_' + table.code + '_' + (i + 1))} FOREIGN KEY (${childCols.join(', ')}) REFERENCES ${q(pt.code)} (${parentCols.join(', ')})`);
    });

    lines.push(`-- ----------------------------`);
    lines.push(`-- Table: ${table.code}  ${table.comment ? '- ' + table.comment : ''}`);
    lines.push(`-- ----------------------------`);
    lines.push(`CREATE TABLE ${q(table.code)} (`);
    lines.push(colDefs.join(',\n'));
    if (isMysql) {
      lines.push(`) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='${(table.comment || table.name || '').replace(/'/g, "''")}';`);
    } else {
      lines.push(`);`);
    }

    if (isOracle || isPg) {
      if (table.comment || table.name) {
        lines.push(`COMMENT ON TABLE ${q(table.code)} IS '${(table.comment || table.name).replace(/'/g, "''")}';`);
      }
      commentStatements.forEach(s => lines.push(s));
    }

    /* 索引 */
    for (const ix of (table.indexes || [])) {
      if (pk && ix.id === pk.id) continue;
      const cols = ix.columns.map(x => { const c = table.columns.find(cc => cc.id === x.colId); return `${q(c ? c.code : x.colId)}${x.sortOrder === 'DESC' ? ' DESC' : ''}`; }).join(', ');
      if (!cols) continue;
      lines.push(`CREATE ${ix.unique ? 'UNIQUE ' : ''}INDEX ${q(ix.code || ix.name)} ON ${q(table.code)} (${cols});`);
    }
    return lines.join('\n');
  }

  function genModelSql(model, dialect, tableIds) {
    const tables = filterTables(model, tableIds);
    return tables.map(t => genTableSql(model, t, dialect)).join('\n\n') + '\n';
  }

  /* ---------- 触发保存流程 ---------- */
  async function saveText(defaultName, content, filters) {
    const path = await window.native.saveFileDialog({ defaultName, filters });
    if (!path) return { ok: false };
    await window.native.writeTextFile({ filePath: path, content });
    return { ok: true, path };
  }

  async function saveBinary(defaultName, base64, filters) {
    const path = await window.native.saveFileDialog({ defaultName, filters });
    if (!path) return { ok: false };
    await window.native.writeBinaryFile({ filePath: path, base64 });
    return { ok: true, path };
  }

  /* 对外 API */
  Exporter.tableToHtml = tableToHtml;
  Exporter.tableToMarkdown = tableToMarkdown;
  Exporter.tableToCsv = tableToCsv;
  Exporter.modelToHtml = modelToHtml;
  Exporter.modelToInteractiveHtml = modelToInteractiveHtml;
  Exporter.modelToMarkdown = modelToMarkdown;
  Exporter.genTableSql = genTableSql;
  Exporter.genModelSql = genModelSql;
  Exporter.saveText = saveText;
  Exporter.saveBinary = saveBinary;
  Exporter.safeName = safeName;

  Exporter.exportTable = async function (model, table, fmt, dialect) {
    const base = safeName(table.code || table.name);
    switch (fmt) {
      case 'word': return await saveText(base + '.doc', wordDoc(base + ' 数据字典', tableHtml(model, table)), [{ name: 'Word 文档', extensions: ['doc'] }]);
      case 'excel': {
        let rows = `<table><tr><th>序号</th><th>字段代码</th><th>字段名称</th><th>数据类型</th><th>长度</th><th>精度</th><th>非空</th><th>自增</th><th>默认值</th><th>备注</th></tr>`;
        table.columns.forEach((c, i) => {
          rows += `<tr><td>${i + 1}</td><td>${esc(c.code)}</td><td>${esc(c.name)}</td><td>${esc(colType(c))}</td><td>${esc(c.length || '')}</td><td>${esc(c.precision || '')}</td><td>${c.mandatory ? 'Y' : ''}</td><td>${c.identity ? '是' : ''}</td><td>${esc(c.defaultValue || '')}</td><td>${esc(c.comment || '')}</td></tr>`;
        });
        rows += `</table>`;
        return await saveText(base + '.xls', excelDoc(base + ' 数据字典', rows), [{ name: 'Excel 工作簿', extensions: ['xls'] }]);
      }
      case 'html': return await saveText(base + '.html', tableToHtml(model, table), [{ name: 'HTML 文件', extensions: ['html'] }]);
      case 'markdown': return await saveText(base + '.md', tableToMarkdown(model, table), [{ name: 'Markdown 文件', extensions: ['md'] }]);
      case 'csv': return await saveText(base + '.csv', tableToCsv(model, table), [{ name: 'CSV 文件', extensions: ['csv'] }]);
      case 'sql': return await saveText(base + '.sql', genTableSql(model, table, dialect), [{ name: 'SQL 脚本', extensions: ['sql'] }]);
    }
    return { ok: false };
  };

  Exporter.exportModel = async function (model, fmt, dialect, tableIds) {
    const base = safeName(model.name || model.fileName.replace(/\.pdm$/i, ''));
    const tables = filterTables(model, tableIds);
    switch (fmt) {
      case 'word':
        return await saveText(base + '_数据字典.doc', modelToHtml(model, tableIds), [{ name: 'Word 文档', extensions: ['doc'] }]);
      case 'excel': {
        let html = '<h2>一、数据表目录</h2><table><tr><th>序号</th><th>表代码</th><th>表名称</th><th>字段数</th><th>说明</th></tr>';
        tables.forEach((t, i) => {
          html += `<tr><td class="tc">${i + 1}</td><td>${esc(t.code)}</td><td>${esc(t.name)}</td><td class="tc">${t.columns.length}</td><td>${esc(t.comment || '')}</td></tr>`;
        });
        html += '</table><h2>二、字段结构明细</h2>';
        for (const t of tables) {
          html += `<h3>${esc(t.code)}（${esc(t.name)}）</h3><table><tr><th>序号</th><th>字段代码</th><th>字段名称</th><th>数据类型</th><th>长度</th><th>精度</th><th>非空</th><th>默认值</th><th>备注</th></tr>`;
          t.columns.forEach((c, i) => {
            html += `<tr><td class="tc">${i + 1}</td><td>${esc(c.code)}${c.isPK ? ' <span class="pk-mark">PK</span>' : ''}</td><td>${esc(c.name)}</td><td>${esc(colType(c))}</td><td class="tc">${esc(c.length || '')}</td><td class="tc">${esc(c.precision || '')}</td><td class="tc">${c.mandatory ? 'Y' : ''}</td><td>${esc(c.defaultValue || '')}</td><td>${esc(c.comment || '')}</td></tr>`;
          });
          html += `</table>`;
        }
        return await saveText(base + '_数据字典.xls', excelDoc(base + ' 数据字典', html), [{ name: 'Excel 工作簿', extensions: ['xls'] }]);
      }
      case 'html':
        return await saveText(base + '_数据字典.html', modelToInteractiveHtml(model, tableIds), [{ name: '交互式 HTML 数据字典', extensions: ['html'] }]);
      case 'markdown':
        return await saveText(base + '_数据字典.md', modelToMarkdown(model, tableIds), [{ name: 'Markdown 文件', extensions: ['md'] }]);
      case 'sql':
        return await saveText(base + '_建表脚本.sql', genModelSql(model, dialect, tableIds), [{ name: 'SQL 脚本', extensions: ['sql'] }]);
    }
    return { ok: false };
  };

  window.Exporter = Exporter;
})();
