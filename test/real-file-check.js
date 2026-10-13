/* 临时脚本：用 jsdom 解析真实大文件，验证解析器与耗时（验证后可删） */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const file = process.argv[2] || 'F:\\终端直销PDM\\新接口.pdm';
const t0 = Date.now();
const xml = fs.readFileSync(file, 'utf-8');
console.log('读取耗时:', Date.now() - t0, 'ms, 大小:', (xml.length / 1048576).toFixed(1), 'MB');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.DOMParser = dom.window.DOMParser;
global.performance = global.performance || { now: () => Date.now() };

eval(fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'pdm-parser.js'), 'utf-8'));

const t1 = Date.now();
const model = window.PDMParser.parse(xml, path.basename(file));
console.log('解析耗时:', Date.now() - t1, 'ms (parseMs=' + model.parseMs + ')');
console.log('模型名:', model.name, '| DBMS:', model.dbms);
console.log('统计:', JSON.stringify(model.stats));
const first = model.tables[0];
console.log('第一张表:', first.code, '-', first.name, '| 字段数:', first.columns.length, '| 第1字段:', first.columns[0].code, first.columns[0].dataType, 'mandatory=' + first.columns[0].mandatory, 'pk=' + first.columns[0].isPK);
const pkCount = model.tables.filter(t => t.columns.some(c => c.isPK)).length;
console.log('有主键标记的表数量:', pkCount);
const fkTables = model.references.length;
console.log('外键:', fkTables, '| 视图:', model.views.length, '| 视图SQL样例长度:', (model.views[0] && model.views[0].sql || '').length);
