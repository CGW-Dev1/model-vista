/* 验证 Shortcut 容器兜底扫描（旧逻辑 0 表 → fallback 找到） */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.DOMParser = dom.window.DOMParser;
global.performance = global.performance || { now: () => Date.now() };

eval(fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'pdm-parser.js'), 'utf-8'));

const xml = fs.readFileSync(path.join(__dirname, 'test-model-shortcut.pdm'), 'utf-8');
const model = window.PDMParser.parse(xml, 'test-model-shortcut.pdm');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.error('  ✗ FAIL: ' + msg); }
}

console.log('== Shortcut 兜底扫描 ==');
assert(model.tables.length === 2, '兜底找到 2 张表，实际 ' + model.tables.length);
assert(model.tables.some(t => t.code === 'CUST_INFO'), '表 CUST_INFO');
assert(model.tables.some(t => t.code === 'CUST_ORDER'), '表 CUST_ORDER');
const cust = model.tables.find(t => t.code === 'CUST_INFO');
assert(cust.columns.length === 2, 'CUST_INFO 字段数 = 2');
assert(cust.columns[0].isPK === true, '主键标记正确');

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
