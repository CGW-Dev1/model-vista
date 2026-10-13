# -*- coding: utf-8 -*-
"""生成模拟 PowerDesigner PDM (XML) 测试文件，用于验证解析器"""
import os

def col(id, name, code, dtype, length='', prec='', mandatory=0, identity=0, seq=0, comment='', default=''):
    x = f'      <o:Column Id="{id}">\n        <a:Name>{name}</a:Name>\n        <a:Code>{code}</a:Code>\n'
    if comment: x += f'        <a:Comment>{comment}</a:Comment>\n'
    x += f'        <a:DataType>{dtype}</a:DataType>\n'
    if length: x += f'        <a:Length>{length}</a:Length>\n'
    if prec: x += f'        <a:Precision>{prec}</a:Precision>\n'
    if mandatory: x += '        <a:Column.Mandatory>1</a:Column.Mandatory>\n'
    if identity: x += '        <a:Identity>1</a:Identity>\n'
    if default: x += f'        <a:DefaultValue>{default}</a:DefaultValue>\n'
    x += f'        <a:Sequence>{seq}</a:Sequence>\n      </o:Column>\n'
    return x

def table(tid, name, code, comment, cols, pk_id, pk_cols, indexes='', triggers=''):
    x = f'    <o:Table Id="{tid}">\n      <a:Name>{name}</a:Name>\n      <a:Code>{code}</a:Code>\n'
    if comment: x += f'      <a:Comment>{comment}</a:Comment>\n'
    x += '      <c:Columns>\n'
    for c in cols: x += c
    x += '      </c:Columns>\n'
    x += f'      <c:Keys>\n        <o:Key Id="{pk_id}">\n          <a:Name>Key{pk_id}</a:Name>\n          <c:Key.Columns>\n'
    for cid in pk_cols:
        x += f'            <o:Column Ref="{cid}"/>\n'
    x += '          </c:Key.Columns>\n        </o:Key>\n      </c:Keys>\n'
    x += f'      <c:PrimaryKey>\n        <o:Key Ref="{pk_id}"/>\n      </c:PrimaryKey>\n'
    if indexes:
        x += indexes
    if triggers:
        x += triggers
    x += '    </o:Table>\n'
    return x

def index(iid, name, code, unique, col_refs):
    x = f'      <c:Indexes>\n        <o:Index Id="{iid}">\n          <a:Name>{name}</a:Name>\n          <a:Code>{code}</a:Code>\n'
    if unique: x += '          <a:Unique>1</a:Unique>\n'
    x += '          <c:IndexColumns>\n'
    for cid, sort in col_refs:
        x += f'            <o:IndexColumn Id="ic_{iid}_{cid}">\n              <a:SortOrder>{sort}</a:SortOrder>\n              <c:Column><o:Column Ref="{cid}"/></c:Column>\n            </o:IndexColumn>\n'
    x += '          </c:IndexColumns>\n        </o:Index>\n      </c:Indexes>\n'
    return x

def trigger(tgid, name, code, timing, event, sql):
    return (f'      <c:Triggers>\n        <o:Trigger Id="{tgid}">\n          <a:Name>{name}</a:Name>\n          <a:Code>{code}</a:Code>\n'
            f'          <a:TriggerTiming>{timing}</a:TriggerTiming>\n          <a:TriggerEvent>{event}</a:TriggerEvent>\n'
            f'          <a:SQLText>{sql}</a:SQLText>\n        </o:Trigger>\n      </c:Triggers>\n')

def ref(rid, name, parent, child, pcol, ccol):
    return (f'  <o:Reference Id="{rid}">\n    <a:Name>{name}</a:Name>\n    <a:Code>{name}</a:Code>\n'
            f'    <c:ParentTable><o:Table Ref="{parent}"/></c:ParentTable>\n'
            f'    <c:ChildTable><o:Table Ref="{child}"/></c:ChildTable>\n'
            f'    <c:Joins>\n      <o:ReferenceJoin Id="{rid}j">\n'
            f'        <c:Object1Table><o:Column Ref="{pcol}"/></c:Object1Table>\n'
            f'        <c:Object2Table><o:Column Ref="{ccol}"/></c:Object2Table>\n'
            f'      </o:ReferenceJoin>\n    </c:Joins>\n  </o:Reference>\n')

