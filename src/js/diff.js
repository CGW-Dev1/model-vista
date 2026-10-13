/* ============================================================
 * Diff - 模型对比（数据字典校对）
 * 对比两个模型的表/字段差异，支持生成 Markdown 报告
 * ============================================================ */
(function () {
  'use strict';

  const Diff = {};
  const norm = s => String(s || '').trim().toLowerCase();

  function colSig(c) {
    return {
      dataType: String(c.dataType || '').toUpperCase(),
      length: String(c.length || ''),
      mandatory: !!c.mandatory,
      comment: String(c.comment || '')
    };
  }

  function diffTable(ta, tb) {
    const changes = [];
    if (norm(ta.name) !== norm(tb.name)) changes.push({ type: '表名变更', detail: (ta.name || '') + ' → ' + (tb.name || '') });
    if (String(ta.comment || '') !== String(tb.comment || '')) changes.push({ type: '表注释变更', detail: (ta.comment || '（空）') + ' → ' + (tb.comment || '（空）') });

    const colsA = new Map((ta.columns || []).map(c => [norm(c.code), c]));
    const colsB = new Map((tb.columns || []).map(c => [norm(c.code), c]));

    colsA.forEach((ca, code) => {
      if (!colsB.has(code)) { changes.push({ type: '删除字段', detail: ca.code }); return; }
      const cb = colsB.get(code);
      const sa = colSig(ca), sb = colSig(cb);
      const ta2 = sa.dataType + (sa.length ? '(' + sa.length + ')' : '');
      const tb2 = sb.dataType + (sb.length ? '(' + sb.length + ')' : '');
      if (sa.dataType !== sb.dataType || sa.length !== sb.length) changes.push({ type: '字段类型变更', detail: ca.code + ': ' + ta2 + ' → ' + tb2 });
      if (sa.mandatory !== sb.mandatory) changes.push({ type: '字段约束变更', detail: ca.code + ': ' + (sa.mandatory ? 'NOT NULL' : '可空') + ' → ' + (sb.mandatory ? 'NOT NULL' : '可空') });
      if (sa.comment !== sb.comment) changes.push({ type: '字段注释变更', detail: ca.code + ': ' + (sa.comment || '（空）') + ' → ' + (sb.comment || '（空）') });
    });
    colsB.forEach((cb, code) => {
      if (!colsA.has(code)) {
        changes.push({ type: '新增字段', detail: cb.code + ' ' + cb.dataType + (cb.length ? '(' + cb.length + ')' : '') + (cb.comment ? ' — ' + cb.comment : '') });
      }
    });
    return changes;
  }

  /* 在 A 中有而 B 中没有的视图 */
  function removedViews(A, B) {
    const setB = new Set((B || []).map(v => norm(v.code)));
    return (A || []).filter(v => !setB.has(norm(v.code)));
  }

  /**
   * 对比两个模型
   * @returns {added:[], removed:[], changed:[{a,b,changes:[]}], same:n, summary:{}}
   */
  Diff.compare = function (modelA, modelB) {
    const res = { added: [], removed: [], changed: [], same: 0, views: { added: [], removed: [] } };
    const mapA = new Map((modelA.tables || []).map(t => [norm(t.code), t]));
    const mapB = new Map((modelB.tables || []).map(t => [norm(t.code), t]));

    mapA.forEach((ta, code) => {
      if (!mapB.has(code)) { res.removed.push(ta); return; }
      const tb = mapB.get(code);
      const changes = diffTable(ta, tb);
      if (changes.length) res.changed.push({ a: ta, b: tb, changes: changes });
      else res.same++;
    });
    mapB.forEach((tb, code) => {
      if (!mapA.has(code)) res.added.push(tb);
    });
    res.views.added = removedViews(modelB.views, modelA.views);
    res.views.removed = removedViews(modelA.views, modelB.views);
    res.summary = { added: res.added.length, removed: res.removed.length, changed: res.changed.length, same: res.same };
    return res;
  };

  Diff.toMarkdown = function (r, nameA, nameB) {
    const p = d => new Date(d).toLocaleString();
    const L = [];
    L.push('# 模型对比报告');
    L.push('');
    L.push('- 模型 A：' + nameA);
    L.push('- 模型 B：' + nameB);
    L.push('- 对比时间：' + p(Date.now()));
    L.push('- 生成工具：PDM模型浏览器');
    L.push('');
    L.push('## 差异统计');
    L.push('');
    L.push('| 差异类型 | 数量 |');
    L.push('| --- | --- |');
    L.push('| 新增表（仅 B 有） | ' + r.summary.added + ' |');
    L.push('| 删除表（仅 A 有） | ' + r.summary.removed + ' |');
    L.push('| 内容有变化 | ' + r.summary.changed + ' |');
    L.push('| 完全一致 | ' + r.summary.same + ' |');
    L.push('');
    if (r.added.length) {
      L.push('## 新增表（' + r.added.length + '）');
      L.push('');
      L.push('| 表代码 | 表名称 | 备注 |');
      L.push('| --- | --- | --- |');
      r.added.forEach(t => L.push('| ' + t.code + ' | ' + t.name + ' | ' + (t.comment || '') + ' |'));
      L.push('');
    }
    if (r.removed.length) {
      L.push('## 删除表（' + r.removed.length + '）');
      L.push('');
      L.push('| 表代码 | 表名称 | 备注 |');
      L.push('| --- | --- | --- |');
      r.removed.forEach(t => L.push('| ' + t.code + ' | ' + t.name + ' | ' + (t.comment || '') + ' |'));
      L.push('');
    }
    if (r.changed.length) {
      L.push('## 变更表（' + r.changed.length + '）');
      L.push('');
      r.changed.forEach(x => {
        L.push('### ' + x.b.code + '（' + x.b.name + '）');
        L.push('');
        x.changes.forEach(c => L.push('- **[' + c.type + ']** ' + c.detail));
        L.push('');
      });
    }
    if (r.views.added.length) {
      L.push('## 新增视图（' + r.views.added.length + '）');
      L.push('');
      r.views.added.forEach(v => L.push('- ' + v.code + '（' + v.name + '）'));
      L.push('');
    }
    if (r.views.removed.length) {
      L.push('## 删除视图（' + r.views.removed.length + '）');
      L.push('');
      r.views.removed.forEach(v => L.push('- ' + v.code + '（' + v.name + '）'));
      L.push('');
    }
    return L.join('\n');
  };

  if (typeof window !== 'undefined') window.Diff = Diff;
  if (typeof module !== 'undefined' && module.exports) module.exports = Diff;
})();
