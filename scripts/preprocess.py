# -*- coding: utf-8 -*-
"""
inout_raw.xlsx -> web/data.js (window.STUDYCORE_DATA)

독서실 입·퇴장 원본을 읽어 학생별/일별/월별 집계 및 반 평균(익명)을 계산하고,
브라우저에서 바로 쓸 수 있는 JS 데이터 파일로 출력한다.

- 한 달치(현재 2026-04)만 있어도 동작. 여러 달이 들어오면 자동으로 월별 분리.
- 전화번호는 원본에 없으므로 이름 기반 결정적(deterministic) 데모 뒷4자리를 생성.
  (실제 운영 시 별도 명부로 교체)
"""
import io
import json
import os
import sys
import zlib
import datetime
from collections import defaultdict

import openpyxl

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "inout_raw.xlsx")
OUT = os.path.join(ROOT, "web", "data.js")

REASON_NO_CHECKOUT = {"자동퇴장", "미복귀"}


def to_sec(t):
    """'HH:MM:SS' -> 초. '-'/None -> None"""
    if t in (None, "-", ""):
        return None
    try:
        h, m, s = str(t).split(":")
        return int(h) * 3600 + int(m) * 60 + int(s)
    except Exception:
        return None


def to_int(v):
    if v in (None, "-", ""):
        return 0
    try:
        return int(v)
    except Exception:
        return 0


def time_sort_key(hms):
    """하루 안 세션 정렬용. 새벽(<5시) 입장은 자정 넘긴 것으로 보고 뒤로."""
    sec = to_sec(hms)
    if sec is None:
        return 10 ** 9
    if sec < 5 * 3600:
        sec += 24 * 3600
    return sec


def sec_diff(in_t, out_t):
    """퇴장 - 입장 (초). 새벽 퇴장은 자정 넘김 보정. 못 구하면 None"""
    a, b = to_sec(in_t), to_sec(out_t)
    if a is None or b is None:
        return None
    if b < a:
        b += 24 * 3600
    return b - a


def fake_last4(key, used):
    """key(이름 또는 이름#좌석) 기반 결정적 4자리. 충돌 시 1씩 증가."""
    base = zlib.crc32(key.encode("utf-8")) % 10000
    n = base
    for _ in range(10000):
        cand = f"{n:04d}"
        if cand not in used:
            used.add(cand)
            return cand
        n = (n + 1) % 10000
    return f"{base:04d}"


def load_rows():
    wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
    ws = wb["Sheet1"]
    rows = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        if r[0] in (None, ""):
            continue
        rows.append(
            {
                "name": str(r[0]).strip(),
                "seat": r[1],
                "cls": r[2],
                "date": str(r[3]),
                "in": r[4],
                "out": r[5],
                "total": to_sec(r[6]),
                "net": to_sec(r[7]),
                "outings": to_int(r[8]),
                "excluded": to_sec(r[9]),
                "reason": r[10],
            }
        )
    return rows


def month_of(date_str):
    return date_str[:7]  # YYYY-MM


def is_weekend(date_str):
    d = datetime.date.fromisoformat(date_str)
    return d.weekday() >= 5


