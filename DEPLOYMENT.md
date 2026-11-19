# GitHub 배포

SYNAPSE BRAIN은 Windows PC에서 실행하는 로컬 앱입니다. 이 저장소에는 소스 코드, 설치 문서, 빈 보관함, 예시, 빌드된 화면을 함께 배포합니다.

순정 배포본을 만들 때는 설치용 사본을 따로 사용하세요. `setup.mjs`는 문서의 경로 자리표시를 실제 PC 경로로 바꿉니다. 개인 작업 기록·결과물·인증정보·알림 설정은 커밋에서 제외하세요.

```powershell
npm ci --prefix app
npm test --prefix app
npm run check --prefix app
```

순정 보관함 검사에서 아직 설치하지 않은 경로는 경고가 날 수 있습니다. 별도 사본에서 [설치 안내](INSTALL.md)에 따라 경로를 설정하면 확인할 수 있습니다.

화면 코드를 바꿨다면 다음 명령으로 빌드하고 `app/web/dist`도 커밋하세요.

```powershell
npm ci --prefix app/web
npm run build --prefix app/web
```

## 포함된 글꼴

- [Pretendard](https://github.com/orioncactus/pretendard) · [SIL OFL 1.1](app/web/public/fonts/licenses/Pretendard-OFL.txt)
- [Geist 및 Geist Mono](https://github.com/vercel/geist-font) · [SIL OFL 1.1](app/web/public/fonts/licenses/Geist-OFL.txt)
