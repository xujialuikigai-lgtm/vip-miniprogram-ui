from html import unescape
from html.parser import HTMLParser
from io import BytesIO
import os
import re
import textwrap
import urllib.request

from PIL import Image, ImageDraw, ImageFont


GOODS_INFO = '<p><img src="http://imgs.mxmm666.com/backend/1/0ba91202511231807283819.png" style="max-width:100%;"/></p>'
GOODS_NOTICE = '<p><b><font face="黑体" size="5"><font color="#000000">微信充值提供手机号 QQ充值直接填写QQ号 微信打开这个链接确认好手机号绑定关系 </font></b></p>'

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'data-export')
PNG_PATH = os.path.join(OUT_DIR, 'goods-richtext-preview.png')
HTML_PATH = os.path.join(OUT_DIR, 'goods-richtext-preview.html')


class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        if data.strip():
            self.parts.append(data.strip())

    def text(self):
        return unescape(' '.join(self.parts)).strip()


def extract_text(html):
    parser = TextExtractor()
    parser.feed(html or '')
    return re.sub(r'\s+', ' ', parser.text()).strip()


def extract_images(html):
    return re.findall(r'<img[^>]+src=["\']([^"\']+)["\']', html or '', flags=re.I)


def load_font(size, bold=False):
    candidates = [
        '/System/Library/Fonts/PingFang.ttc',
        '/System/Library/Fonts/STHeiti Light.ttc',
        '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size=size, index=0)
    return ImageFont.load_default()


def download_image(url):
    urls = [url]
    if url.startswith('http://'):
        urls.append('https://' + url[len('http://'):])

    last_error = None
    for item in urls:
        try:
            req = urllib.request.Request(
                item,
                headers={
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15',
                    'Referer': 'https://shop.mxmm666.com/',
                },
            )
            with urllib.request.urlopen(req, timeout=15) as res:
                data = res.read()
            return Image.open(BytesIO(data)).convert('RGB'), item, None
        except Exception as err:
            last_error = err
    return None, url, str(last_error)


def draw_wrapped(draw, text, xy, font, fill, width, line_gap=10):
    x, y = xy
    current = ''
    lines = []
    for char in text:
        trial = current + char
        bbox = draw.textbbox((0, 0), trial, font=font)
        if bbox[2] - bbox[0] > width and current:
            lines.append(current)
            current = char
        else:
            current = trial
    if current:
        lines.append(current)
    for line in lines:
        draw.text((x, y), line, font=font, fill=fill)
        y += font.size + line_gap
    return y


def rounded_rect(draw, xy, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def render_preview():
    os.makedirs(OUT_DIR, exist_ok=True)

    notice_text = extract_text(GOODS_NOTICE)
    image_urls = extract_images(GOODS_INFO)
    product_image = None
    used_url = ''
    image_error = ''
    if image_urls:
        product_image, used_url, image_error = download_image(image_urls[0])

    width = 750
    height = 1380
    bg = '#f5f7f8'
    image = Image.new('RGB', (width, height), bg)
    draw = ImageDraw.Draw(image)

    title_font = load_font(36, bold=True)
    section_font = load_font(30, bold=True)
    text_font = load_font(26)
    small_font = load_font(22)

    draw.text((width // 2, 54), '富文本前端预览', font=title_font, fill='#17202f', anchor='mm')

    y = 120
    margin = 24
    card_w = width - margin * 2

    draw.text((margin, y), '购买须知', font=section_font, fill='#17202f')
    y += 48
    notice_top = y
    notice_h = 170
    rounded_rect(draw, (margin, notice_top, margin + card_w, notice_top + notice_h), 16, '#fbfcfc')
    y = draw_wrapped(draw, notice_text, (margin + 24, notice_top + 30), text_font, '#555e6c', card_w - 48, 12)
    y = notice_top + notice_h + 42

    draw.text((margin, y), '商品信息', font=section_font, fill='#17202f')
    y += 48
    info_top = y
    info_h = 880
    rounded_rect(draw, (margin, info_top, margin + card_w, info_top + info_h), 16, '#fbfcfc')

    inner_x = margin + 24
    inner_y = info_top + 24
    inner_w = card_w - 48

    if product_image:
        product_image.thumbnail((inner_w, 720), Image.LANCZOS)
        x = inner_x + (inner_w - product_image.width) // 2
        image.paste(product_image, (x, inner_y))
        inner_y += product_image.height + 18
        draw_wrapped(draw, f'图片源：{used_url}', (inner_x, inner_y), small_font, '#8a919b', inner_w, 8)
    else:
        rounded_rect(draw, (inner_x, inner_y, inner_x + inner_w, inner_y + 260), 16, '#f0f3f5', '#d9e0e6', 2)
        draw.text((width // 2, inner_y + 104), '图片加载失败', font=section_font, fill='#8a919b', anchor='mm')
        draw_wrapped(draw, image_error or used_url or '没有图片地址', (inner_x + 24, inner_y + 150), small_font, '#8a919b', inner_w - 48, 8)

    draw_wrapped(
        draw,
        '当前小程序 detail.wxml 会把 goods_notice 和 goods_info 交给 rich-text 渲染；如果图片仍是 http 链接，微信环境可能拦截，需要转 HTTPS 或转存云存储。',
        (margin, 1270),
        small_font,
        '#8a919b',
        width - margin * 2,
        8,
    )

    image.save(PNG_PATH)

    html = f'''<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>goods_info / goods_notice 预览</title>
  <style>
    body {{ margin: 0; background: #f5f7f8; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; color: #17202f; }}
    .phone {{ width: 375px; min-height: 720px; margin: 24px auto; padding: 24px 12px; box-sizing: border-box; background: #f5f7f8; }}
    h1 {{ margin: 0 0 24px; text-align: center; font-size: 20px; }}
    h2 {{ margin: 20px 0 10px; font-size: 18px; }}
    .card {{ padding: 12px; border-radius: 8px; background: #fbfcfc; color: #555e6c; font-size: 14px; line-height: 1.6; word-break: break-word; }}
    .card img {{ max-width: 100%; height: auto; display: block; margin: 0 auto; }}
  </style>
</head>
<body>
  <main class="phone">
    <h1>富文本前端预览</h1>
    <h2>购买须知</h2>
    <section class="card">{GOODS_NOTICE}</section>
    <h2>商品信息</h2>
    <section class="card">{GOODS_INFO}</section>
  </main>
</body>
</html>
'''
    with open(HTML_PATH, 'w', encoding='utf-8') as file:
        file.write(html)

    print(PNG_PATH)
    print(HTML_PATH)


if __name__ == '__main__':
    render_preview()