# ---------- 用户模块 ----------
user_cols = [
    col('c1', '用户ID', 'USER_ID', 'BIGINT', '19', '', 1, 1, 1, '主键，自增'),
    col('c2', '用户名', 'USERNAME', 'VARCHAR', '64', '', 1, 0, 2, '登录账号，唯一'),
    col('c3', '密码', 'PASSWORD', 'VARCHAR', '128', '', 1, 0, 3, '加密后的密码'),
    col('c4', '真实姓名', 'REAL_NAME', 'VARCHAR', '64', '', 0, 0, 4, ''),
    col('c5', '手机号', 'PHONE', 'VARCHAR', '20', '', 0, 0, 5, ''),
    col('c6', '邮箱', 'EMAIL', 'VARCHAR', '128', '', 0, 0, 6, ''),
    col('c7', '状态', 'STATUS', 'SMALLINT', '2', '', 1, 0, 7, '0-禁用 1-启用', "'1'"),
    col('c8', '创建时间', 'CREATE_TIME', 'DATETIME', '', '', 1, 0, 8, '注册时间'),
]
t_user = table('t1', '用户表', 'SYS_USER', '系统用户信息表', user_cols, 'k1', ['c1'],
               index('i1', 'IDX_USER_NAME', 'UK_USER_USERNAME', 1, [('c2', 'ASC')]),
               trigger('tg1', '触发-用户创建', 'TRG_USER_CREATE', 'AFTER', 'INSERT',
                       "INSERT INTO SYS_LOG(EVENT) VALUES('user created')"))

role_cols = [
    col('c10', '角色ID', 'ROLE_ID', 'BIGINT', '19', '', 1, 1, 1, ''),
    col('c11', '角色编码', 'ROLE_CODE', 'VARCHAR', '64', '', 1, 0, 2, ''),
    col('c12', '角色名称', 'ROLE_NAME', 'VARCHAR', '128', '', 1, 0, 3, ''),
]
t_role = table('t2', '角色表', 'SYS_ROLE', '系统角色定义', role_cols, 'k2', ['c10'])

ur_cols = [
    col('c20', '主键ID', 'ID', 'BIGINT', '19', '', 1, 1, 1, ''),
    col('c21', '用户ID', 'USER_ID', 'BIGINT', '19', '', 1, 0, 2, '引用用户表'),
    col('c22', '角色ID', 'ROLE_ID', 'BIGINT', '19', '', 1, 0, 3, '引用角色表'),
]
t_ur = table('t3', '用户角色表', 'SYS_USER_ROLE', '用户与角色多对多关系', ur_cols, 'k3', ['c20'])

# ---------- 订单模块 ----------
order_cols = [
    col('c30', '订单ID', 'ORDER_ID', 'BIGINT', '19', '', 1, 1, 1, '主键'),
    col('c31', '订单号', 'ORDER_NO', 'VARCHAR', '32', '', 1, 0, 2, '业务订单号，规则：ORD+日期+序列'),
    col('c32', '用户ID', 'USER_ID', 'BIGINT', '19', '', 1, 0, 3, '下单用户'),
    col('c33', '订单金额', 'AMOUNT', 'DECIMAL', '12', '2', 1, 0, 4, '订单总金额'),
    col('c34', '订单状态', 'STATUS', 'SMALLINT', '2', '', 1, 0, 5, '0-待支付 1-已支付 2-已发货 3-已完成 4-已取消'),
    col('c35', '下单时间', 'CREATE_TIME', 'DATETIME', '', '', 1, 0, 6, ''),
]
t_order = table('t4', '订单表', 'ORD_ORDER', '销售订单主表', order_cols, 'k4', ['c30'],
                index('i2', 'IDX_ORDER_USER', 'IDX_ORD_ORDER_USER', 0, [('c32', 'ASC')]),
                trigger('tg2', '触发-订单创建', 'TRG_ORDER_CREATE', 'AFTER', 'INSERT',
                        "UPDATE SYS_STAT SET ORDER_COUNT = ORDER_COUNT + 1"))

