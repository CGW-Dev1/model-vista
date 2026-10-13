# -*- coding: utf-8 -*-
"""生成 Shortcut 容器包裹的 PDM 测试文件（验证全树扫描兜底逻辑）"""
import os

xml = '''<?xml version="1.0" encoding="UTF-8"?>
<o:Model xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:a="urn:schemas-microsoft-com:office:access" xmlns:c="urn:schemas-microsoft-com:office:custom" Id="o1">
  <a:Name>快捷方式包裹模型</a:Name>
  <a:Code>SHORTCUT_MODEL</a:Code>
  <c:Children>
    <o:Shortcut Id="sc1">
      <a:Name>外部表引用</a:Name>
      <c:Children>
        <o:Table Id="st1">
          <a:Name>客户表</a:Name>
          <a:Code>CUST_INFO</a:Code>
          <a:Comment>客户基础信息</a:Comment>
          <c:Columns>
            <o:Column Id="scol1">
              <a:Name>客户ID</a:Name>
              <a:Code>CUST_ID</a:Code>
              <a:DataType>BIGINT</a:DataType>
              <a:Column.Mandatory>1</a:Column.Mandatory>
              <a:Sequence>1</a:Sequence>
            </o:Column>
            <o:Column Id="scol2">
              <a:Name>客户名称</a:Name>
              <a:Code>CUST_NAME</a:Code>
              <a:DataType>VARCHAR</a:DataType>
              <a:Length>128</a:Length>
              <a:Sequence>2</a:Sequence>
            </o:Column>
          </c:Columns>
          <c:Keys>
            <o:Key Id="skey1">
              <a:Name>Key1</a:Name>
              <c:Key.Columns><o:Column Ref="scol1"/></c:Key.Columns>
            </o:Key>
          </c:Keys>
          <c:PrimaryKey><o:Key Ref="skey1"/></c:PrimaryKey>
        </o:Table>
        <o:Table Id="st2">
          <a:Name>订单表</a:Name>
          <a:Code>CUST_ORDER</a:Code>
          <c:Columns>
            <o:Column Id="scol3">
              <a:Name>订单ID</a:Name>
              <a:Code>ORDER_ID</a:Code>
              <a:DataType>BIGINT</a:DataType>
              <a:Sequence>1</a:Sequence>
            </o:Column>
          </c:Columns>
          <c:Keys>
            <o:Key Id="skey2">
              <a:Name>Key2</a:Name>
              <c:Key.Columns><o:Column Ref="scol3"/></c:Key.Columns>
            </o:Key>
          </c:Keys>
          <c:PrimaryKey><o:Key Ref="skey2"/></c:PrimaryKey>
        </o:Table>
      </c:Children>
    </o:Shortcut>
  </c:Children>
</o:Model>
'''

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'test-model-shortcut.pdm')
with open(out, 'w', encoding='utf-8') as f:
    f.write(xml)
print('OK ->', out)
