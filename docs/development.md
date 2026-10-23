# 개발 구조와 API

## 구성

기기는 Arduino `WebServer`로 UI와 API를 제공하고, `Preferences`의 NVS에 설정과 날씨를 저장합니다. 스마트폰 웹 화면은 외부 CDN·온라인 폰트에 의존하지 않습니다. S-Core Dream이 설치되어 있으면 글꼴 후보로 사용하고, 없으면 로컬 시스템 한글 글꼴로 표시합니다.

| 파일 | 책임 |
| --- | --- |
| `firmware/Keyring/Keyring.ino` | I2C/OLED, AP, HTTP, 저장, 화면 루프 |
| `firmware/Keyring/keyring_core.h` | 설정·날씨 검증, 부팅별 시계, 예보 상태 판단 |
| `firmware/Keyring/character_renderer.h` | Arduino와 네이티브 환경에서 같은 픽셀 생성 |
| `firmware/Keyring/web_assets.h` | 웹 소스를 압축한 생성 자산 |
| `web/sprites.json` | 같은 C++ 렌더러에서 내보낸 미리보기 프레임 |
| `web/app.js` | 선택·미리보기·기기 통신·저장 피드백 |
| `web/weather.mjs` | API 응답 변환, 파일 검증, 상태·시간 표시 |

## 렌더링과 갱신

화면은 128×64, 프레임 버퍼는 1,024바이트입니다. SSD1306의 수직 페이지 순서로 `index = x + floor(y / 8) * 128`, 비트는 `y % 8`입니다. 웹은 같은 바이트를 Canvas `ImageData`로 풀어 표시합니다. 캔버스 확대 시 픽셀 보간을 끄며, CSS 장식은 실제 OLED 그림에 포함하지 않습니다.

캐릭터 5종 × 감정 6종 × 애니메이션 32프레임을 같은 렌더러로 만듭니다. 기본 프레임 간격은 160ms입니다. 펌웨어는 변경된 버퍼에만 OLED 전송을 수행합니다. 소프트웨어 프레임을 지운 뒤 다시 그리더라도 완성한 버퍼만 디스플레이로 보내므로 중간의 빈 화면을 전송하지 않습니다.

## 재현 가능한 명령

저장소 루트에서 실행합니다.

```sh
bash tools/setup.sh
bash tools/test.sh
bash tools/build.sh
npm run test:e2e
```

`setup.sh`는 Linux x86_64 클라우드용이며 `/workspace/.tooling`에 Arduino CLI 1.3.1, ESP32 Core 3.3.7, Adafruit SSD1306 2.5.16, Adafruit GFX Library 1.12.5, Adafruit BusIO 1.17.4, ArduinoJson 7.4.2를 설치합니다. 공식 체크섬·배포 소스 검증을 유지하고 전역 시스템 파일을 수정하지 않습니다. 다른 운영체제는 Arduino IDE로 설치합니다. `test.sh`는 네이티브 C++·Node.js 테스트와 생성 자산 일관성 검사를 수행합니다. `build.sh`는 ESP32 Arduino Core 3.3.7의 ESP32C3 Dev Module로 실제 타깃 컴파일을 수행합니다. 브라우저 테스트는 별도의 Chromium 설치가 필요할 수 있으므로 설치 스크립트와 실행 결과를 확인합니다. 테스트를 실행하지 않은 환경에서 성공을 가정하지 않습니다.

설치 기본 경로는 저장소 상위의 `.tooling`이며 `KEYRING_TOOLING`으로 설치·빌드 경로를 함께 지정할 수 있습니다. Python 3.12 이상과 Node.js 22 이상을 사용합니다. 웹 의존성은 잠금 파일에 맞춰 `npm ci`로 설치합니다. 시스템 `/usr/bin/chromium`이 있으면 사용하고, 다른 실행 파일은 `CHROMIUM_PATH`로 지정합니다. 시스템 브라우저가 없다면 `npx playwright install chromium`으로 Playwright의 브라우저를 준비합니다. CI에는 필요한 시스템 패키지를 함께 설치하는 명령이 포함되어 있습니다.

픽셀 원본을 수정했다면 `python3 tools/generate_sprites.py`로 미리보기 데이터를 다시 생성합니다. 웹 파일을 수정했다면 `python3 tools/embed_web.py`로 펌웨어 헤더를 생성합니다. `tools/build.sh`는 두 생성 작업을 자동으로 수행합니다. 생성된 헤더를 임의로 손으로 수정하지 않습니다.

개발 서버 기본 모드는 실제 기기 API가 없는 독립 웹 편집 화면입니다. 인터넷을 통해 실제 날씨를 내려받는 용도로도 사용할 수 있습니다.

```sh
python3 tools/dev_server.py --port 8000
```