oi_cols = [
    col('c40', '明细ID', 'ITEM_ID', 'BIGINT', '19', '', 1, 1, 1, ''),
    col('c41', '订单ID', 'ORDER_ID', 'BIGINT', '19', '', 1, 0, 2, '所属订单'),
    col('c42', '商品ID', 'PRODUCT_ID', 'BIGINT', '19', '', 1, 0, 3, '购买的商品'),
    col('c43', '数量', 'QTY', 'INT', '10', '', 1, 0, 4, ''),
    col('c44', '单价', 'PRICE', 'DECIMAL', '12', '2', 1, 0, 5, '成交单价'),
]
t_oi = table('t5', '订单明细表', 'ORD_ORDER_ITEM', '订单商品明细', oi_cols, 'k5', ['c40'])

prod_cols = [
    col('c50', '商品ID', 'PRODUCT_ID', 'BIGINT', '19', '', 1, 1, 1, ''),
    col('c51', '商品编码', 'PRODUCT_CODE', 'VARCHAR', '64', '', 1, 0, 2, ''),
    col('c52', '商品名称', 'PRODUCT_NAME', 'VARCHAR', '256', '', 1, 0, 3, ''),
    col('c53', '分类ID', 'CATEGORY_ID', 'BIGINT', '19', '', 1, 0, 4, '商品分类'),
    col('c54', '售价', 'PRICE', 'DECIMAL', '12', '2', 1, 0, 5, ''),
    col('c55', '库存', 'STOCK', 'INT', '10', '', 1, 0, 6, '', '0'),
]
t_prod = table('t6', '商品表', 'PRD_PRODUCT', '在售商品信息', prod_cols, 'k6', ['c50'])

cat_cols = [
    col('c60', '分类ID', 'CATEGORY_ID', 'BIGINT', '19', '', 1, 1, 1, ''),
    col('c61', '分类名称', 'CATEGORY_NAME', 'VARCHAR', '128', '', 1, 0, 2, ''),
    col('c62', '父分类ID', 'PARENT_ID', 'BIGINT', '19', '', 0, 0, 3, '上级分类，顶级为空'),
]
t_cat = table('t7', '商品分类表', 'PRD_CATEGORY', '商品分类树', cat_cols, 'k7', ['c60'])

view_sql = 'SELECT o.ORDER_NO, u.USERNAME, i.QTY, i.PRICE, p.PRODUCT_NAME FROM ORD_ORDER o JOIN SYS_USER u ON o.USER_ID = u.USER_ID JOIN ORD_ORDER_ITEM i ON i.ORDER_ID = o.ORDER_ID JOIN PRD_PRODUCT p ON p.PRODUCT_ID = i.PRODUCT_ID'
view = ('    <o:View Id="v1">\n      <a:Name>订单明细视图</a:Name>\n      <a:Code>V_ORDER_DETAIL</a:Code>\n'
        '      <a:Comment>订单与商品汇总查询视图</a:Comment>\n'
        '      <c:Columns>\n'
        '        <o:ViewColumn Id="vc1"><a:Name>订单号</a:Name><a:Code>ORDER_NO</a:Code><a:Sequence>1</a:Sequence></o:ViewColumn>\n'
        '        <o:ViewColumn Id="vc2"><a:Name>用户名</a:Name><a:Code>USERNAME</a:Code><a:Sequence>2</a:Sequence></o:ViewColumn>\n'
        '        <o:ViewColumn Id="vc3"><a:Name>商品名称</a:Name><a:Code>PRODUCT_NAME</a:Code><a:Sequence>3</a:Sequence></o:ViewColumn>\n'
        '      </c:Columns>\n'
        f'      <a:SQLText>{view_sql}</a:SQLText>\n'
        '    </o:View>\n')

