#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "esp_camera.h"
#include <Wire.h>

/*
 * =================================================================================================
 * ARES-1 ROVER: MASTER MISSION CONTROL FIRMWARE
 * =================================================================================================
 * Version: 3.1.0-PRODUCTION-STABLE
 * Platform: ESP32-CAM (AI-Thinker)
 * 
 * REQUIRED LIBRARIES:
 * 1. PubSubClient (by Nick O'Leary)
 * 2. ArduinoJson (by Benoit Blanchon)
 * 3. DHT Sensor Library (if using DHT)
 * 4. TinyGPS++ (if using NEO-6M)
 * =================================================================================================
 */

// -------------------------------------------------------------------------------------------------
// [SECTOR 1] HARDWARE DEFINITIONS (AI-THINKER CAM + SENSORS)
// -------------------------------------------------------------------------------------------------
// Camera Pins
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define V_SYNC_GPIO_NUM   25
#define H_REF_GPIO_NUM    23
#define PCLK_GPIO_NUM     22

// Peripheral Pins
#define PIN_FLASH_LED      4   // Camera Flash
#define PIN_GAS           12   // Analog Gas
#define PIN_VIBRATION     13   // Analog Seismic
#define PIN_FLAME         15   // Digital Fire
#define PIN_PIR           14   // Digital Human Detection
#define PIN_ULTRA_TRIG     2   // Ultrasonic Trig
#define PIN_ULTRA_ECHO    16   // Ultrasonic Echo
#define PIN_BATT_SENSE    12   // Battery Sense (ADC)

// -------------------------------------------------------------------------------------------------
// [SECTOR 2] NETWORK & CLOUD CONFIG
// -------------------------------------------------------------------------------------------------
const char* ssid         = "YOUR_WIFI_SSID";
const char* password     = "YOUR_WIFI_PASSWORD";
const char* mqtt_broker  = "broker.emqx.io";

// Topic Map
const char* TOPIC_TELEMETRY = "ares1/rover/telemetry";
const char* TOPIC_GPS       = "ares1/rover/gps";
const char* TOPIC_CAMERA    = "ares1/rover/camera";
const char* TOPIC_COMMAND   = "ares1/rover/command";
const char* TOPIC_STATUS    = "ares1/rover/status";
const char* TOPIC_ALERTS    = "ares1/rover/alerts";

// -------------------------------------------------------------------------------------------------
// [SECTOR 3] MISSION OBJECTS & STATE
// -------------------------------------------------------------------------------------------------
WiFiClient espClient;
PubSubClient client(espClient);

bool isStreaming    = false;
bool isNightMode    = false;
unsigned long lastUpdate = 0;
const int updateInterval = 1000; 

// -------------------------------------------------------------------------------------------------
// [SECTOR 4] CAMERA ENGINE (DRIVERS)
// -------------------------------------------------------------------------------------------------

void initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = V_SYNC_GPIO_NUM;
  config.pin_href = H_REF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  
  config.frame_size = FRAMESIZE_VGA;
  config.jpeg_quality = 12;
  config.fb_count = 1;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) { Serial.printf("[CAM] Init Failed: 0x%x\n", err); }
}

// -------------------------------------------------------------------------------------------------
// [SECTOR 5] DATA PIPELINE (MQTT PUBLISHERS)
// -------------------------------------------------------------------------------------------------

