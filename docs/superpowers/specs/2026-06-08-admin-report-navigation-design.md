# 관리자 ↔ 리포트 같은 탭 왕복 내비게이션 — 설계

작성일: 2026-06-08

## 목적

관리자(원장)와 학부모용 리포트 화면 사이를 **같은 탭에서 매끄럽게 왕복**할 수 있게 한다.

- **관리자 → 리포트**: admin에서 학생을 검색해 리포트로 갈 때, 새 탭이 아니라 같은 탭에서 화면을 전환한다.
- **리포트 → 관리자**: 리포트 화면에 관리자 컨텍스트 바를 두고, 관리자 세션이 감지되면 `[관리자 화면으로]` 버튼으로 admin으로 돌아간다.

```
admin 학생 검색 ──(같은 탭)──▶ 학생 리포트(미리보기)
       ▲                              │
       └────(관리자 바 버튼, 같은 탭)──┘
```

## 배경 (현재 구조)

- 직전 기능(2026-06-08-admin-student-report-search-design.md)으로 admin에 학생 리포트 검색·미리보기가 추가됐다. 현재 동작:
  - `web/admin.js` `openReport(student)`: `SCPreview.buildPreviewPayload` → `SCPreview.writeBuffer`(localStorage 1회용 버퍼) → `window.open("index.html", "_blank")`(**새 탭**) + 팝업 차단 시 alert.
  - 검색 결과 버튼 라벨: "리포트 ↗".
  - `web/app.js` 부팅 시 `SCPreview.takePreview()`로 버퍼를 sessionStorage로 옮기고 `enterPreview`로 렌더. 미리보기 배너 `#preview-banner`(`showPreviewBanner`) 표시, `body.preview-mode`로 로그아웃 버튼 숨김.
- 관리자 세션은 `SCApi.currentUser()`(Supabase auth, REMOTE 모드)로 감지할 수 있다. 로컬 모드는 `SCApi.enabled()`가 false라 관리자 세션 개념이 없다.
- 리포트 화면에서 admin으로 가는 동선은 현재 로그인 화면(`view-login`)의 "관리자 로그인" 링크뿐이고, 리포트를 보는 중(달력·월간 상세)에는 없다.

## A. 관리자 → 리포트: 같은 탭 전환

### 변경 — `web/admin.js` `openReport`
- `window.open("index.html", "_blank")` 를 **같은 탭 이동**으로 변경: `window.location.href = "index.html";`
- localStorage 버퍼 핸드오프(`writeBuffer`)는 **그대로 유지**한다. 페이지가 이동하므로 메모리가 사라지고, `app.js`가 부팅 시 버퍼를 읽어 렌더하는 흐름은 동일하게 작동한다.
- 같은 탭 이동은 팝업 차단 대상이 아니므로 **팝업 차단 안내 alert를 제거**한다. `writeBuffer` 실패(저장 불가) 시의 alert는 유지한다.

### 변경 — 검색 결과 버튼 라벨
- 새 탭을 의미하는 "리포트 ↗" 를 "**리포트 보기**" 로 정리한다(`web/admin.js`의 `renderReportResults` 안 버튼 생성 부분).

## B. 리포트 → 관리자: 관리자 컨텍스트 바

### 요소 정리 — `web/index.html`
- 기존 `#preview-banner`(class `preview-banner`)를 의미에 맞게 **`#admin-bar`(class `admin-bar`)** 로 개명한다. 미리보기 전용이 아니라 관리자 컨텍스트 전반을 담는 바가 되기 때문이다.

### 일반화 — `web/app.js`
- `showPreviewBanner(student)` 를 `renderAdminBar(opts)` 로 일반화한다.
  - `opts.preview === true`: `pv-tag` "관리자 미리보기" + `pv-txt` "OOO 학생 · 학부모에게 보이는 화면입니다." (이름은 `textContent`로 삽입 — 기존 하드닝 유지)
  - 그 외(일반 + 관리자 세션): `pv-tag` "관리자" + `pv-txt` "관리자로 로그인된 상태입니다."
  - 두 경우 모두 끝에 `[관리자 화면으로]` 버튼(`type=button`)을 추가하고, 클릭 시 `window.location.href = "admin.html";`(같은 탭).
  - 바를 보이게 한다(`hidden = false`).
- `enterPreview(p)`는 `renderAdminBar({ preview: true, student: p.student })`를 호출하고, 기존대로 `body.preview-mode`를 추가한다(로그아웃 숨김).
- 부팅 시 일반 리포트 경로에서 관리자 세션을 확인하는 `checkAdminSession()`을 추가한다:
  - REMOTE 모드이고 `SCApi.currentUser`가 있을 때만 동작.
  - `SCApi.currentUser()`(비동기)가 사용자(관리자)를 반환하면 `renderAdminBar({ preview: false })` 호출. 이때 `body.preview-mode`는 **추가하지 않는다**(아래 로그아웃 구분 참조).
  - 실패/없음이면 아무것도 하지 않는다(바 숨김 유지).
