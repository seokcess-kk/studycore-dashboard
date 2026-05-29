# -*- coding: utf-8 -*-
"""스터디코어 학습 리포트 OG 이미지(1200x630) 생성.
studycore.kr 본사 OG의 톤(딥네이비 + 틸 강조 + Noto Serif/Sans)을 맞춤.
설치된 브랜드 폰트(NotoSerifKR-VF / NotoSansKR-VF) 사용. 결과: web/og.png + 파비콘/아이콘.
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
FONTS = r"C:\Windows\Fonts"
SERIF = os.path.join(FONTS, "NotoSerifKR-VF.ttf")
SANS = os.path.join(FONTS, "NotoSansKR-VF.ttf")

W, H = 1200, 630
NAVY_TOP = (10, 32, 56)      # #0a2038
NAVY_BOT = (16, 50, 83)      # #103253
WHITE = (255, 255, 255)
TEAL = (110, 195, 200)       # 밝은 틸(가독성) — 본사 #57adb1 계열
TEAL_DIV = (87, 173, 177)    # #57adb1
MUTED = (147, 166, 187)      # 슬레이트 뮤트
FOOT = (111, 130, 152)


def font(path, size, weight=400):
    f = ImageFont.truetype(path, size)
    try:
        f.set_variation_by_axes([weight])
    except Exception:
        pass
    return f


def text_w(draw, s, f, track=0):
    w = draw.textlength(s, font=f)
    if track:
        w += track * max(0, len(s) - 1)
    return w


def draw_tracked(draw, x, y, s, f, fill, track=0):
    """글자 간격(track)을 줘서 본사 워드마크의 넉넉한 느낌 재현."""
    for ch in s:
        draw.text((x, y), ch, font=f, fill=fill)
        x += draw.textlength(ch, font=f) + track


def centered(draw, y, runs, track=0):
    """runs = [(text, font, fill), ...] 한 줄을 가로 중앙 정렬해 그림."""
    total = sum(text_w(draw, t, f, track) for t, f, _ in runs)
    x = (W - total) / 2
    for t, f, fill in runs:
        draw_tracked(draw, x, y, t, f, fill, track)
        x += text_w(draw, t, f, track)


def build_og():
    img = Image.new("RGB", (W, H), NAVY_TOP)
    d = ImageDraw.Draw(img)
    # 세로 그라데이션
    for yy in range(H):
        t = yy / (H - 1)
        c = tuple(int(NAVY_TOP[i] + (NAVY_BOT[i] - NAVY_TOP[i]) * t) for i in range(3))
        d.line([(0, yy), (W, yy)], fill=c)

    f_word = font(SERIF, 92, 600)        # STUDY CORE
    f_word_kr = font(SERIF, 92, 500)     # 리포트
    f_head = font(SANS, 40, 600)         # 자녀의 한 달 공부 기록
    f_sub = font(SANS, 24, 400)          # 부제
    f_pill = font(SANS, 23, 500)         # 기능 칩
    f_foot = font(SANS, 20, 400)         # 도메인

    # 워드마크 (트래킹) — "STUDY CORE" 흰색 + " 리포트" 틸
    track = 6
    w_word = text_w(d, "STUDY CORE", f_word, track)
    w_space = d.textlength("  ", font=f_word_kr)
    w_kr = text_w(d, "리포트", f_word_kr, track)
    total = w_word + w_space + w_kr
    x = (W - total) / 2
    y_word = 168
    draw_tracked(d, x, y_word, "STUDY CORE", f_word, WHITE, track)
    x += w_word + w_space
    draw_tracked(d, x, y_word, "리포트", f_word_kr, TEAL, track)

    # 틸 디바이더
    dv_w = 72
    d.line([((W - dv_w) / 2, 300), ((W + dv_w) / 2, 300)], fill=TEAL_DIV, width=3)

    # 헤드라인 / 부제 / 기능칩 / 도메인
    centered(d, 332, [("자녀의 한 달 공부 기록", f_head, WHITE)])
    centered(d, 398, [("월간 순공부시간 · 출결 · 반 평균 리포트", f_sub, MUTED)])
    centered(d, 452, [("순공부시간     ·     출결 달력     ·     반 평균 비교", f_pill, TEAL)])
    centered(d, 556, [("report.studycore.kr", f_foot, FOOT)])

    out = os.path.join(WEB, "og.png")
    img.save(out, "PNG")
    print("OG saved:", out, os.path.getsize(out), "bytes")


def build_icons():
    """다운로드한 브랜드 책 아이콘(_design/icon512.png)에서 파비콘/PWA 아이콘 생성."""
    src = os.path.join(ROOT, "_design", "icon512.png")
    if not os.path.exists(src):
        print("skip icons: _design/icon512.png 없음")
        return
    base = Image.open(src).convert("RGBA")
    base.resize((512, 512), Image.LANCZOS).save(os.path.join(WEB, "icon-512x512.png"))
    base.resize((192, 192), Image.LANCZOS).save(os.path.join(WEB, "icon-192x192.png"))
    base.resize((180, 180), Image.LANCZOS).save(os.path.join(WEB, "apple-touch-icon.png"))
    # 멀티사이즈 .ico (16/32/48 포함)
    base.save(os.path.join(WEB, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)])
    print("icons saved: icon-512/192, apple-touch-icon, favicon.ico")


if __name__ == "__main__":
    build_og()
    build_icons()
