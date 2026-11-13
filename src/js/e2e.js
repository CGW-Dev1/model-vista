/* ============================================================
 * E2E 测试脚本 — 仅在 main.js 以 --e2e-test 启动（?e2e=1）时加载
 * 验证完整 UI 链路：打开文件 → 树/页签/元信息 → 表结构 → 搜索 →
 * ER 图 → 导出内容生成 → 视图/存储过程页
 * ============================================================ */
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const file = params.get('file');
  const checks = [];
  const ck = (cond, name, extra) => checks.push({ pass: !!cond, name: name, extra: extra || '' });
  const count = sel => document.querySelectorAll(sel).length;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  (async () => {
    /* 真实文件宽松验证模式（PDM_E2E_FILE 注入 real=1） */
    if (params.has('real')) {
      const t0 = Date.now();
      try {
        const T = window.App.__test;
        await T.openPaths([file]);
        const st = T.getState();
        const m = st.models[0];
        const s = m.model.stats;
        console.log('[REAL] 总耗时(含读取): ' + (Date.now() - t0) + 'ms, 解析器耗时: ' + m.model.parseMs + 'ms');
        console.log('[REAL] 统计: ' + JSON.stringify(s));
        console.log('[REAL] 模型名: ' + m.model.name + ', DBMS: ' + m.model.dbms);
        ck(st.models.length === 1, '真实文件打开');
        ck(s.tables > 0, '解析出数据表', 'tables=' + s.tables);
        if (s.tables > 0) {
          const first = m.model.tables[0];
          T.openObject('table', first.id);
          ck(count('#col-table tbody tr') === first.columns.length && first.columns.length > 0, '表视图字段渲染', 'rows=' + count('#col-table tbody tr'));
          T.doSearch(first.code.slice(0, 4));
          await sleep(400);
          const sb = document.querySelector('#search-results');
          ck(sb._results && sb._results.length > 0, '搜索命中', sb._results ? sb._results.length : 0);
          T.openObject('diagram');
          await sleep(200);
          ck(count('.diagram-svg .er-table') >= 1, 'ER 图渲染', count('.diagram-svg .er-table'));
        }
      } catch (err) {
        ck(false, '真实文件异常', (err && err.message) + ' | ' + (err && err.stack ? String(err.stack).split('\n')[1] : ''));
      }
      const p1 = checks.filter(c => c.pass).length;
      const f1 = checks.length - p1;
      checks.forEach(c => console.log((c.pass ? 'REAL ✓ ' : 'REAL ✗ ') + c.name + (c.pass ? '' : '  —  ' + c.extra)));
      console.log('[E2E-RESULT]' + JSON.stringify({ pass: p1, fail: f1, checks: checks }));
      return;
    }

    try {
      const T = window.App.__test;
      if (!T) throw new Error('测试钩子未注入');

      /* 1. 打开文件 */
      await T.openPaths([file]);
      const st = T.getState();
      ck(st.models.length === 1, '打开文件成功', 'models=' + st.models.length);
      ck(count('#file-tabs .file-tab') === 1, 'PDM 行渲染', count('#file-tabs .file-tab'));
      ck(count('#file-tabs .tree-row') > 10, '侧栏树节点渲染（表已展开）', 'rows=' + count('#file-tabs .tree-row'));
      ck(document.querySelector('#file-tabs').textContent.indexOf('MySQL') >= 0, '侧栏行显示 DBMS');
      ck(!document.querySelector('#model-tree') && !document.querySelector('#model-meta'), '旧模型树/元信息面板已移除');
      /* 侧栏展开 / 折叠 */
      const ftRow = document.querySelector('#file-tabs .file-tab');
      const ftChild = document.querySelector('#file-tabs .file-tab-node .tree-children');
      ftRow.querySelector('.tw').click();
      ck(ftRow.classList.contains('expanded') === false && ftChild.classList.contains('collapsed'), 'PDM 节点可折叠');
      ftRow.querySelector('.tw').click();
      ck(ftRow.classList.contains('expanded') === true && !ftChild.classList.contains('collapsed'), 'PDM 节点可再展开');
      const m = st.models[0];
      ck(m.model.stats.tables === 7, '统计正确（7 表）', JSON.stringify(m.model.stats));

      /* 2. 打开表结构 */
      const user = m.model.tables.find(t => t.code === 'SYS_USER');
      T.openObject('table', user.id);
      ck(count('#col-table tbody tr') === 8, '表视图字段行 = 8', count('#col-table tbody tr'));
      ck(document.querySelector('#col-table').innerHTML.indexOf('PK') >= 0, '主键 PK 标记显示');
      /* DDL 页签 */
      document.querySelector('.tab[data-tab="ddl"]').click();
      ck(document.querySelector('[data-pane="ddl"] pre.sql') && document.querySelector('[data-pane="ddl"] pre.sql').textContent.indexOf('CREATE TABLE') >= 0, 'DDL 页签 SQL');
      document.querySelector('.tab[data-tab="cols"]').click();
      /* 表内字段过滤 */
      const filter = document.querySelector('#col-filter');
      filter.value = 'PHONE';
      filter.dispatchEvent(new Event('input'));
      const visible = Array.from(document.querySelectorAll('#col-table tbody tr')).filter(tr => tr.style.display !== 'none');
      ck(visible.length === 1, '表内字段过滤', 'visible=' + visible.length);
      filter.value = '';
      filter.dispatchEvent(new Event('input'));

      /* 外键标记：ORD_ORDER.USER_ID 是 FK */
      const order0 = m.model.tables.find(t => t.code === 'ORD_ORDER');
      T.openObject('table', order0.id);
      ck(document.querySelector('#col-table').innerHTML.indexOf('FK') >= 0, '外键 FK 标记显示（ORD_ORDER）');

      /* 3. 全局搜索 */
      T.doSearch('USER');
      await sleep(300);
      const sbox = document.querySelector('#search-results');
      ck(!sbox.classList.contains('hidden') && sbox._results && sbox._results.length > 0, '搜索 USER 有结果', sbox._results ? sbox._results.length : 0);
      if (sbox._results && sbox._results.length) {
        T.openObject('table', sbox._results[0].table ? sbox._results[0].table.id : sbox._results[0].id);
        ck(count('#col-table tbody tr') > 0, '搜索结果跳转打开表');
      }

      /* 4. ER 关系图（以 ORD_ORDER 为中心：父表+子表+连线） */
      const order = m.model.tables.find(t => t.code === 'ORD_ORDER');
      T.openDiagram(m, order);
      await sleep(150);
      const nodes = count('.diagram-svg .er-table');
      const edges = count('.diagram-svg .er-edge');
      ck(nodes >= 3, 'ER 图节点（中心+父+子）', 'nodes=' + nodes);
      ck(edges >= 2, 'ER 图连线', 'edges=' + edges);
      ck(document.querySelector('.diagram-svg .er-table.center') !== null, 'ER 图中心表高亮');
      /* 概览图：全部表 */
      T.openObject('diagram');
      await sleep(150);
      ck(count('.diagram-svg .er-table') >= 7, 'ER 概览图包含全部表', count('.diagram-svg .er-table'));

      /* 5. 导出内容生成（字符串层，不弹保存框） */
      const Ex = window.Exporter;
      const md = Ex.tableToMarkdown(m.model, user);
      ck(md.indexOf('USER_ID') >= 0 && md.indexOf('**PK**') >= 0, '单表 Markdown');
      const sql = Ex.genTableSql(m.model, user);
      ck(sql.indexOf('CREATE TABLE "SYS_USER"') >= 0 && sql.indexOf('PRIMARY KEY') >= 0, '单表建表 SQL');
      const allSql = Ex.genModelSql(m.model);
      const createCount = (allSql.match(/CREATE TABLE/g) || []).length;
      ck(createCount === 7, '全库 SQL 含 7 张表', 'CREATE=' + createCount);
      ck(allSql.indexOf('REFERENCES "SYS_USER"') >= 0, '全库 SQL 含外键引用');
      const htmlDoc = Ex.modelToHtml(m.model);
      ck(htmlDoc.indexOf('SYS_USER') >= 0 && htmlDoc.indexOf('<table>') >= 0, '整模型 HTML');
      const mm = Ex.modelToMarkdown(m.model);
      ck(mm.indexOf('数据字典') >= 0 && mm.indexOf('SYS_ROLE') >= 0, '整模型 Markdown');
      const csv = Ex.tableToCsv(m.model, user);
      ck(csv.indexOf('USERNAME') >= 0 && csv.charCodeAt(0) === 0xFEFF, '单表 CSV（BOM）');

      /* 6. 视图 / 存储过程 / 外键关系页 */
      const view = m.model.views[0];
      T.openObject('views', view.id);
      ck(document.body.innerHTML.indexOf('V_ORDER_DETAIL') >= 0, '视图页渲染');
      T.openObject('procedures', m.model.procedures[0].id);
      ck(document.querySelector('pre.sql') !== null, '存储过程 SQL 展示');
      const fk = m.model.references.find(r => r.code === 'FK_ORDER_ITEM_PRODUCT');
      T.openObject('references', fk.id);
      ck(document.body.innerHTML.indexOf('PRD_PRODUCT') >= 0, '外键关系页渲染');
      /* 概览页 */
      T.openObject('overview');
      ck(count('.stat-card') === 6, '概览统计卡片', count('.stat-card'));
      ck(count('[data-open^="tables:"]') >= 7, '概览表清单行', count('[data-open^="tables:"]'));
      /* 概览表清单过滤（ORD_ORDER_ITEM 是唯一包含该关键字的表） */
      const ovf = document.querySelector('#ov-filter');
      ovf.value = 'ORD_ORDER_ITEM';
      ovf.dispatchEvent(new Event('input'));
      const ovVis = Array.from(document.querySelectorAll('#ov-tbody tr')).filter(tr => tr.style.display !== 'none');
      ck(ovVis.length === 1, '概览表清单过滤', 'visible=' + ovVis.length);
      ovf.value = '';
      ovf.dispatchEvent(new Event('input'));

      /* 7. 模型对比（纯逻辑） */
      const clone = JSON.parse(JSON.stringify(m.model));
      clone.tables[0].columns[0].dataType = 'NVARCHAR(999)';
      clone.tables.push({ id: 'fake_new', code: 'NEW_TABLE', name: '新表', comment: '', columns: [], keys: [], indexes: [], triggers: [] });
      const dr = window.Diff.compare(m.model, clone);
      ck(dr.summary.changed === 1 && dr.summary.added === 1 && dr.summary.removed === 0, '模型对比差异统计', JSON.stringify(dr.summary));
      const dmd = window.Diff.toMarkdown(dr, '模型A', '模型B');
      ck(dmd.indexOf('NEW_TABLE') >= 0 && dmd.indexOf('字段类型变更') >= 0, '对比报告 Markdown');

      /* 8. 对比页面 UI */
      T.openObject('diff');
      ck(count('#diff-a') === 1 && count('#diff-run') === 1, '对比页面渲染');
      document.querySelector('#diff-run').click();
      await sleep(100);
      ck(document.querySelector('#diff-result').textContent.length > 0, '对比执行出结果');

      /* 11. 主题切换 */
      if (document.body.classList.contains('dark')) document.querySelector('#btn-theme').click();
      document.querySelector('#btn-theme').click();
      ck(document.body.classList.contains('dark'), '切换深色主题');
      document.querySelector('#btn-theme').click();
      ck(!document.body.classList.contains('dark'), '切回浅色主题');

      /* 12. 打开文件持久化 + 解析缓存（字符串体格式） */
      ck(localStorage.getItem('mv_open_files') !== null, '打开列表已持久化', localStorage.getItem('mv_open_files'));
      await sleep(800); /* 等待防抖缓存写入完成 */
      const cc = await window.native.loadCache(file);
      const ccOk = cc && cc.body && JSON.parse(cc.body).stats.tables === 7;
      ck(!!ccOk, '解析缓存已写入并可读取', cc && cc.body ? 'tables=' + JSON.parse(cc.body).stats.tables : 'null');

      /* 13. 搜索选项：位置（搜索框后方）与默认值（搜索全部=开，包含字段=关） */
      const optAll = document.getElementById('opt-scope-all');
      const optCols = document.getElementById('opt-include-cols');
      ck(!!optAll && !!optCols && !!document.querySelector('#search-opts #opt-scope-all'), '勾选框位于搜索框后方');
      ck(!document.querySelector('#search-results .sr-options'), '下拉面板内已无勾选框');
      localStorage.removeItem('mv_search_opts');
      T.applySearchOpts();
      const defs = T.getSearchOptsState();
      ck(defs.all === true && defs.cols === false, '默认搜索全部=开、包含字段=关', JSON.stringify(defs));
      optCols.checked = false;
      T.doSearch('PHONE');
      await sleep(250);
      let rr = document.querySelector('#search-results')._results || [];
      ck(rr.every(r => r.type !== 'column'), '关闭字段搜索后无字段结果', 'n=' + rr.length);
      optCols.checked = true;
      T.doSearch('PHONE');
      await sleep(250);
      rr = document.querySelector('#search-results')._results || [];
      ck(rr.some(r => r.type === 'column'), '开启字段搜索后命中字段');
      optAll.checked = true;
      T.doSearch('USER');
      await sleep(250);
      rr = document.querySelector('#search-results')._results || [];
      ck(rr.length > 0 && rr.every(r => r.file), '结果含所属 PDM 文件');
      ck(document.querySelector('#sr-list .search-result-item .sr-code') !== null &&
         document.querySelector('#sr-list .search-result-item .sr-file') !== null, '结果行整齐显示代码与文件');
      optAll.checked = false;

      /* 14. 表结构视图 Ctrl+F 聚焦表内过滤框 */
      T.openObject('table', user.id);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
      ck(document.activeElement === document.getElementById('col-filter'), 'Ctrl+F 聚焦表内字段过滤');
      document.getElementById('col-filter').blur();

      /* 15. 表格内容选中与双击复制 */
      const tdEl = document.querySelector('#col-table tbody tr td');
      ck(tdEl && getComputedStyle(tdEl).userSelect === 'text', '表格内容可选中');
      tdEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await sleep(150);
      ck(document.getElementById('toast').textContent.indexOf('已复制') >= 0, '双击单元格复制');
    } catch (err) {
      ck(false, '测试执行异常', (err && err.message) + ' | ' + (err && err.stack ? String(err.stack).split('\n')[1] : ''));
    }

    const pass = checks.filter(c => c.pass).length;
    const fail = checks.length - pass;
    checks.forEach(c => console.log((c.pass ? 'E2E  ✓ ' : 'E2E  ✗ ') + c.name + (c.pass ? '' : '  —  ' + c.extra)));
    console.log('[E2E-RESULT]' + JSON.stringify({ pass: pass, fail: fail, checks: checks }));
  })();
})();
