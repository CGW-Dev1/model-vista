/* Diff 单元测试 */
const assert = require('assert');
const Diff = require('../src/js/diff.js');

console.log('== Diff 模型对比 ==');
const a = {
  name: 'A',
  tables: [
    { code: 'T1', name: '表1', comment: 'c1', columns: [{ code: 'C1', name: '列1', dataType: 'INT', isPK: true, mandatory: true, defaultValue: '', comment: '' }] },
    { code: 'T2', name: '表2', comment: '', columns: [] }
  ],
  views: [{ code: 'V1', name: '视图1' }]
};
const b = {
  name: 'B',
  tables: [
    { code: 'T1', name: '表1', comment: 'c1_mod', columns: [{ code: 'C1', name: '列1', dataType: 'BIGINT', isPK: false, mandatory: false, defaultValue: '0', comment: '说明' }] },
    { code: 'T3', name: '表3', comment: '', columns: [] }
  ],
  views: [{ code: 'V2', name: '视图2' }]
};

const r = Diff.compare(a, b);
assert.strictEqual(r.added.length, 1);
assert.strictEqual(r.added[0].code, 'T3');
console.log('  ✓ 新增表检测（T3）');
assert.strictEqual(r.removed.length, 1);
assert.strictEqual(r.removed[0].code, 'T2');
console.log('  ✓ 删除表检测（T2）');
assert.strictEqual(r.changed.length, 1);
console.log('  ✓ 变更表统计');

const changes = r.changed[0].changes;
assert(changes.some(c => c.type === '字段类型变更' && c.detail.includes('INT → BIGINT')));
console.log('  ✓ 字段类型变更检测');
assert(changes.some(c => c.type === '字段注释变更' && c.detail.includes('说明')));
console.log('  ✓ 字段注释变更检测');
assert(changes.some(c => c.type === '字段约束变更' && c.detail.includes('NOT NULL → 可空')));
console.log('  ✓ 字段约束变更检测');

const tColDel = {
  name: 'A',
  tables: [{ code: 'T1', name: '表1', comment: '', columns: [{ code: 'C1', name: 'c1', dataType: 'INT' }, { code: 'C2', name: 'c2', dataType: 'INT' }] }],
  views: []
};
const tColAdd = {
  name: 'B',
  tables: [{ code: 'T1', name: '表1', comment: '', columns: [{ code: 'C1', name: 'c1', dataType: 'INT' }, { code: 'C3', name: 'c3', dataType: 'INT' }] }],
  views: []
};
const r2 = Diff.compare(tColDel, tColAdd);
assert(r2.changed[0].changes.some(c => c.type === '删除字段' && c.detail.includes('C2')));
console.log('  ✓ 删除字段检测');
assert(r2.changed[0].changes.some(c => c.type === '新增字段' && c.detail.includes('C3')));
console.log('  ✓ 新增字段检测');

assert.strictEqual(r.views.added.length, 1);
assert.strictEqual(r.views.added[0].code, 'V2');
assert.strictEqual(r.views.removed.length, 1);
assert.strictEqual(r.views.removed[0].code, 'V1');
console.log('  ✓ 视图差异检测');

const md = Diff.toMarkdown(r, 'A', 'B');
assert(md.includes('A') && md.includes('B') && md.includes('T3'));
console.log('  ✓ Markdown 报告生成');

const same = Diff.compare(a, a);
assert.strictEqual(same.summary.added, 0);
assert.strictEqual(same.summary.removed, 0);
assert.strictEqual(same.summary.changed, 0);
assert.strictEqual(same.summary.same, 2);
console.log('  ✓ 相同模型零差异');

console.log('\n结果: 全部通过');
