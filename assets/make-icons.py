# -*- coding: utf-8 -*-
"""将生成的 logo PNG 转换为应用所需图标资源：
1. resources/icon.png  - 512x512，圆角外透明
2. resources/icon.ico  - 多尺寸 256/128/64/48/32/16
"""
import os
from PIL import Image, ImageDraw

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   'Modern_flat_app_icon_design_fo_2026-09-01T04-49-22.png')
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'resources')
os.makedirs(OUT_DIR, exist_ok=True)

img = Image.open(SRC).convert('RGBA')
print('原图尺寸:', img.size)

# 将四角白色背景泛洪为透明（保留图标内部白色元素）
TRANSPARENT = (0, 0, 0, 0)
w, h = img.size
for corner in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 2), (w // 2, h - 3)]:
    try:
        ImageDraw.floodfill(img, corner, TRANSPARENT, thresh=38)
    except Exception as e:
        print('floodfill 跳过', corner, e)

# 512 PNG
png512 = img.resize((512, 512), Image.LANCZOS)
png_path = os.path.join(OUT_DIR, 'icon.png')
png512.save(png_path, 'PNG')
print('OK ->', png_path)

# 多尺寸 ICO
ico_path = os.path.join(OUT_DIR, 'icon.ico')
img.resize((256, 256), Image.LANCZOS).save(
    ico_path, format='ICO',
    sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
print('OK ->', ico_path, os.path.getsize(ico_path), 'bytes')