기기 API를 모의 응답하는 개발 모드는 명시적으로 켭니다. 화면에 모의 기기임이 표시되어야 하며, ESP32 저장·OLED 작동 확인을 대신하지 않습니다.

```sh
python3 tools/dev_server.py --port 8000 --mock
```

기본 서버는 해당 PC에서만 접속할 수 있도록 `127.0.0.1`에 바인딩합니다. 인터넷이 되는 같은 수업망의 스마트폰에서도 독립 웹 화면을 열려면 다음과 같이 실행하고 PC의 네트워크 주소와 포트 8000을 사용합니다.

```sh
python3 tools/dev_server.py --host 0.0.0.0 --port 8000
```

신뢰할 수 있는 수업망에서만 사용합니다. `--mock` 개발 API는 수업용 실제 장치처럼 공개하지 않습니다.

## HTTP API

기기 주소는 AP 연결 상태에서 `http://192.168.4.1`입니다. JSON 요청에는 `Content-Type: application/json`을 사용합니다. 쓰기 요청은 기기 페이지와 같은 출처에서 보내며, 외부 사이트에서 기기 설정을 바꾸는 방식으로 사용하지 않습니다. 잘못된 입력에는 오류 응답을 보내고 기존 데이터를 유지합니다.

| 메서드·경로 | 요청 | 성공 의미 |
| --- | --- | --- |
| `GET /api/state` | 없음 | 현재 저장 설정·부팅 시계·날씨·OLED 상태 읽기 |
| `POST /api/settings` | 캐릭터·감정·화면 모드 | 해당 설정을 저장한 뒤 성공 응답 |
| `POST /api/time` | UTC Unix 초 `epoch` | 이번 부팅의 시계 기준 설정 |
| `POST /api/weather` | 날씨 스키마 1 전체 | 검증한 날씨를 저장 |
| `POST /api/reset` | 빈 JSON 객체 | 설정을 기본값으로 돌리고 저장 날씨 삭제 |

설정 요청 예:

```json
{
  "character": "rabbit",
  "emotion": "happy",
  "view": "character"
}
```

허용 값:

| 필드 | 값 |
| --- | --- |
| `character` | `rabbit`, `cat`, `bear`, `turtle`, `monster` |
| `emotion` | `happy`, `excited`, `sleepy`, `sad`, `angry`, `love` |
| `view` | `character`, `weather`, `auto` |

시간 요청 예:

```json
{"epoch": 1792713600}
```

예시 숫자는 형식 설명용입니다. 실제 요청에서는 현재 UTC Unix 초를 보내야 합니다. 기존 날씨 파일의 업데이트 시각으로 현재 시계를 설정하지 않습니다.

`GET /api/state`의 주요 필드:

| 필드 | 의미 |
| --- | --- |
| `character`, `emotion`, `view` | 현재 저장 설정 |
| `ssid` | 이 기기의 AP 이름 |
| `clock.trusted` | 이번 부팅에서 시간을 맞춰 유효하게 진행 중인지 |
| `clock.now` | 신뢰 시 UTC 초, 아니면 `null` |
| `weather` | 저장 날씨 전체 또는 `null` |
| `weatherStatus` | `missing`, `sample`, `clock-unknown`, `stale`, `fresh` |
| `oled` | OLED 초기화 성공 여부 |

클라이언트는 HTTP 성공뿐 아니라 JSON의 `ok` 및 필요한 상태를 확인합니다. 연결이 끊겼거나 저장에 실패하면 성공 안내를 띄우지 않습니다. 미리보기 변경과 저장된 기기 상태를 구분합니다. 재시도할 때 동일한 설정을 반복 저장해 NVS 쓰기를 늘리지 않도록 합니다.

## 테스트와 실물 검증의 경계

- 네이티브 테스트는 설정 검증, 64비트 단조 시간, 전원 재시작에 해당하는 시계 신뢰 해제, 샘플·오래된 예보 판정, 픽셀 생성 규칙을 검사합니다.
- JavaScript 테스트는 실제 API 형식 변환, 잘못된 파일 거부, 24개 연속 예보와 상태 표시 규칙을 검사합니다.
- 브라우저 테스트는 선택·미리보기·저장 피드백·날씨 가져오기 등의 웹 흐름을 검사합니다. 모의 장치 응답을 쓰는 테스트는 실제 NVS 기록을 증명하지 않습니다.
- ESP32-C3 컴파일은 코어·라이브러리·스케치 통합을 검사합니다. USB 업로드, 물리 I2C 통신, 육안으로 보는 떨림과 전력 소비는 별도 실물 검증이 필요합니다.

수업용 실물 확인 항목은 [교사용 안내](teacher-guide.md)에 있습니다. 새 하드웨어나 배터리를 추가할 때는 현재 빌드가 그 장치까지 검증한다고 해석하지 않습니다.