proc = ('    <o:Procedure Id="sp1">\n      <a:Name>计算订单金额</a:Name>\n      <a:Code>SP_CALC_ORDER_AMOUNT</a:Code>\n'
        '      <a:Comment>根据明细汇总订单金额</a:Comment>\n'
        '      <a:SQLText>CREATE PROCEDURE SP_CALC_ORDER_AMOUNT(p_order_id BIGINT) BEGIN SELECT SUM(QTY*PRICE) INTO @amt FROM ORD_ORDER_ITEM WHERE ORDER_ID = p_order_id; UPDATE ORD_ORDER SET AMOUNT = @amt WHERE ORDER_ID = p_order_id; END</a:SQLText>\n'
        '    </o:Procedure>\n')

seq = ('    <o:Sequence Id="sq1">\n      <a:Name>订单号序列</a:Name>\n      <a:Code>SEQ_ORDER_NO</a:Code>\n'
       '      <a:Comment>生成订单号后缀</a:Comment>\n'
       '      <a:StartValue>100000</a:StartValue>\n      <a:Increment>1</a:Increment>\n'
       '      <a:MinValue>1</a:MinValue>\n      <a:MaxValue>999999999</a:MaxValue>\n    </o:Sequence>\n')

pkg_user = ('  <c:Children>\n'
            '    <o:Package Id="pkg1">\n      <a:Name>用户模块</a:Name>\n      <a:Code>USER_MOD</a:Code>\n'
            '      <c:Children>\n' + t_user + t_role + t_ur +
            '        ' + ref('r1', 'FK_USER_ROLE_USER', 't1', 't3', 'c1', 'c21').strip() + '\n'
            '        ' + ref('r2', 'FK_USER_ROLE_ROLE', 't2', 't3', 'c10', 'c22').strip() + '\n'
            '      </c:Children>\n    </o:Package>\n'
            '    <o:Package Id="pkg2">\n      <a:Name>订单模块</a:Name>\n      <a:Code>ORDER_MOD</a:Code>\n'
            '      <c:Children>\n' + t_order + t_oi + view +
            '        ' + ref('r3', 'FK_ORDER_USER', 't1', 't4', 'c1', 'c32').strip() + '\n'
            '        ' + ref('r4', 'FK_ORDER_ITEM_ORDER', 't4', 't5', 'c30', 'c41').strip() + '\n'
            '      </c:Children>\n    </o:Package>\n'
            '    <o:Package Id="pkg3">\n      <a:Name>商品模块</a:Name>\n      <a:Code>PRD_MOD</a:Code>\n'
            '      <c:Children>\n' + t_prod + t_cat +
            '        ' + ref('r5', 'FK_PRODUCT_CATEGORY', 't7', 't6', 'c60', 'c53').strip() + '\n'
            '        ' + ref('r6', 'FK_ORDER_ITEM_PRODUCT', 't6', 't5', 'c50', 'c42').strip() + '\n'
            '      </c:Children>\n    </o:Package>\n'
            '    ' + proc.strip() + '\n    ' + seq.strip() + '\n'
            '  </c:Children>\n')

xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
       '<o:Model xmlns:o="urn:schemas-microsoft-com:office:office" '
       'xmlns:a="urn:schemas-microsoft-com:office:access" '
       'xmlns:c="urn:schemas-microsoft-com:office:custom" Id="o1">\n'
       '  <a:Name>电商业务系统</a:Name>\n  <a:Code>SHOP</a:Code>\n'
       '  <a:Comment>电商业务系统物理数据模型（测试样例）</a:Comment>\n'
       '  <a:Author>测试</a:Author>\n'
       '  <c:DBMS><o:Shortcut Id="dbms1"><a:Name>MySQL 5.7</a:Name></o:Shortcut></c:DBMS>\n'
       + pkg_user + '</o:Model>\n')

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'test-model.pdm')
with open(out, 'w', encoding='utf-8') as f:
    f.write(xml)
print('OK ->', out, len(xml), 'bytes')
