# Arduino IDE용 다운로드

[Keyring-Arduino.zip](Keyring-Arduino.zip)에는 블록 코딩을 실행하는 펌웨어 2.0.0과 필요한 헤더 파일 5개가 들어 있습니다. 압축을 풀고 **`Keyring/Keyring.ino`**를 Arduino IDE로 엽니다. 같은 폴더의 `.h` 파일은 함께 둡니다.

기존 **Adafruit SSD1306·Adafruit GFX·Adafruit BusIO** 라이브러리에 **ArduinoJson 7.4.2**를 추가 설치합니다. 보드는 **ESP32C3 Dev Module**, ESP32 Core는 **3.3.7**을 사용합니다. USB CDC On Boot는 Enabled, Flash Size는 4MB, Partition Scheme은 Huge APP으로 설정하고 연결한 USB 포트로 업로드합니다.

성공한 배선을 유지합니다: **GND → G, VCC → 3.3V, SDA → GPIO4, SCL → GPIO5**.

전체 과정은 [배선·업로드 안내](../docs/hardware-and-upload.md)를 참고하세요. 개발자가 스케치나 내장 웹 자산을 수정했다면 저장소 루트에서 `python3 tools/package_arduino.py`로 ZIP을 갱신하고, `python3 tools/package_arduino.py --check`로 소스와 일치하는지 검사합니다.
