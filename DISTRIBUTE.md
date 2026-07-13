# HongGoCat 배포 · 자동 업데이트 가이드 (A안: electron-updater + GitHub Releases)

친구는 **설치 파일(.exe) 한 번만 설치**하면 되고, 이후 내가 새 버전을 올릴 때마다 **앱이 켜질 때 자동으로 업데이트**를 받습니다.

동작 개요: 앱 실행 → GitHub Releases에서 최신 버전 확인 → 백그라운드 다운로드 → **다음에 앱을 끄고 켜면 새 버전으로 설치**.

---

## 이미 자동으로 해둔 것 ✅
- `package.json`에 `electron-builder`(패키징) + `electron-updater`(자동 업데이트) + `build`/`publish` 설정 추가.
- `main.js`에 업데이트 확인 코드(`initAutoUpdate`) 추가 — 패키징된 빌드에서만 동작(개발 실행에는 영향 없음).
- `.gitignore` 추가(`node_modules`, `dist` 제외) 및 **git 저장소 초기화 + 첫 커밋** 완료.

## 내가 대신 못 하는 것 (네 계정/인증 필요) — 아래 순서대로 진행
아래 명령은 모두 프로젝트 폴더(`C:\Users\hrkim\projects\Bongo`)에서 실행.

### 1. 의존성 설치 (electron-builder / electron-updater)
```powershell
npm install
```

### 2. GitHub 저장소 만들기
1. https://github.com/new 에서 저장소 생성 (이름: `honggocat`, Public 권장 — Private면 친구도 토큰 필요).
2. `package.json`의 `build.publish.owner`를 **네 GitHub 사용자명**으로 바꿔줘 (지금은 `YOUR_GITHUB_USERNAME` 플레이스홀더).
   - `repo`는 `honggocat` 그대로면 됨.
3. 로컬 저장소를 GitHub에 연결하고 올리기:
```powershell
git remote add origin https://github.com/<네사용자명>/honggocat.git
git push -u origin main
```

### 3. 배포용 토큰 설정 (릴리스 업로드 권한)
1. https://github.com/settings/tokens 에서 **Fine-grained token** 또는 classic token 생성 — 권한: `repo`(또는 Contents: read/write).
2. 발급된 토큰을 환경변수로 등록 (창을 새로 열면 유지되도록):
```powershell
setx GH_TOKEN "여기에_토큰_붙여넣기"
```
   등록 후 **PowerShell 창을 새로 열어야** 적용됩니다.

### 4. 첫 릴리스 배포
```powershell
npm run release
```
- `electron-builder`가 설치 파일(`dist\HongGoCat Setup 0.1.0.exe`)을 만들고 GitHub Releases에 자동 업로드합니다.
- 완료되면 GitHub 저장소의 **Releases 탭**에 `v0.1.0`이 생깁니다.

### 5. 친구에게 전달 (처음 한 번만)
- Releases 탭의 **`HongGoCat Setup x.x.x.exe`** 링크를 친구에게 전달 → 친구가 실행해서 설치.
- ⚠️ 코드 서명을 안 했으므로 처음 실행 시 **Windows SmartScreen 경고**가 뜹니다 → "추가 정보 → 실행"으로 진행하면 됩니다. (정식으로 없애려면 유료 코드서명 인증서가 필요.)

### 6. 이후 업데이트 (반복)
새 기능/수정 후:
```powershell
# package.json의 version을 올린다 (예: 0.1.0 → 0.1.1)
npm version patch          # 자동으로 version 올리고 git 태그 커밋
git push --follow-tags
npm run release            # 새 설치본을 Releases에 업로드
```
→ 친구들은 **앱을 재시작할 때 자동으로 새 버전**을 받습니다. 별도 안내 불필요.

---

## 멀티플레이 서버 (자동 업데이트와 별개)
자동 업데이트는 **클라이언트 앱**만 갱신합니다. 같이 놀려면 서버가 필요:
- 한 명이 호스트: `npm run server` (개발 폴더에서) → 포트 8787.
- 같은 Wi-Fi면 나머지는 설정창 서버 주소에 `ws://<호스트IP>:8787` + 같은 방 코드.
- 인터넷으로 하려면 ngrok/Cloudflare Tunnel 또는 클라우드 VPS에 서버를 올리면 됨.
- 서버 주소를 고정하고 싶으면, 앱 기본 서버 주소를 그 주소로 바꿔 배포하면 친구가 주소를 입력할 필요도 없어집니다(원하면 적용해줄게).

## 참고
- 자동 업데이트는 **패키징된 설치본에서만** 동작합니다. `npm start`(개발 실행)에서는 업데이트 확인을 건너뜁니다.
- Private 저장소로 하면 친구 앱도 토큰이 필요해 번거로워집니다 → **Public 저장소 권장**.