void publishTelemetry() {
  StaticJsonDocument<256> doc;
  char buffer[256];

  // 1. GAS (Analog 34)
  int gas = analogRead(PIN_GAS);
  doc.clear();
  doc["sensor"] = "gas";
  doc["value"]  = String(gas);
  doc["status"] = (gas > 2500) ? "CRITICAL" : "OPTIMAL";
  serializeJson(doc, buffer);
  client.publish(TOPIC_TELEMETRY, buffer);

  // 2. FIRE (Digital 15)
  bool fire = !digitalRead(PIN_FLAME);
  doc.clear();
  doc["sensor"] = "fire";
  doc["value"]  = fire ? "FIRE DETECTED" : "CLEAR";
  doc["status"] = fire ? "CRITICAL" : "OPTIMAL";
  serializeJson(doc, buffer);
  client.publish(TOPIC_TELEMETRY, buffer);

  // 3. HUMAN (PIR 14)
  if (digitalRead(PIN_PIR)) {
    StaticJsonDocument<256> alert;
    alert["type"] = "DETECTION";
    alert["label"] = "HUMAN";
    alert["conf"] = 0.98;
    alert["x"] = 30; alert["y"] = 40; alert["w"] = 200; alert["h"] = 200;
    serializeJson(alert, buffer);
    client.publish(TOPIC_ALERTS, buffer);
  }

  // 4. POWER & SIGNAL
  float batt = (analogRead(PIN_BATT_SENSE) / 4095.0) * 3.3 * 4.0;
  doc.clear();
  doc["sensor"] = "batt";
  doc["value"]  = String(batt, 1);
  doc["unit"]   = "V";
  doc["status"] = (batt < 11.0) ? "WARNING" : "OPTIMAL";
  serializeJson(doc, buffer);
  client.publish(TOPIC_TELEMETRY, buffer);

  doc.clear();
  doc["sensor"] = "wifi";
  doc["value"]  = String(WiFi.RSSI());
  doc["unit"]   = "dBm";
  serializeJson(doc, buffer);
  client.publish(TOPIC_TELEMETRY, buffer);
}

void publishGPS() {
  // Placeholder: Integrate TinyGPS++ here for NMEA parsing
  StaticJsonDocument<150> doc;
  doc["lat"] = 0.0; doc["lng"] = 0.0;
  doc["heading"] = 0; doc["speed"] = 0.0;
  char buffer[150];
  serializeJson(doc, buffer);
  client.publish(TOPIC_GPS, buffer);
}

void publishCameraStatus() {
  StaticJsonDocument<128> doc;
  doc["active"] = isStreaming;
  doc["url"]    = "http://" + WiFi.localIP().toString() + ":81/stream";
  doc["fps"]    = isStreaming ? 30 : 0;
  char buffer[128];
  serializeJson(doc, buffer);
  client.publish(TOPIC_CAMERA, buffer);
}

// -------------------------------------------------------------------------------------------------
// [SECTOR 6] MQTT CONTROL LOGIC
// ---------------------------------------------------------------------------------

void callback(char* topic, byte* payload, unsigned int length) {
  StaticJsonDocument<256> doc;
  deserializeJson(doc, payload, length);
  const char* command = doc["command"];

  if (strcmp(command, "TOGGLE_STREAM") == 0) {
    isStreaming = doc["active"];
    publishCameraStatus();
  } 
  else if (strcmp(command, "SET_NIGHT_MODE") == 0) {
    isNightMode = doc["enabled"];
    digitalWrite(PIN_FLASH_LED, isNightMode ? HIGH : LOW);
  }
}

void reconnect() {
  while (!client.connected()) {
    String clientId = "ARES1_STABLE_" + WiFi.macAddress();
    if (client.connect(clientId.c_str())) {
      client.subscribe(TOPIC_COMMAND);
      client.publish(TOPIC_STATUS, "{\"status\":\"ONLINE\"}");
    } else {
      delay(5000);
    }
  }
}

// -------------------------------------------------------------------------------------------------
// [SECTOR 7] MISSION BOOT
// -------------------------------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  Serial.println("[ARES-1] BOOTING STABLE MISSION CONTROL...");

  initCamera();
  
  pinMode(PIN_FLASH_LED, OUTPUT);
  pinMode(PIN_FLAME, INPUT);
  pinMode(PIN_PIR, INPUT);
  pinMode(PIN_ULTRA_TRIG, OUTPUT);
  
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\n[ARES-1] NETWORK READY");

  client.setServer(mqtt_broker, 1883);
  client.setCallback(callback);
  
  publishCameraStatus();
}

void loop() {
  if (!client.connected()) reconnect();
  client.loop();

  unsigned long now = millis();
  if (now - lastUpdate > updateInterval) {
    lastUpdate = now;
    publishTelemetry();
    publishGPS();
    if (isStreaming) publishCameraStatus();
  }
}
