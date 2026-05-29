# report.studycore.co.kr 배포 가이드

학부모용 학습 리포트를 **Vercel(정적 배포) + 기존 Supabase**로 올리는 절차입니다.
도메인은 가비아, 사이트는 Vercel 구성 기준. (별도 서버/PHP 불필요, SSL은 Vercel 자동)

---

## 1단계. Supabase 준비 (1회)

1. Supabase 대시보드 → **SQL Editor** → `supabase/schema.sql` 내용 붙여넣기
   - 실행 전, 파일 안의 `admin@studycore.co.kr` 을 **원장님 이메일**로 바꾸세요.
   - 실행하면 `rpt_*` 테이블 + 보안정책(RLS) + 학부모 조회 함수가 생성됩니다.
2. Supabase → **Authentication → Users → Add user** 로 위 이메일 + 비밀번호 계정 생성
   (이메일 인증을 끄거나, "Auto Confirm" 으로 바로 활성화)
3. `web/config.js` 에 URL·anon 키가 이미 들어 있는지 확인 (들어 있음).
   - anon 키는 공개용이라 배포돼도 안전합니다. **service_role(secret) 키는 절대 넣지 마세요.**

> 보안: 테이블은 RLS로 막혀 있어 anon 키로는 직접 조회가 안 되고, 학부모는 `rpt_get_report`
> 함수로 **본인 1명** 데이터만 받습니다. 업로드/보정은 관리자 로그인(화이트리스트)에서만 됩니다.

---

## 2단계. Vercel 배포 + 가비아 DNS (도메인=가비아 / 사이트=Vercel)

정적 사이트라 **Vercel에 올리고, 가비아에는 DNS 레코드만** 추가하면 됩니다.
**FTP·SSL 신청 불필요** — Vercel이 HTTPS 인증서를 자동 발급합니다.

### (1) report 앱을 Vercel에 배포 — 기존 사이트와 별개 프로젝트 권장
배포 대상은 **`web/` 폴더(정적)**. 빌드 단계 없음. 둘 중 편한 방법:

- **CLI**: `web/` 폴더에서
  ```
  npm i -g vercel
  cd web
  vercel        # 최초 1회: 새 프로젝트로 생성
  vercel --prod # 운영 배포
  ```
- **Git 연동**: `web/` 를 깃 저장소에 올리고 Vercel에서 Import → Framework: "Other(정적)", Root Directory: `web` (또는 web만 올렸으면 그대로) → Deploy.

> 업로드 제외: `inout_raw.xlsx`, `scripts/`, `supabase/`, `*.md` (개발/원본용)
> 깔끔한 주소: `web/vercel.json` 의 `cleanUrls`로 `/admin`(=admin.html), `/`(=index.html) 로 열립니다.
> → 원장 페이지 주소는 **`report.studycore.co.kr/admin`** (`.html` 없이).

### (2) Vercel에 서브도메인 연결
- Vercel → 그 프로젝트 → **Settings → Domains → Add** → `report.studycore.co.kr` 입력
- Vercel이 추가할 **DNS 레코드**를 안내합니다(보통 **CNAME → `cname.vercel-dns.com`**).

### (3) 가비아에 DNS 레코드 추가 — 네임서버 위치에 따라 둘 중 하나
studycore.co.kr 의 **네임서버가 어디냐**에 따라 다릅니다:
- **네임서버가 가비아**(일반적): **My가비아 → 도메인 → DNS 관리(레코드 수정)** 에서
  - 타입 `CNAME`, 호스트 `report`, 값 `cname.vercel-dns.com` (Vercel이 알려준 값) 추가
- **네임서버를 Vercel로 옮긴 경우**: 가비아에서 할 게 없고, Vercel "Add Domain" 시 자동 처리됨

DNS 전파 후 Vercel이 자동으로 `https://report.studycore.co.kr` 인증서를 발급합니다(수 분~수십 분).

---

## 3단계. 초기 데이터 올리기

1. `https://report.studycore.co.kr/admin.html` 접속 → **원장 이메일/비밀번호로 로그인**
2. 월별 엑셀을 업로드(파일 선택 → 미리보기 → 반영). 여러 달 올리면 누적되어 전월 대비가 켜집니다.
3. 자동퇴장 보정이 필요하면 보정 목록에서 처리 → 서버에 저장됩니다.

## 4단계. 학부모 안내

- 주소: `https://report.studycore.co.kr`
- 로그인: **학생 이름 + 전화번호 뒷 4자리**
- 본인 자녀 데이터만 보입니다.

---

## 동작 방식 요약

| 구분 | 내용 |
|---|---|
| 학부모 | `index.html` → 로그인 시 `rpt_get_report(이름,전화뒷4)` 호출 → 본인 데이터만 |
| 원장 | `admin.html` → Supabase 로그인 → 엑셀 업로드/보정 → `rpt_*` 테이블 저장 |
| 데이터 | Supabase Postgres (`rpt_meta`, `rpt_students`, `rpt_corrections`) |
| 파싱 | 브라우저(SheetJS) — 엑셀은 서버로 안 가고, 가공된 결과만 저장 |

## 로컬 테스트 (선택)
`web/config.js` 의 `url`/`anonKey` 를 빈 문자열로 두면 **로컬 모드**(localStorage)로 동작해
인터넷/Supabase 없이도 데모를 볼 수 있습니다. 운영 배포 시에는 키가 채워져 있어야 합니다.

## 보안 보완(추후 권장)
- 이름+전화뒷4는 약한 인증입니다. 필요 시 **학생별 접근코드**나 **호출 횟수 제한**을 추가하세요.
- 학부모에게 데이터 제공·보관 **안내(동의)** 문구를 한 줄 두는 것을 권합니다.
