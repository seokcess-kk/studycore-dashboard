# 화면 전환 속도 개선 — 설계

작성일: 2026-06-08

## 목적

관리자 ↔ 리포트 화면 전환(전체 페이지 리로드) 시의 체감 로딩 지연을 줄인다. 진단된 병목을 작은 변경으로 제거하고, 관리자 데이터 재로딩을 캐시로 즉시화한다.

## 진단 (병목)

모든 화면 전환은 `location.href`에 의한 **전체 페이지 리로드**이고, 페이지마다 다음이 반복된다:

1. **`currentUser()`가 `auth.getUser()` 사용** (`web/scapi.js:37-40`) — `getUser()`는 매 호출마다 Supabase 서버에 **토큰 검증 네트워크 왕복**을 한다. admin 인증 게이트(`web/admin.js`)와 리포트 화면 `checkAdminSession()`(`web/app.js`) 양쪽에서 발생. 이것이 가장 큰 지연 요인으로 추정된다.
2. **`loadAll()`의 3개 쿼리 순차 await** (`web/scapi.js:43-49`) — `rpt_meta` → `rpt_students`(전체) → `rpt_corrections`(전체)를 하나씩 기다린다.
3. 전환마다 vendor 스크립트 재파싱 + 외부 폰트 로드(이미 `preconnect`/`display=swap` 적용).

## 개선 항목

### 1. 세션 확인을 `getSession`으로 (네트워크 왕복 제거) — 핵심

- `web/scapi.js`의 `currentUser()`를 `auth.getUser()` → `auth.getSession()`으로 변경한다. `getSession()`은 로컬 저장 토큰을 즉시 반환(네트워크 0)한다.
  ```js
  async function currentUser() {
    var r = await client().auth.getSession();
    return (r.data && r.data.session && r.data.session.user) || null;
  }
  ```
- 영향: admin 인증 게이트와 `checkAdminSession()`이 즉시 응답.
- 보안: 이 호출은 **UI 게이트 결정용**일 뿐이고 실제 데이터 접근은 RLS가 보호한다. 만료 토큰은 `autoRefreshToken`(이미 설정됨, `scapi.js:17`)으로 갱신되며, 토큰이 무효하면 후속 `loadAll`이 실패해 기존 `catch` 경로가 로그인 게이트로 폴백한다. 동작·보안 후퇴 없음.

### 2. `loadAll` 병렬화

- 현재 순차 await 3개를 `Promise.all`로 병렬화한다.
  ```js
  var results = await Promise.all([
    client().from("rpt_meta").select("*").eq("id", 1).maybeSingle(),
    client().from("rpt_students").select("*"),
    client().from("rpt_corrections").select("*"),
  ]);
  var metaR = results[0], stuR = results[1], corrR = results[2];
  if (metaR.error) throw metaR.error;
  if (stuR.error) throw stuR.error;
  if (corrR.error) throw corrR.error;
  // 이하 매핑은 동일
  ```
- 결과·반환 형태는 기존과 동일. 약 1/3 시간.

### 3. admin 데이터 캐싱 (stale-while-revalidate)

- **캐시 모듈** `web/datacache.js` 신설(기존 `preview.js` 패턴: IIFE + `window.SCCache` + `module.exports`). `sessionStorage` 키 `studycore_admin_dataset`에 `loadAll` 결과(`{ dataset, corrections }`)를 저장.
  - `get()`: 파싱 실패/없음 → `null`.
  - `set(data)`: 직렬화 후 저장. 용량 초과 등 예외 시 `false` 반환(안전 폴백 — 캐시 없이 동작).
  - `clear()`: 키 제거.
- **admin 진입(`afterLogin`) 흐름**:
  1. `SCCache.get()`이 캐시를 반환하면 → 그 데이터로 **즉시** 관리 화면을 렌더(체감 0 지연).
  2. 동시에 백그라운드로 `loadAll()`을 재fetch → 완료되면 데이터를 교체하고 **목록만 다시 그린다**(이벤트 재바인딩 없이). 그리고 `SCCache.set()`으로 캐시 갱신.
  3. 캐시가 없으면 기존대로 `loadAll()` 후 첫 렌더(이때도 `SCCache.set()`).
