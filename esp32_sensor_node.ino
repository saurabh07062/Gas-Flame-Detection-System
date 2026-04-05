#include <WiFi.h>
#include <HTTPClient.h>

// ---------------- CONFIGURATION ---------------- //
const char* ssid = "saurabh";
const char* password = "12345678";

// Your server URL on port 3000
const String SERVER_URL = "http://172.20.194.160:3000/api/sensor-data"; 

// Hardware Pins
const int MQ2_PIN_A = 32;     // Analog Scan A
const int MQ2_PIN_B = 33;     // Analog Scan B
const int MQ2_PIN_C = 34;     // Analog Scan C
const int FLAME_PIN = 35;     // Digital Pin (Input Only)



// Timing Settings
const int UPDATE_INTERVAL = 2000; 
unsigned long lastSendTime = 0;

int sensorBaseline = 0;
const int CALIBRATION_SAMPLES = 10; // 2s warmup
const int NOISE_SAMPLES = 10;       // Simple averaging (Jumper readings)





// ----------------------------------------------- //

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n--- ESP32DEVKITV1 GAS MONITOR ---");
  analogSetAttenuation(ADC_11db);

  analogReadResolution(12);
  pinMode(FLAME_PIN, INPUT);
  
  connectWiFi();
  performCalibration();
}

void loop() {
  if (millis() - lastSendTime >= UPDATE_INTERVAL) {
    lastSendTime = millis();
    if (WiFi.status() == WL_CONNECTED) {
      sendSensorData();
    } else {
      connectWiFi();
    }
  }
}

void connectWiFi() {
  Serial.print("[WIFI] Connecting...");
  WiFi.begin(ssid, password);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500); Serial.print("."); attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WIFI] Connected! IP: " + WiFi.localIP().toString());
  }
}

void performCalibration() {
  Serial.println("[CALIBRATION] Auto-Scanning Pins... (3s)");
  long sumA = 0, sumB = 0, sumC = 0;
  
  for (int i = 0; i < CALIBRATION_SAMPLES; i++) {
    sumA += analogRead(MQ2_PIN_A);
    sumB += analogRead(MQ2_PIN_B);
    sumC += analogRead(MQ2_PIN_C);
    delay(200);
  }
  
  // Set baseline based on the active pin
  int baseA = sumA / CALIBRATION_SAMPLES;
  int baseB = sumB / CALIBRATION_SAMPLES;
  int baseC = sumC / CALIBRATION_SAMPLES;
  
  sensorBaseline = max(baseA, max(baseB, baseC));
  Serial.printf("[CALIBRATION] Final Baseline: %d\n", sensorBaseline);
}


int getAveragedReadings(int pin) {
  long sum = 0;
  for (int i = 0; i < NOISE_SAMPLES; i++) {
    sum += analogRead(pin);
    delay(2); 
  }
  return sum / NOISE_SAMPLES;
}





void sendSensorData() {
  // 1. Scan multiple potential pins for the best signal
  int rawA = getAveragedReadings(MQ2_PIN_A);
  int rawB = getAveragedReadings(MQ2_PIN_B);
  int rawC = getAveragedReadings(MQ2_PIN_C);
  
  // Use the highest reading (where the sensor is actually plugged in)
  int rawGas = max(rawA, max(rawB, rawC));
  
  int flameState = digitalRead(FLAME_PIN);
  bool flameDetected = (flameState == LOW);

  // 2. Map Gas Level (More sensitive mapping)
  int gasLevel = (rawGas > sensorBaseline) ? (rawGas - sensorBaseline) : 0;
  int gasPPM = map(gasLevel, 0, 1500, 0, 1000); 

  Serial.printf("[SCAN] P32:%d | P33:%d | P34:%d | USE:%d\n", rawA, rawB, rawC, rawGas);



  // 3. Send Data
  WiFiClient client;
  HTTPClient http;
  
  // FIXED: Explicitly use wifi client to resolve compilation errors
  http.begin(client, SERVER_URL);
  http.addHeader("Content-Type", "application/json");

  // 4. Build JSON
  String jsonPayload = "{";
  jsonPayload += "\"gasLevel\":" + String(gasLevel) + ",";
  jsonPayload += "\"gasPPM\":" + String(gasPPM) + ",";
  jsonPayload += "\"flameDetected\":" + String(flameDetected ? "true" : "false") + ",";
  jsonPayload += "\"rawLevel\":" + String(rawGas) + ",";
  jsonPayload += "\"ssid\":\"" + String(WiFi.SSID()) + "\",";
  jsonPayload += "\"rssi\":" + String(WiFi.RSSI()) + ",";
  jsonPayload += "\"ip\":\"" + WiFi.localIP().toString() + "\"";
  jsonPayload += "}";

  int httpResponseCode = http.POST(jsonPayload);
  
  if (httpResponseCode > 0) {
    Serial.print("[SERVER] Status: "); Serial.println(httpResponseCode);
  } else {
    Serial.print("[SERVER] Error: "); Serial.println(http.errorToString(httpResponseCode));
  }

  
  http.end();
}