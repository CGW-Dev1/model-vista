/* 解析器自动化测试：在 Node + jsdom 中运行 pdm-parser.js */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.DOMParser = dom.window.DOMParser;
global.performance = global.performance || { now: () => Date.now() };

const parserSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'pdm-parser.js'), 'utf-8');
eval(parserSrc);

const PDMParser = window.PDMParser;
const xml = fs.readFileSync(path.join(__dirname, 'test-model.pdm'), 'utf-8');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.error('  ✗ FAIL: ' + msg); }
}

console.log('== PDM 解析器测试 ==');
const model = PDMParser.parse(xml, 'test-model.pdm');

console.log('-- 模型 --');
assert(model.name === '电商业务系统', '模型名称: ' + model.name);
assert(model.code === 'SHOP', '模型代码: ' + model.code);
assert(model.dbms === 'MySQL 5.7', 'DBMS: ' + model.dbms);

console.log('-- 统计 --');
console.log(JSON.stringify(model.stats));
assert(model.stats.tables === 7, '表数量 = 7，实际 ' + model.stats.tables);
assert(model.stats.views === 1, '视图数量 = 1');
assert(model.stats.procedures === 1, '存储过程 = 1');
assert(model.stats.sequences === 1, '序列 = 1');
assert(model.stats.references === 6, '外键 = 6，实际 ' + model.stats.references);

console.log('-- 表结构 --');
const user = model.tables.find(t => t.code === 'SYS_USER');
assert(!!user, '找到 SYS_USER');
assert(user.columns.length === 8, 'SYS_USER 字段数 = 8');
assert(user.columns[0].code === 'USER_ID' && user.columns[0].isPK, 'USER_ID 为主键且排序第一');
assert(user.columns[0].identity === true, 'USER_ID 自增');
assert(user.columns[6].defaultValue === "'1'", 'STATUS 默认值');
const uname = user.columns.find(c => c.code === 'USERNAME');
assert(uname && uname.mandatory, 'USERNAME 非空');
assert(user.indexes.length === 1 && user.indexes[0].unique === true, 'SYS_USER 唯一索引');
assert(user.indexes[0].columns[0].colId === uname.id, '索引列引用正确');
assert(user.triggers.length === 1 && user.triggers[0].sql.includes('SYS_LOG'), '触发器 SQL 解析');

console.log('-- 包 --');
const role = model.tables.find(t => t.code === 'SYS_ROLE');
assert(!!role, '包内表 SYS_ROLE 可被解析（扁平收集）');
const order = model.tables.find(t => t.code === 'ORD_ORDER');
assert(!!order, '包内表 ORD_ORDER 可被解析');

console.log('-- 外键 --');
const fk1 = model.references.find(r => r.code === 'FK_ORDER_USER');
assert(!!fk1, '找到 FK_ORDER_USER');
const pt = model.tables.find(t => t.id === fk1.parentTableId);
const ct = model.tables.find(t => t.id === fk1.childTableId);
assert(pt && pt.code === 'SYS_USER', 'FK 父表 = SYS_USER');
assert(ct && ct.code === 'ORD_ORDER', 'FK 子表 = ORD_ORDER');
const pcol = pt.columns.find(c => c.id === fk1.joins[0].parentColId);
const ccol = ct.columns.find(c => c.id === fk1.joins[0].childColId);
assert(pcol && pcol.code === 'USER_ID', '父列 USER_ID');
assert(ccol && ccol.code === 'USER_ID', '子列 USER_ID');
assert(order.parentRefs && order.parentRefs.length === 1, 'ORD_ORDER 被引用 1 次');

console.log('-- 视图/过程 --');
const view = model.views.find(v => v.code === 'V_ORDER_DETAIL');
assert(!!view && view.sql.includes('JOIN'), '视图 SQL');
assert(view.columns.length === 3, '视图列数');
const proc = model.procedures[0];
assert(!!proc && proc.sql.includes('PROCEDURE'), '存储过程 SQL');
const seq = model.sequences[0];
assert(!!seq && seq.start === '100000' && seq.increment === '1', '序列属性');

console.log('-- 包层级 --');
assert(model.rootPackage.packages.length === 3, '根下 3 个包');
const pkg1 = model.rootPackage.packages.find(p => p.name === '用户模块');
assert(pkg1 && pkg1.tables.length === 3, '用户模块包含 3 张表');

console.log(`\n-- 新旧格式兼容 --`);
const fs2 = require('fs');
const v15xml = fs2.readFileSync(path.join(__dirname, 'test-model-v15.pdm'), 'utf-8');
const m15 = PDMParser.parse(v15xml, 'test-model-v15.pdm');
console.log('旧格式统计:', JSON.stringify(m15.stats));
assert(m15.name === '直销3.0', '旧格式根模型定位（三层包装 Model>RootObject>Children>Model）: ' + m15.name);
assert(m15.stats.tables === 1, '旧格式 c:Tables 容器解析（1 表）: ' + m15.stats.tables);
const t15 = m15.tables[0];
assert(t15.code === 'TCUSTINFO', '旧格式表代码: ' + t15.code);
assert(t15.columns.length > 0, '旧格式列解析: ' + t15.columns.length);
assert(t15.columns[0].mandatory === true, '旧格式 a:Mandatory 必填标记');
assert(t15.columns[0].dataType === 'VARCHAR2(12)', '旧格式数据类型');
assert(m15.stats.views === 1, '旧格式视图');
assert(m15.stats.references === 1, '旧格式外键');
assert(!!m15.tables[0].columns.find(c => c.code === 'VC_CUSTNO'), '旧格式列代码');

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