- **재렌더 분리**: `startApp()`은 1회만 호출(이벤트 바인딩 포함). 백그라운드 갱신 후에는 데이터 의존 렌더(`initMonthFilter` 멱등화 + `renderList` + `renderReportResults` + `renderLoadedInfo`)만 재실행해 **리스너·옵션 중복을 방지**한다.
- **무효화**: 저장 성공 시 캐시를 비운다(다음 진입이 최신을 받도록).
  - 엑셀/명부 반영(`saveDataset` 성공) → `reload` **직전** `SCCache.clear()`.
  - 보정 저장/삭제(`saveCorrection`/`removeCorrection`), 반평균 저장(`saveClassAverages`) 성공 직후 `SCCache.clear()`.

### 4. 폰트/스크립트 로딩 — 이번 범위에서 제외

- 측정 없이 효과가 불확실하고 이미 기본 최적화가 적용돼 있어 제외한다. 필요 시 실제 측정 후 별도로 다룬다.

## 데이터 흐름 (캐싱)

```
admin.html 부팅
  └ afterLogin()
      ├ SCCache.get() 있음? ──예──▶ 즉시 렌더(startApp) ──┐
      │                                                   ├─ 백그라운드 loadAll() ─▶ 데이터 교체 + 목록 재렌더 + SCCache.set()
      └ 없음 ──▶ loadAll() ─▶ 첫 렌더(startApp) + SCCache.set()

저장(업로드/명부/보정/반평균) 성공 ─▶ SCCache.clear()  (업로드·명부는 그 뒤 reload)
```

## 에러 처리·엣지 케이스

- **백그라운드 `loadAll` 실패**: catch에서 무시 — 이미 캐시로 렌더된 화면을 유지(체감 무중단). 다음 진입에서 재시도.
- **캐시 용량 초과**: `set()`이 `false` → 캐시 없이 동작(매번 네트워크). 기능 정상.
- **저장 직후 stale 캐시**: 저장 성공 시 `clear()` → reload/다음 진입이 최신 fetch.
- **`getSession` 만료 세션**: 후속 `loadAll` 실패 → 기존 로그인 게이트 폴백.
- **다른 기기에서 데이터 변경**: 캐시는 즉시 표시용이고 백그라운드 갱신이 곧 덮어쓰므로 stale 노출은 수백 ms 수준.

## 변경 파일 요약

| 파일 | 변경 |
| --- | --- |
| `web/scapi.js` | `currentUser` → `getSession`; `loadAll` 병렬화 |
| `web/datacache.js` | (신규) `SCCache` 캐시 모듈(get/set/clear) |
| `web/admin.html` | `datacache.js` script 로드 |
| `web/admin.js` | `afterLogin` 캐시 우선 렌더 + 백그라운드 갱신; 재렌더 분리(`initMonthFilter` 멱등화); 저장 시 `SCCache.clear()` |
| `scripts/datacache_smoke.js` | (신규) 캐시 모듈 단위 테스트 |

## 테스트

- **`datacache.js` 단위 테스트**(`scripts/datacache_smoke.js`, `preview_smoke` 패턴): `set`→`get` 라운드트립, `clear` 후 `null`, 직렬화 실패/용량 초과 시 `set` `false`·`get` `null` 안전 폴백.
- **`loadAll` 병렬화/`getSession` 전환**: `scapi.js`는 Supabase client 의존이라 `remote_smoke`가 `SCApi`를 통째로 모킹한다 → 내부 변경은 스모크에 직접 안 잡힌다. 동작 동일성은 코드 리뷰 + 수동 확인으로 검증.
- **admin 캐싱 흐름**: 가능하면 `remote_smoke`의 admin 테스트에 `SCCache` 모킹을 더해 "캐시 있으면 즉시 렌더 + `loadAll` 백그라운드 1회 호출"을 검증. 어려우면 수동 확인.

## 범위 밖 (YAGNI)

- 폰트/스크립트 로딩 최적화(별도).
- SPA 전환(full reload 제거) — 큰 리팩토링이라 별도.
- 학부모(`getReport`) 응답 캐싱 — 학부모는 전환이 적고 미리보기 버퍼로 이미 즉시 렌더되므로 제외.
