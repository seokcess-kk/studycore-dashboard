# 스터디코어1.0 학습 리포트

독서실 입·출 기록으로 학부모에게 자녀의 월간 **순공부시간·출결**을 공유하는 대시보드.
정적 프런트엔드 + **Supabase**(DB/인증). 배포: Vercel(`report.studycore.kr`).

## 구성
```
web/                 정적 앱 (빌드 불필요)
  index.html app.js styles.css     학부모 화면 (달력·일자상세·월간상세)
  admin.html admin.js admin.css     원장: 엑셀 업로드 + 자동퇴장 보정
  config.js                         Supabase URL/anon 키 (anon=공개용)
  scapi.js                          Supabase 액세스 래퍼
  aggregate.js                      집계(순공부·출결·반평균) 공용 모듈
  ingest.js                         엑셀 행 → 데이터 구조 빌드/병합
  dataset.js corrections.js         로컬 폴백·보정 유틸
  vendor/                           supabase-js, SheetJS (로컬 번들)
  data.js                           빈 플레이스홀더(운영 데이터는 Supabase)
supabase/schema.sql  테이블 + RLS + 학부모 조회 함수
scripts/             preprocess.py(레거시), *_test.js / *_smoke.js (검증)
DEPLOY.md            배포 가이드
```

## 동작
- **학부모**: 이름 + 전화 뒷4자리 로그인 → `rpt_get_report` RPC로 **본인 데이터만** 조회.
- **원장**: Supabase 로그인 → 월별 엑셀 업로드(브라우저 SheetJS 파싱) → Supabase 저장. 자동퇴장(퇴실 미체크)은 입·외출 로그로 보정.
- 보안: RLS로 직접 조회 차단, 학부모는 RPC로 1명만. anon 키만 사용(service_role 미사용).

## 개인정보
실제 학생 데이터(`inout_raw.xlsx`, `studycore-dataset.json`, 채워진 `web/data.js`)는 **레포·정적배포에 두지 않습니다**(`.gitignore`). 운영 데이터는 Supabase에만 저장합니다.

## 로컬 실행
```
cd web && python -m http.server 8787   # http://localhost:8787
```
`config.js` 의 url/anonKey 를 비우면 로컬(localStorage) 모드로 동작합니다.

## 배포
`DEPLOY.md` 참고 — Supabase 스키마 실행 → Vercel 배포 → 가비아 DNS(CNAME) → /admin 업로드.

## 테스트
```
node scripts/ingest_test.js     # 빌드·병합·잠정·클램프·동명이인
node scripts/smoke_test.js      # 학부모 렌더(로컬)
node scripts/upload_smoke.js    # 업로드·전월대비
node scripts/admin_smoke.js     # 보정 목록·계산·저장
node scripts/remote_smoke.js    # 서버(Supabase) 모드 모킹
```
