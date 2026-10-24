# Arduino IDE용 다운로드

[Keyring-Arduino.zip 내려받기](https://raw.githubusercontent.com/themonsteredu/keyring/main/downloads/Keyring-Arduino.zip)

펌웨어 **2.2.0**은 도톰한 표정, 아이콘·온도·습도 날씨 화면, 블록 코딩을 지원합니다. ZIP에는 스케치·헤더 7개·폰트 라이선스까지 **총 9개 파일**이 들어 있습니다.

1. 압축을 풀고 **`Keyring/Keyring.ino`**를 Arduino IDE로 엽니다. 같은 폴더의 파일을 함께 둡니다.
2. **Adafruit SSD1306·Adafruit GFX·Adafruit BusIO·ArduinoJson 7.4.2**를 설치합니다.
3. 보드 **ESP32C3 Dev Module**, 코어 **3.3.7**, **USB CDC On Boot: Enabled**, **Flash Size: 4MB**, **Partition Scheme: Huge APP**으로 설정하고 업로드합니다.

배선은 **GND → G, VCC → 3.3V, SDA → GPIO4, SCL → GPIO5**입니다.

웹 화면을 새로 여는 것만으로 실제 OLED는 바뀌지 않습니다. 새 표정과 습도를 보려면 이 펌웨어를 다시 업로드하세요. 자세한 과정은 [배선·업로드 안내](../docs/hardware-and-upload.md)에 있습니다.

개발자는 `bash tools/build.sh`로 내장 웹 자산·펌웨어·ZIP을 함께 갱신합니다. `python3 tools/package_arduino.py --check`로 ZIP과 스케치가 일치하는지 확인합니다.

## 우유팩 케이스 STL

[Milk-Carton-Keyring-STL.zip 내려받기](https://raw.githubusercontent.com/themonsteredu/keyring/main/downloads/Milk-Carton-Keyring-STL.zip)

ZIP에는 본체·뒷뚜껑·OLED 시험판 STL, 조립 STEP과 미리보기·안내가 들어 있습니다. 설계 소스는 [CAD 폴더](../cad/milk-carton/)에 있습니다. **mm 단위, 100% 크기**로 출력합니다. 일반적인 부품 크기로 설계했으며 실제 장착은 아직 확인하지 않았습니다. 작은 OLED 시험판부터 출력하세요.

조립에는 플라스틱용 **2×8mm 나사 4개와 절연 폼테이프**가 추가로 필요합니다. [출력 방향·서포트·조립 안내](../cad/milk-carton/README.md)를 확인하세요.
