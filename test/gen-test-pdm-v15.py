# -*- coding: utf-8 -*-
"""从真实 PD15 旧格式 PDM 文件提取片段，构造小型保真测试样例 test-model-v15.pdm"""
import os

SRC = r'F:\终端直销PDM\新接口.pdm'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'test-model-v15.pdm')

text = open(SRC, 'rb').read().decode('utf-8', errors='ignore')

# 1. 头部：<?xml ... <o:Model Id="o2"> 元数据 ... </c:DBMS>
dbms_tag = text.find('</c:DBMS>')
assert dbms_tag > 0, '未找到 c:DBMS'
head = text[:dbms_tag + len('</c:DBMS>')]

# 2. 第一个完整 Table 块
t0 = text.find('<o:Table Id=', dbms_tag)
t1 = text.find('</o:Table>', t0) + len('</o:Table>')
table_block = text[t0:t1]

# 3. 最小的完整 View 块
view_block = None
best = None
pos = dbms_tag
while True:
    v0 = text.find('<o:View Id=', pos)
    if v0 < 0:
        break
    v1 = text.find('</o:View>', v0)
    if v1 < 0:
        break
    v1 += len('</o:View>')
    if best is None or (v1 - v0) < best[0]:
        best = (v1 - v0, text[v0:v1])
    pos = v1
view_block = best[1]

# 4. 第一个完整 Reference 块
r0 = text.find('<o:Reference Id=', dbms_tag)
r1 = text.find('</o:Reference>', r0) + len('</o:Reference>')
ref_block = text[r0:r1]

xml = (head
       + '\n<c:Tables>\n' + table_block + '\n</c:Tables>\n'
       + '<c:Views>\n' + view_block + '\n</c:Views>\n'
       + '<c:References>\n' + ref_block + '\n</c:References>\n'
       + '</o:Model>\n</c:Children>\n</o:RootObject>\n</Model>\n')

with open(OUT, 'w', encoding='utf-8') as f:
    f.write(xml)
print('OK ->', OUT, f'{len(xml):,} bytes')
