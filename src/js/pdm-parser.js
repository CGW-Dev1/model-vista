/* ============================================================
 * PDM Parser - 解析 PowerDesigner .pdm (XML) 数据模型文件
 * 兼容不同版本的 PDM 格式，按 localName 解析（不依赖前缀）
 * ============================================================ */
(function () {
  'use strict';

  const PDMParser = {};

  /* ---------- DOM 工具 ---------- */

  function childrenOf(el, localName) {
    if (!el) return [];
    const out = [];
    const list = el.children || [];
    for (let i = 0; i < list.length; i++) {
      if (list[i].localName === localName) out.push(list[i]);
    }
    return out;
  }

  function childOf(el, localName) {
    const r = childrenOf(el, localName);
    return r.length ? r[0] : null;
  }

  function textOf(el) {
    return el ? (el.textContent || '').trim() : '';
  }

  function textOfAny(el, names) {
    for (const n of names) {
      const v = textOf(childOf(el, n));
      if (v) return v;
    }
    return '';
  }

  function refId(el) {
    return el ? (el.getAttribute('Ref') || '') : '';
  }

  /* 在元素内递归查找第一个带 Ref 属性的后代（兼容不同版本嵌套写法） */
  function findFirstRef(el) {
    if (!el) return '';
    if (el.getAttribute && el.getAttribute('Ref')) return el.getAttribute('Ref');
    const list = el.children || [];
    for (let i = 0; i < list.length; i++) {
      const r = findFirstRef(list[i]);
      if (r) return r;
    }
    return '';
  }

  /* 递归收集特定 localName 的后代元素（限 c:Children / c:Columns 等容器内使用） */
  function collectDeep(rootEl, localName, out) {
    if (!rootEl || !rootEl.children) return out;
    for (const ch of rootEl.children) {
      if (ch.localName === localName) out.push(ch);
      collectDeep(ch, localName, out);
    }
    return out;
  }

  /* ---------- 对象提取 ---------- */

  function parseColumn(colEl, idMap) {
    const c = {
      id: colEl.getAttribute('Id') || '',
      name: textOf(childOf(colEl, 'Name')),
      code: textOf(childOf(colEl, 'Code')),
      comment: textOf(childOf(colEl, 'Comment')) || textOf(childOf(colEl, 'Description')),
      dataType: textOf(childOf(colEl, 'DataType')),
      length: textOf(childOf(colEl, 'Length')),
      precision: textOf(childOf(colEl, 'Precision')),
      mandatory: textOf(childOf(colEl, 'Column.Mandatory')) === '1' || textOf(childOf(colEl, 'Mandatory')) === '1',
      identity: textOf(childOf(colEl, 'Identity')) === '1',
      defaultValue: textOf(childOf(colEl, 'DefaultValue')),
      sequence: parseInt(textOf(childOf(colEl, 'Sequence')), 10) || 0,
      isPK: false,
      computed: ''
    };
    const compute = childOf(colEl, 'ComputedExpr');
    if (compute) c.computed = textOf(compute);
    if (!c.name && !c.code) return null;
    return c;
  }

  function parseTable(tblEl, model) {
    const t = {
      type: 'table',
      id: tblEl.getAttribute('Id') || '',
      name: textOf(childOf(tblEl, 'Name')),
      code: textOf(childOf(tblEl, 'Code')),
      comment: textOf(childOf(tblEl, 'Comment')) || textOf(childOf(tblEl, 'Description')),
      columns: [],
      keys: [],
      primaryKeyId: '',
      indexes: [],
      triggers: [],
      shortName: ''
    };

    /* 列 */
    const colsContainer = childOf(tblEl, 'Columns');
    if (colsContainer) {
      for (const colEl of childrenOf(colsContainer, 'Column')) {
        const c = parseColumn(colEl, model.idMap);
        if (c) t.columns.push(c);
      }
    }
    t.columns.sort((a, b) => (a.sequence || 9999) - (b.sequence || 9999));

    /* 键 */
    const keysContainer = childOf(tblEl, 'Keys');
    if (keysContainer) {
      for (const keyEl of childrenOf(keysContainer, 'Key')) {
        const k = { id: keyEl.getAttribute('Id') || '', name: textOf(childOf(keyEl, 'Name')), code: textOf(childOf(keyEl, 'Code')), columns: [] };
        const kc = childOf(keyEl, 'Key.Columns');
        if (kc) {
          for (const refEl of kc.children) {
            if (refEl.getAttribute) {
              const rid = refId(refEl);
              if (rid) k.columns.push(rid);
            }
          }
        }
        t.keys.push(k);
      }
    }
    const pkEl = childOf(tblEl, 'PrimaryKey');
    if (pkEl) {
      const pkRefEl = pkEl.firstElementChild;
      t.primaryKeyId = refId(pkRefEl) || textOf(pkRefEl);
    }
    /* 标记主键列 */
    const pk = t.keys.find(k => k.id === t.primaryKeyId);
    if (pk) {
      for (const colId of pk.columns) {
        const col = t.columns.find(c => c.id === colId);
        if (col) col.isPK = true;
      }
    }
    if (!pk && t.keys.length) { /* 无显式 PK 时尝试第一个 Key */
      // 不自动标为主键，避免误导
    }

    /* 索引 */
    const idxContainer = childOf(tblEl, 'Indexes');
    if (idxContainer) {
      for (const idxEl of childrenOf(idxContainer, 'Index')) {
        const ix = {
          id: idxEl.getAttribute('Id') || '',
          name: textOf(childOf(idxEl, 'Name')),
          code: textOf(childOf(idxEl, 'Code')),
          unique: textOf(childOf(idxEl, 'Unique')) === '1',
          cluster: textOf(childOf(idxEl, 'Cluster')) === '1',
          columns: []
        };
        const icc = childOf(idxEl, 'IndexColumns') || childOf(idxEl, 'Index.Columns');
        if (icc) {
          for (const icEl of icc.children) {
            if (icEl.localName === 'IndexColumn' || icEl.localName === 'Index.Columns') {
              const colRef = findFirstRef(icEl);
              const sort = textOf(childOf(icEl, 'SortOrder')) || 'ASC';
              if (colRef) ix.columns.push({ colId: colRef, sortOrder: sort });
            }
          }
        }
        t.indexes.push(ix);
      }
    }

    /* 触发器 */
    const trgContainer = childOf(tblEl, 'Triggers');
    if (trgContainer) {
      for (const trgEl of childrenOf(trgContainer, 'Trigger')) {
        t.triggers.push({
          id: trgEl.getAttribute('Id') || '',
          name: textOf(childOf(trgEl, 'Name')),
          code: textOf(childOf(trgEl, 'Code')),
          timing: textOf(childOf(trgEl, 'TriggerTiming')) || textOf(childOf(trgEl, 'Timing')),
          event: textOf(childOf(trgEl, 'TriggerEvent')) || textOf(childOf(trgEl, 'Event')),
          sql: textOfAny(trgEl, ['SQLText', 'TriggerSQL', 'SQL', 'Text', 'SQLQuery'])
        });
      }
    }
    return t;
  }

  function parseView(viewEl) {
    const v = {
      type: 'view',
      id: viewEl.getAttribute('Id') || '',
      name: textOf(childOf(viewEl, 'Name')),
      code: textOf(childOf(viewEl, 'Code')),
      comment: textOf(childOf(viewEl, 'Comment')),
      columns: [],
      sql: textOfAny(viewEl, ['SQLText', 'SQLQuery', 'SQL', 'Text', 'BeginScript'])
    };
    const colsContainer = childOf(viewEl, 'Columns');
    if (colsContainer) {
      for (const colEl of childrenOf(colsContainer, 'ViewColumn')) {
        v.columns.push({
          id: colEl.getAttribute('Id') || '',
          name: textOf(childOf(colEl, 'Name')),
          code: textOf(childOf(colEl, 'Code')),
          comment: textOf(childOf(colEl, 'Comment')),
          dataType: textOf(childOf(colEl, 'DataType')),
          sequence: parseInt(textOf(childOf(colEl, 'Sequence')), 10) || 0
        });
      }
    }
    v.columns.sort((a, b) => (a.sequence || 9999) - (b.sequence || 9999));
    return v;
  }

  function parseReference(refEl) {
    const r = {
      type: 'reference',
      id: refEl.getAttribute('Id') || '',
      name: textOf(childOf(refEl, 'Name')),
      code: textOf(childOf(refEl, 'Code')),
      parentTableId: findFirstRef(childOf(refEl, 'ParentTable')),
      childTableId: findFirstRef(childOf(refEl, 'ChildTable')),
      joins: [],
      cardinality: textOf(childOf(refEl, 'Cardinality')),
      updateConstraint: textOf(childOf(refEl, 'UpdateConstraint')),
      deleteConstraint: textOf(childOf(refEl, 'DeleteConstraint'))
    };
    const joinsEl = childOf(refEl, 'Joins');
    if (joinsEl) {
      for (const joinEl of childrenOf(joinsEl, 'ReferenceJoin')) {
        const p = findFirstRef(childOf(joinEl, 'Object1Table'));
        const ch = findFirstRef(childOf(joinEl, 'Object2Table'));
        if (p || ch) r.joins.push({ parentColId: p, childColId: ch });
      }
    }
    /* 兜底：部分版本直接使用 Object1/Object2 */
    if (!r.joins.length) {
      const p = findFirstRef(childOf(refEl, 'Object1'));
      const ch = findFirstRef(childOf(refEl, 'Object2'));
      if (p || ch) r.joins.push({ parentColId: p, childColId: ch });
    }
    return r;
  }

  function parseProcedure(procEl, type) {
    return {
      type: type || 'procedure',
      id: procEl.getAttribute('Id') || '',
      name: textOf(childOf(procEl, 'Name')),
      code: textOf(childOf(procEl, 'Code')),
      comment: textOf(childOf(procEl, 'Comment')),
      sql: textOfAny(procEl, ['SQLText', 'SQLQuery', 'SQL', 'Text', 'CreationScript', 'SourceCode'])
    };
  }

  function parseSequence(seqEl) {
    return {
      type: 'sequence',
      id: seqEl.getAttribute('Id') || '',
      name: textOf(childOf(seqEl, 'Name')),
      code: textOf(childOf(seqEl, 'Code')),
      comment: textOf(childOf(seqEl, 'Comment')),
      increment: textOf(childOf(seqEl, 'Increment')),
      start: textOf(childOf(seqEl, 'StartValue')) || textOf(childOf(seqEl, 'Start')),
      minValue: textOf(childOf(seqEl, 'MinValue')),
      maxValue: textOf(childOf(seqEl, 'MaxValue')),
      cycle: textOf(childOf(seqEl, 'Cycle')) === '1' ? '是' : '否'
    };
  }

  function parseTriggerTop(trgEl) {
    return {
      type: 'trigger',
      id: trgEl.getAttribute('Id') || '',
      name: textOf(childOf(trgEl, 'Name')),
      code: textOf(childOf(trgEl, 'Code')),
      sql: textOfAny(trgEl, ['SQLText', 'TriggerSQL', 'SQL', 'Text'])
    };
  }

  /* ---------- 模型解析 ---------- */

  function parse(content, fileName) {
    const t0 = performance.now();
    const doc = new DOMParser().parseFromString(content, 'text/xml');
    const err = doc.getElementsByTagName('parsererror');
    if (err.length) throw new Error('文件不是有效的 XML/PDM 格式：' + fileName);

    const all = doc.getElementsByTagName('*');
    /* 根模型定位：兼容 PD16（直接 o:Model）与 PD12-15（Model > o:RootObject > c:Children > o:Model 三层包装） */
    const modelEls = [];
    for (const el of all) {
      if (el.localName === 'Model') modelEls.push(el);
    }
    const rootModel = modelEls.find(el => childOf(el, 'Name')) || modelEls[0];
    if (!rootModel) throw new Error('未找到 PowerDesigner 模型节点，请确认是 .pdm 文件（当前版本暂不支持 Navicat ndm2 等其他格式）：' + fileName);

    const model = {
      fileName: fileName,
      name: textOf(childOf(rootModel, 'Name')),
      code: textOf(childOf(rootModel, 'Code')),
      comment: textOf(childOf(rootModel, 'Comment')),
      author: textOf(childOf(rootModel, 'Author')),
      version: textOf(childOf(rootModel, 'Version')),
      dbms: '',
      packages: [],   // 树形：{id,name,code,children:{tables,views,...}}
      tables: [], views: [], references: [], procedures: [], sequences: [], triggers: [],
      idMap: {},      // id -> 浅信息（用于 Ref 解析）
      parseMs: 0
    };

    /* id 索引：所有带 Id 的元素（用于 Ref 解析） */
    for (const el of all) {
      const id = el.getAttribute && el.getAttribute('Id');
      if (id) model.idMap[id] = el;
    }

    /* DBMS：c:DBMS 下的 Shortcut/Name */
    const dbmsEl = childOf(rootModel, 'DBMS');
    if (dbmsEl) {
      const sc = childOf(dbmsEl, 'Shortcut');
      model.dbms = textOf(childOf(sc, 'Name')) || textOf(dbmsEl.firstElementChild);
    }

    /* 按对象元素分派（新旧格式共用） */
    function addObject(el, pkgNode) {
      const ln = el.localName;
      switch (ln) {
        case 'Package': {
          const pkg = {
            type: 'package',
            id: el.getAttribute('Id') || '',
            name: textOf(childOf(el, 'Name')),
            code: textOf(childOf(el, 'Code')),
            tables: [], views: [], references: [], procedures: [], sequences: [], triggers: []
          };
          pkgNode.packages.push(pkg);
          walkChildren(el, pkg);
          break;
        }
        case 'Table': {
          const t = parseTable(el, model);
          t._pkg = pkgNode.name || '';
          pkgNode.tables.push(t); model.tables.push(t);
          break;
        }
        case 'View': {
          const v = parseView(el);
          pkgNode.views.push(v); model.views.push(v);
          break;
        }
        case 'Reference': {
          const r = parseReference(el);
          pkgNode.references.push(r); model.references.push(r);
          break;
        }
        case 'Procedure': {
          const p = parseProcedure(el, 'procedure');
          pkgNode.procedures.push(p); model.procedures.push(p);
          break;
        }
        case 'Sequence': {
          const s = parseSequence(el);
          pkgNode.sequences.push(s); model.sequences.push(s);
          break;
        }
        case 'Trigger': {
          const tr = parseTriggerTop(el);
          pkgNode.triggers.push(tr); model.triggers.push(tr);
          break;
        }
        default: break;
      }
    }

    /* 递归展开容器：
     * 新格式（PD16+）：c:Children 混排所有对象
     * 旧格式（PD12-15）：c:Tables / c:Views / c:References / c:Procedures / c:Sequences / c:Triggers / c:Packages 分类集合 */
    function walkChildren(containerEl, pkgNode) {
      const childrenEl = childOf(containerEl, 'Children');
      if (childrenEl) {
        for (const el of childrenEl.children) addObject(el, pkgNode);
        return;
      }
      const legacyCols = ['Tables', 'Views', 'References', 'Procedures', 'Sequences', 'Triggers', 'Packages'];
      for (const name of legacyCols) {
        const collEl = childOf(containerEl, name);
        if (!collEl) continue;
        for (const el of collEl.children) addObject(el, pkgNode);
      }
    }

    const rootPkg = {
      type: 'package',
      id: rootModel.getAttribute('Id') || 'root',
      name: model.name || fileName,
      code: model.code,
      packages: [], tables: [], views: [], references: [], procedures: [], sequences: [], triggers: []
    };
    model.rootPackage = rootPkg;
    model.packages.push(rootPkg);
    walkChildren(rootModel, rootPkg);

    /* 兜底扫描：若 walkChildren 没找到任何 Table，则全树递归收集所有 o:Table。
       兼容某些 PDM 把 Tables 装在自定义容器/Shortcut 链里的情况。 */
    if (model.tables.length === 0) {
      const legacy = { tables: [], views: [], references: [], procedures: [], sequences: [], triggers: [] };
      function scanTree(el) {
        if (!el || !el.children) return;
        for (const ch of el.children) {
          const ln = ch.localName;
          if (ln === 'Table') legacy.tables.push(ch);
          else if (ln === 'View') legacy.views.push(ch);
          else if (ln === 'Reference') legacy.references.push(ch);
          else if (ln === 'Procedure') legacy.procedures.push(ch);
          else if (ln === 'Sequence') legacy.sequences.push(ch);
          else if (ln === 'Trigger') legacy.triggers.push(ch);
          /* 仅深入可能包含对象的容器，避免 Column/Index 等叶子节点膨胀 */
          else if (ln === 'Package' || ln === 'Shortcut' || ln === 'Children' ||
                   ln === 'Tables' || ln === 'Views' || ln === 'References' ||
                   ln === 'Procedures' || ln === 'Sequences' || ln === 'Triggers' ||
                   ln === 'Packages' || ln === 'Model') scanTree(ch);
        }
      }
      scanTree(rootModel);
      /* 兜底结果直接挂到根包与 model，避免覆盖 walkChildren 已识别的合法包结构 */
      legacy.tables.forEach(el => { const t = parseTable(el, model); t._pkg = rootPkg.name || ''; rootPkg.tables.push(t); model.tables.push(t); });
      legacy.views.forEach(el => { const v = parseView(el); rootPkg.views.push(v); model.views.push(v); });
      legacy.references.forEach(el => { const r = parseReference(el); rootPkg.references.push(r); model.references.push(r); });
      legacy.procedures.forEach(el => { const p = parseProcedure(el, 'procedure'); rootPkg.procedures.push(p); model.procedures.push(p); });
      legacy.sequences.forEach(el => { const s = parseSequence(el); rootPkg.sequences.push(s); model.sequences.push(s); });
      legacy.triggers.forEach(el => { const tr = parseTriggerTop(el); rootPkg.triggers.push(tr); model.triggers.push(tr); });
    }

    /* 外键关系双向登记 */
    for (const r of model.references) {
      const parent = model.tables.find(t => t.id === r.parentTableId);
      const child = model.tables.find(t => t.id === r.childTableId);
      if (parent) parent.parentRefs = (parent.parentRefs || []).concat(r.id);   // 我被引用（我是父表）
      if (child) child.childRefs = (child.childRefs || []).concat(r.id);        // 我引用别人（我是子表）
    }

    /* 统计 */
    model.stats = {
      tables: model.tables.length,
      views: model.views.length,
      references: model.references.length,
      procedures: model.procedures.length,
      sequences: model.sequences.length,
      triggers: model.triggers.length + model.tables.reduce((s, t) => s + t.triggers.length, 0),
      columns: model.tables.reduce((s, t) => s + t.columns.length, 0)
    };
    model.parseMs = Math.round(performance.now() - t0);
    /* idMap 仅解析期用于 Ref 查找：清空以释放 DOM 树内存，
       同时保证 model 可 JSON 序列化（磁盘缓存依赖） */
    model.idMap = {};
    return model;
  }

  /* 根据 Ref id 找列对象（跨表） */
  function findColumn(model, table, colId) {
    if (!table) return null;
    let col = table.columns.find(c => c.id === colId);
    if (col) return col;
    /* 全模型兜底查找 */
    for (const t of model.tables) {
      col = t.columns.find(c => c.id === colId);
      if (col) return col;
    }
    return null;
  }

  PDMParser.parse = parse;
  PDMParser.findColumn = findColumn;
  window.PDMParser = PDMParser;
})();