- `init()`의 부팅 분기에서, 미리보기가 아니면(`else` 경로) `restoreSession()` 뒤에 `checkAdminSession()`을 호출한다.

### 핵심 구분 — 로그아웃 버튼
- **미리보기 모드**(`body.preview-mode`): 기존대로 `#btn-logout` 숨김.
- **일반 리포트 + 관리자 세션**: 학부모 본인 세션일 수 있으므로 로그아웃 버튼은 **그대로 유지**한다. 관리자 바만 추가로 노출하고 `body.preview-mode`는 붙이지 않는다.

### 스타일 — `web/styles.css`
- 클래스명 `.preview-banner` 를 `.admin-bar` 로 변경(선택자만 개명, 속성은 유지). `body.preview-mode #btn-logout { display:none; }`는 유지.
- 바 안의 `[관리자 화면으로]` 버튼 스타일을 추가한다(바 우측에 배치되도록, 예: `margin-left:auto`).

## 노출 매트릭스

| 상황 | 바 노출 | 바 문구 | 로그아웃 |
| --- | --- | --- | --- |
| 미리보기 모드(admin이 검색→이동) | O | 관리자 미리보기 — OOO 학생 | 숨김 |
| 일반 리포트 + 관리자 세션 | O | 관리자로 로그인된 상태입니다 | 유지 |
| 일반 리포트 + 학부모(세션 없음) | X | — | 유지 |
| 로컬 모드(비 Supabase) | X | — | 유지 |

## 에러 처리·엣지 케이스

- **`currentUser()` 네트워크 오류**: catch에서 무시 → 바 미노출(학부모 화면과 동일). 관리자 동선만 잠시 안 보일 뿐 리포트 자체는 정상.
- **같은 탭 이동 후 새로고침**: 미리보기는 sessionStorage로 유지(기존과 동일). 일반 모드는 `checkAdminSession`이 다시 확인.
- **버퍼 잔존 방지**: 같은 탭 이동이어도 `takePreview`가 부팅 즉시 localStorage 버퍼를 소비·삭제하므로 이후 일반 방문에 누수 없음(기존과 동일).
- **stale 미리보기 재진입 방지(같은 탭 전환에서 생기는 문제)**: `takePreview`는 새로고침 유지를 위해 미리보기를 sessionStorage에 남긴다. 새 탭 시절엔 탭을 닫으면 사라졌지만, 같은 탭 전환에서는 탭이 살아 있어 잔재가 남는다. 그대로 두면 `admin → 리포트보기 → 관리자 화면으로 → (admin의 "리포트 화면" 링크) → index.html`에서 stale 미리보기가 다시 떠 관리자가 미리보기에 갇힌다. 해결: 관리자가 admin 화면에 들어오면 미리보기 컨텍스트가 끝난 것이므로, **`admin.js`의 `init()` 첫 머리에서 `SCPreview.clearPreview()`로 버퍼·세션 잔재를 정리**한다. 미리보기 화면의 새로고침은 admin을 거치지 않으므로 유지된다(의도 보존).
- **관리자 바 노출 타이밍**: `currentUser()`가 비동기라 리포트가 먼저 그려지고 바가 약간 뒤에 나타날 수 있다(허용).

## 변경 파일 요약

| 파일 | 변경 |
| --- | --- |
| `web/admin.js` | `openReport` 같은 탭 이동·팝업 alert 제거, 버튼 라벨 "리포트 보기", `init()`에서 `clearPreview()` 호출 |
| `web/index.html` | `#preview-banner` → `#admin-bar` |
| `web/app.js` | `showPreviewBanner`→`renderAdminBar(opts)` 일반화 + 버튼, `checkAdminSession()` 부팅 호출 |
| `web/styles.css` | `.preview-banner`→`.admin-bar`, `[관리자 화면으로]` 버튼 스타일 |
| `web/preview.js` | `clearPreview()` 추가(미리보기 버퍼·세션 잔재 정리) |

## 범위 밖 (YAGNI)

- 관리자 화면 → 리포트 외 다른 진입점 추가(관리자 화면엔 이미 "리포트 화면" 링크가 있음).
- view별(달력/월간)로 바 노출을 다르게 거는 분기 — 바는 sticky로 모든 view 위에 일관되게 뜨고 관리자에게만 보이므로 불필요.
- 새 탭으로 여는 옵션 병행 — 같은 탭으로 완전히 대체한다.