def build():
    rows = load_rows()

    # 월별 개원일(운영일) = 데이터에 존재한 날짜
    open_days = defaultdict(set)
    for r in rows:
        open_days[month_of(r["date"])].add(r["date"])

    # 동월 동명이인 판별: (월,이름)별 좌석이 2개 이상이면 이름#좌석으로 분리
    seats_per_nm = defaultdict(set)
    for r in rows:
        if r["seat"] not in (None, "-"):
            seats_per_nm[(month_of(r["date"]), r["name"])].add(r["seat"])

    def is_ambiguous(date, name):
        return len(seats_per_nm.get((month_of(date), name), ())) > 1

    def key_of(r):
        if is_ambiguous(r["date"], r["name"]):
            seat = r["seat"] if r["seat"] not in (None, "-") else "?"
            return f'{r["name"]}#{seat}'
        return r["name"]

    # (key, 월, 날짜) -> 세션 목록
    by_student = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    name_of = {}
    seat_of = {}
    cls_of = {}
    for r in rows:
        m = month_of(r["date"])
        key = key_of(r)
        by_student[key][m][r["date"]].append(r)
        name_of[key] = r["name"]
        if r["seat"] not in (None, "-"):
            seat_of[key] = r["seat"]
        cls_of.setdefault((key, m), r["cls"])

    used_last4 = set()
    students = []
    # 반 평균 집계용: month -> metric -> list
    class_acc = defaultdict(lambda: defaultdict(list))

    for key in sorted(by_student.keys()):
        months_out = {}
        for m, days in by_student[key].items():
            day_out = {}
            wd_list, we_list = [], []
            attendance_days = 0
            recognized_days = 0
            no_checkout_days = 0
            total_net = 0
            max_day = {"date": None, "netSec": -1}

            for date in sorted(days.keys()):
                sess_rows = sorted(days[date], key=lambda x: time_sort_key(x["in"]))

                # 1) 원시 세션 (정상은 클램프, 자동퇴장은 잠정 표시 — 시간은 병합 후 산정)
                base = []
                for sr in sess_rows:
                    provisional = sr["net"] is None
                    if provisional:
                        netv = totv = excv = outv = 0
                    else:
                        netv = sr["net"] or 0
                        totv = sr["total"] or 0
                        excv = sr["excluded"] or 0
                        outv = sr["outings"]
                        if netv > totv:  # 손상 행(순공부>체류) 클램프
                            netv = totv
                            excv = 0
                    base.append({
                        "in": sr["in"] if sr["in"] not in (None, "-") else None,
                        "out": sr["out"] if sr["out"] not in (None, "-") else None,
                        "totalSec": totv, "netSec": netv, "excludedSec": excv,
                        "outings": outv, "reason": sr["reason"], "provisional": provisional,
                        "seat": sr["seat"] if sr["seat"] not in (None, "-") else None,
                    })

                # 2) 강제퇴장(00:55) 분할 병합: 첫 자동퇴장 입장 ~ 그날 최종 퇴장을 한 체류로
                fi = next((i for i, s in enumerate(base) if s["provisional"]), -1)
                if fi >= 0:
                    in_t = base[fi]["in"]
                    last_out_t, last_key = None, -1
                    for s in base[fi:]:
                        if s["out"]:
                            k = time_sort_key(s["out"])
                            if k > last_key:
                                last_key, last_out_t = k, s["out"]
                    span = sec_diff(in_t, last_out_t) or 0  # 체류 = 입장~최종퇴장
                    merged = {
                        "in": in_t, "out": last_out_t, "totalSec": span, "netSec": span,
                        "excludedSec": 0, "outings": 0, "reason": base[fi]["reason"],
                        "provisional": True, "seat": base[fi]["seat"],
                    }
                    sessions = base[:fi] + [merged]
                else:
                    sessions = base

                # 3) 일자 집계
                day_net = day_total = day_excluded = day_outings = 0
                good_net = good_total = good_excluded = good_outings = 0
                no_checkout = False
                for s in sessions:
                    day_net += s["netSec"]
                    day_total += s["totalSec"]
                    day_excluded += s["excludedSec"]
                    day_outings += s["outings"]
                    if s["provisional"]:
                        no_checkout = True
                    else:
                        good_net += s["netSec"]
                        good_total += s["totalSec"]
                        good_excluded += s["excludedSec"]
                        good_outings += s["outings"]

                first_in = next((s["in"] for s in sessions if s["in"]), None)
                last_out = next((s["out"] for s in reversed(sessions) if s["out"]), None)

                day_out[date] = {
                    "netSec": day_net,
                    "totalSec": day_total,
                    "excludedSec": day_excluded,
                    "outings": day_outings,
                    "goodNetSec": good_net,
                    "goodTotalSec": good_total,
                    "goodExcludedSec": good_excluded,
                    "goodOutings": good_outings,
                    "firstIn": first_in,
                    "lastOut": last_out,
                    "attended": True,
                    "noCheckout": no_checkout,
                    "sessions": sessions,
                }

                attendance_days += 1
                total_net += day_net
                if no_checkout and day_net == 0:
                    no_checkout_days += 1
                if day_net > 0:
                    recognized_days += 1
                    if is_weekend(date):
                        we_list.append(day_net)
                    else:
                        wd_list.append(day_net)
                if day_net > max_day["netSec"]:
                    max_day = {"date": date, "netSec": day_net}

            daily_avg = round(total_net / recognized_days) if recognized_days else 0
            wd_avg = round(sum(wd_list) / len(wd_list)) if wd_list else 0
            we_avg = round(sum(we_list) / len(we_list)) if we_list else 0

            months_out[m] = {
                "totalNetSec": total_net,
                "attendanceDays": attendance_days,
                "recognizedDays": recognized_days,
                "noCheckoutDays": no_checkout_days,
                "openDays": len(open_days[m]),
                "dailyAvgSec": daily_avg,
                "weekdayAvgSec": wd_avg,
                "weekendAvgSec": we_avg,
                "maxDay": max_day if max_day["date"] else None,
                "className": cls_of.get((key, m), ""),
                "days": day_out,
            }

            # 반 평균 누적 (공부 인정일이 있는 학생만 — 의미있는 평균을 위해)
            if recognized_days:
                class_acc[m]["totalNetSec"].append(total_net)
                class_acc[m]["attendanceDays"].append(attendance_days)
                class_acc[m]["dailyAvgSec"].append(daily_avg)
                if wd_avg:
                    class_acc[m]["weekdayAvgSec"].append(wd_avg)
                if we_avg:
                    class_acc[m]["weekendAvgSec"].append(we_avg)

        students.append(
            {
                "key": key,
                "name": name_of[key],
                "phoneLast4": fake_last4(key, used_last4),
                "seat": seat_of.get(key),
                "months": months_out,
            }
        )

    # 반 평균(익명) 계산
    class_averages = {}
    for m, acc in class_acc.items():
        n = len(acc["totalNetSec"])
        class_averages[m] = {
            "studentCount": n,
            "totalNetSec": round(sum(acc["totalNetSec"]) / n) if n else 0,
            "attendanceDays": round(sum(acc["attendanceDays"]) / n, 1) if n else 0,
            "dailyAvgSec": round(sum(acc["dailyAvgSec"]) / n) if n else 0,
            "weekdayAvgSec": round(sum(acc["weekdayAvgSec"]) / len(acc["weekdayAvgSec"]))
            if acc["weekdayAvgSec"] else 0,
            "weekendAvgSec": round(sum(acc["weekendAvgSec"]) / len(acc["weekendAvgSec"]))
            if acc["weekendAvgSec"] else 0,
        }

    all_months = sorted(open_days.keys())
    data = {
        "generatedFrom": "inout_raw.xlsx",
        "months": all_months,
        "openDays": {m: sorted(open_days[m]) for m in all_months},
        "classAverages": class_averages,
        "students": students,
    }
    return data


def main():
    data = build()
    os.makedirs(os.path.join(ROOT, "web"), exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// 자동 생성됨 (scripts/preprocess.py). 직접 수정 금지.\n")
        f.write("window.STUDYCORE_DATA = ")
        f.write(payload)
        f.write(";\n")

    # 콘솔 요약 + 데모 계정 일부 출력
    print(f"[OK] {OUT}")
    print(f"  months: {data['months']}")
    print(f"  students: {len(data['students'])}")
    for m, ca in data["classAverages"].items():
        print(f"  반평균[{m}]: 학생 {ca['studentCount']}명, "
              f"총 {ca['totalNetSec']//3600}시간, 일평균 {ca['dailyAvgSec']//60}분")
    print("  데모 로그인 예시 (이름 / 전화뒷4):")
    for s in data["students"][:8]:
        print(f"    {s['name']} / {s['phoneLast4']}")


if __name__ == "__main__":
    main()
