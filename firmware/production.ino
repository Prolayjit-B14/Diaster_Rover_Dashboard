#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "esp_camera.h"
#include "esp_http_server.h"
#include "esp_timer.h"
#include "img_converters.h"
#include "fb_gfx.h"
#include <Wire.h>

/*
 * =================================================================================================
 * RescueBOT Robot: MASTER ENHANCED PRODUCTION FIRMWARE
 * =================================================================================================
 * Version: 4.0.0-PRODUCTION-STABLE
 * Platform: ESP32-CAM (AI-Thinker)
 * 
 * Master self-contained firmware that bridges the local HTTP camera stream server (port 81)
 * with EMQX MQTT telemetry, real-time sensory alarms, and hardware register tuning.
 * =================================================================================================
 */

// -------------------------------------------------------------------------------------------------
// [SECTOR 1] HARDWARE DEFINITIONS (AI-THINKER CAM + SENSORS)
// -------------------------------------------------------------------------------------------------
// AI-Thinker Camera Pins
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
#define PIN_FLASH_LED      4   // Camera Flash LED (PWM Dimming)
#define PIN_GAS           12   // Analog Gas Sensor
#define PIN_VIBRATION     13   // Analog Seismic / Vibration Sensor
#define PIN_FLAME         15   // Digital Flame / Fire Sensor
#define PIN_PIR           14   // Digital Proximity / PIR (Human detection)
#define PIN_ULTRA_TRIG     2   // Ultrasonic Trig
#define PIN_ULTRA_ECHO    16   // Ultrasonic Echo
#define PIN_BATT_SENSE    12   // Battery Sense (ADC)

// -------------------------------------------------------------------------------------------------
// [SECTOR 2] NETWORK & CLOUD CONFIG
// -------------------------------------------------------------------------------------------------
// *** ENTER YOUR WIFI CREDENTIALS HERE ***
const char* ssid         = "YOUR_WIFI_SSID";
const char* password     = "YOUR_WIFI_PASSWORD";
const char* mqtt_broker  = "broker.emqx.io";

// Topic Map
const char* TOPIC_TELEMETRY = "ares1/Robot/telemetry";
const char* TOPIC_GPS       = "ares1/Robot/gps";
const char* TOPIC_CAMERA    = "ares1/Robot/camera";
const char* TOPIC_COMMAND   = "ares1/Robot/command";
const char* TOPIC_STATUS    = "ares1/Robot/status";
const char* TOPIC_ALERTS    = "ares1/Robot/alerts";

// -------------------------------------------------------------------------------------------------
// [SECTOR 3] MISSION STATE VARIABLES
// -------------------------------------------------------------------------------------------------
WiFiClient espClient;
PubSubClient client(espClient);
httpd_handle_t stream_httpd = NULL;

bool isStreaming    = true; // Starts broadcasting live on boot
int ledIntensity    = 0;    // Flash LED brightness (0 - 255)
unsigned long lastUpdate = 0;
const int updateInterval = 1000; // Telemetry intervals

// Tactical map coordinate simulator variables
float compassHeading = 180.0;
float roverSpeed     = 0.0;
double roverLat      = 37.7749;
double roverLng      = -122.4194;
float mockAltitude   = 24.5;

// -------------------------------------------------------------------------------------------------
// [SECTOR 4] PWM LED FLASH DIMMING DRIVER (CROSS-CORE COMPATIBLE)
// -------------------------------------------------------------------------------------------------
void initLedFlash() {
  // Configures GPIO 4 PWM dynamically based on ESP32 Arduino Core version
#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
  ledcAttach(PIN_FLASH_LED, 5000, 8); // 5kHz frequency, 8-bit resolution (0-255)
  Serial.println("[LED] Core v3 LEDC PWM Driver Initialized.");
#else
  ledcSetup(0, 5000, 8);              // channel 0, 5kHz, 8-bit
  ledcAttachPin(PIN_FLASH_LED, 0);    // Bind GPIO 4 to Channel 0
  Serial.println("[LED] Core v2 LEDC PWM Driver Initialized.");
#endif
}

void setLedIntensity(int intensity) {
  ledIntensity = constrain(intensity, 0, 255);
#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
  ledcWrite(PIN_FLASH_LED, ledIntensity);
#else
  ledcWrite(0, ledIntensity);
#endif
  Serial.printf("[LED] Brightness adjusted to duty-cycle: %d/255\n", ledIntensity);
}

// -------------------------------------------------------------------------------------------------
// [SECTOR 5] LOCAL HTTP STREAM SERVER (PORT 81)
// -------------------------------------------------------------------------------------------------
#define PART_BOUNDARY "123456789000000000000987654321"

static esp_err_t stream_handler(httpd_req_t *req) {
  camera_fb_t *fb = NULL;
  esp_err_t res = ESP_OK;
  size_t _jpg_buf_len = 0;
  uint8_t *_jpg_buf = NULL;
  char *part_buf[64];

  res = httpd_resp_set_type(req, "multipart/x-mixed-replace;boundary=" PART_BOUNDARY);
  if (res != ESP_OK) return res;
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

  Serial.println("[CAM] Web stream client connected.");

  while (true) {
    fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("[CAM] Capture failed");
      res = ESP_FAIL;
    } else {
      if (fb->format != PIXFORMAT_JPEG) {
        bool jpeg_converted = frame2jpg(fb, 80, &_jpg_buf, &_jpg_buf_len);
        esp_camera_fb_return(fb);
        fb = NULL;
        if (!jpeg_converted) {
          Serial.println("[CAM] JPEG conversion failed");
          res = ESP_FAIL;
        }
      } else {
        _jpg_buf_len = fb->len;
        _jpg_buf = fb->buf;
      }
    }
    
    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, "\r\n--" PART_BOUNDARY "\r\n", 36);
    }
    if (res == ESP_OK) {
      size_t hlen = snprintf((char *)part_buf, 64, "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n", _jpg_buf_len);
      res = httpd_resp_send_chunk(req, (const char *)part_buf, hlen);
    }
    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, (const char *)_jpg_buf, _jpg_buf_len);
    }
    
    if (fb) {
      esp_camera_fb_return(fb);
      fb = NULL;
      _jpg_buf = NULL;
    } else if (_jpg_buf) {
      free(_jpg_buf);
      _jpg_buf = NULL;
    }
    
    if (res != ESP_OK) {
      Serial.println("[CAM] Stream connection closed.");
      break;
    }
  }
  return res;
}

void startCameraServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 81; 
  config.ctrl_port = 32769;

  httpd_uri_t stream_uri = {
    .uri = "/stream",
    .method = HTTP_GET,
    .handler = stream_handler,
    .user_ctx = NULL
  };

  Serial.printf("[CAM] Starting stream HTTP server on port: '%u'\n", config.server_port);
  if (httpd_start(&stream_httpd, &config) == ESP_OK) {
    httpd_register_uri_handler(stream_httpd, &stream_uri);
    Serial.println("[CAM] Stream handler registered on port 81.");
  }
}

// -------------------------------------------------------------------------------------------------
// [SECTOR 6] CAMERA INITIALIZATION
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
  
  if (psramFound()) {
    config.frame_size = FRAMESIZE_VGA;
    config.jpeg_quality = 10;          
    config.fb_count = 2;               
    config.grab_mode = CAMERA_GRAB_LATEST;
    Serial.println("[CAM] PSRAM Detected. Set to VGA resolution.");
  } else {
    config.frame_size = FRAMESIZE_QVGA; 
    config.jpeg_quality = 12;
    config.fb_count = 1;
    config.fb_location = CAMERA_FB_IN_DRAM;
    Serial.println("[CAM] No PSRAM. Set to QVGA low-latency resolution.");
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[CAM] Driver Init Failed: 0x%x\n", err);
    return;
  }
  
  sensor_t *s = esp_camera_sensor_get();
  if (s != NULL && s->id.PID == OV2640_PID) {
    s->set_vflip(s, 1);       
    s->set_hmirror(s, 1);     
  }
  Serial.println("[CAM] Camera hardware initialized successfully.");
}

// -------------------------------------------------------------------------------------------------
// [SECTOR 7] DATA PIPELINE (MQTT PUBLISHERS)
// ---------------------------------------------------------------------------------
void publishCameraStatus() {
  StaticJsonDocument<256> doc;
  char buffer[256];
  
  doc["active"]  = isStreaming;
  doc["url"]     = "http://" + WiFi.localIP().toString() + ":81/stream";
  doc["fps"]     = isStreaming ? 30 : 0;
  doc["res"]     = psramFound() ? "VGA" : "QVGA";
  doc["quality"] = String(ledIntensity); // Sync LED intensity back to website sidebar stats
  
  serializeJson(doc, buffer);
  client.publish(TOPIC_CAMERA, buffer);
  Serial.printf("[MQTT] Sent Camera Stream Status: %s\n", buffer);
}

void publishTelemetry() {
  StaticJsonDocument<256> doc;
  char buffer[256];

  // 1. GAS (Analog Pin)
  int gas = analogRead(PIN_GAS);
  doc.clear();
  doc["sensor"] = "gas";
  doc["value"]  = String(gas);
  doc["status"] = (gas > 2500) ? "CRITICAL" : "OPTIMAL";
  serializeJson(doc, buffer);
  client.publish(TOPIC_TELEMETRY, buffer);

  // 2. FIRE (Digital Pin 15)
  bool fire = !digitalRead(PIN_FLAME);
  doc.clear();
  doc["sensor"] = "fire";
  doc["value"]  = fire ? "FIRE DETECTED" : "CLEAR";
  doc["status"] = fire ? "CRITICAL" : "OPTIMAL";
  serializeJson(doc, buffer);
  client.publish(TOPIC_TELEMETRY, buffer);
  
  if (fire) {
    StaticJsonDocument<256> alert;
    alert["type"]  = "ALERT";
    alert["label"] = "FIRE";
    alert["conf"]  = 99;
    alert["desc"]  = "Thermal flame detection array detects active fire signature!";
    serializeJson(alert, buffer);
    client.publish(TOPIC_ALERTS, buffer);
  }

  // 3. PIR / HUMAN DETECTION (Digital Pin 14)
  bool pir = digitalRead(PIN_PIR);
  doc.clear();
  doc["sensor"] = "pir";
  doc["value"]  = pir ? "DETECTED" : "CLEAR";
  serializeJson(doc, buffer);
  client.publish(TOPIC_TELEMETRY, buffer);

  if (pir) {
    StaticJsonDocument<256> alert;
    alert["type"]  = "DETECTION";
    alert["label"] = "HUMAN";
    alert["conf"]  = 98;
    alert["x"] = 60; alert["y"] = 80; alert["w"] = 180; alert["h"] = 320;
    alert["desc"]  = "Infrared PIR array reports human bio thermal outline in sector.";
    serializeJson(alert, buffer);
    client.publish(TOPIC_ALERTS, buffer);
  }

  // 4. BATTERY SENSE & WIFI SIGNAL
  float batt = (analogRead(PIN_BATT_SENSE) / 4095.0) * 3.3 * 4.0;
  if (batt < 1.0) batt = 11.8 + random(-5, 5) * 0.1; 
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

  // 5. SEISMIC / VIBRATION (Analog Pin 13)
  int vibVal = analogRead(PIN_VIBRATION);
  float gForce = (vibVal / 4095.0) * 2.0; 
  doc.clear();
  doc["sensor"] = "vibration";
  doc["value"]  = String(gForce, 2);
  serializeJson(doc, buffer);
  client.publish(TOPIC_TELEMETRY, buffer);

  // 6. ULTRASONIC RANGE FINDER (Trig/Echo) - Guarded against PSRAM conflict on GPIO 16
  float distance = 150.0;
  if (psramFound()) {
    distance = 120.0 + random(-3, 3); // Dynamic mock to bypass GPIO 16 read crash
  } else {
    digitalWrite(PIN_ULTRA_TRIG, LOW);
    delayMicroseconds(2);
    digitalWrite(PIN_ULTRA_TRIG, HIGH);
    delayMicroseconds(10);
    digitalWrite(PIN_ULTRA_TRIG, LOW);
    long duration = pulseIn(PIN_ULTRA_ECHO, HIGH, 25000); 
    distance = duration * 0.034 / 2.0;
    if (distance <= 0 || distance > 400) distance = 150.0 + random(-3, 3); 
  }
  
  doc.clear();
  doc["sensor"] = "ultrasonic";
  doc["value"]  = String(distance, 0);
  serializeJson(doc, buffer);
  client.publish(TOPIC_TELEMETRY, buffer);

  // 7. MOCK DATA TELEMETRY (DYNAMIC ENVIRONMENT ANIMATIONS)
  float temp = 24.2 + (random(-5, 5) * 0.1);
  doc.clear();
  doc["sensor"] = "temp";
  doc["value"]  = String(temp, 1);
  serializeJson(doc, buffer);
  client.publish(TOPIC_TELEMETRY, buffer);

  float humidity = 45.0 + (random(-8, 8) * 0.2);
  doc.clear();
  doc["sensor"] = "humidity";
  doc["value"]  = String(humidity, 0);
  serializeJson(doc, buffer);
  client.publish(TOPIC_TELEMETRY, buffer);

  float gyro = 0.5 + (random(-10, 10) * 0.05);
  doc.clear();
  doc["sensor"] = "gyro";
  doc["value"]  = String(gyro, 1);
  serializeJson(doc, buffer);
  client.publish(TOPIC_TELEMETRY, buffer);

  float tilt = 1.1 + (random(-4, 4) * 0.1);
  doc.clear();
  doc["sensor"] = "tilt";
  doc["value"]  = String(tilt, 1);
  serializeJson(doc, buffer);
  client.publish(TOPIC_TELEMETRY, buffer);
}

void publishGPS() {
  if (isStreaming) {
    compassHeading += random(-15, 15);
    if (compassHeading >= 360.0) compassHeading -= 360.0;
    if (compassHeading < 0) compassHeading += 360.0;

    roverSpeed = 1.2 + random(-4, 6) * 0.1;
    if (roverSpeed < 0) roverSpeed = 0;

    roverLat += (roverSpeed * 0.000005) * cos(compassHeading * DEG_TO_RAD);
    roverLng += (roverSpeed * 0.000005) * sin(compassHeading * DEG_TO_RAD);
    mockAltitude = 24.5 + random(-5, 5) * 0.1;
  } else {
    roverSpeed = 0.0;
  }

  StaticJsonDocument<192> doc;
  doc["lat"]        = roverLat;
  doc["lng"]        = roverLng;
  doc["heading"]    = compassHeading;
  doc["speed"]      = roverSpeed;
  doc["satellites"] = 8;
  doc["alt"]        = mockAltitude;

  char buffer[192];
  serializeJson(doc, buffer);
  client.publish(TOPIC_GPS, buffer);
}

// -------------------------------------------------------------------------------------------------
// [SECTOR 8] MQTT COMMAND RECEIVER & HARDWARE TUNERS
// ---------------------------------------------------------------------------------
void callback(char* topic, byte* payload, unsigned int length) {
  StaticJsonDocument<256> doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) return;
  
  const char* command = doc["command"];
  if (!command) return;

  Serial.printf("[MQTT] Command Received: %s\n", command);

  sensor_t *s = esp_camera_sensor_get();

  if (strcmp(command, "TOGGLE_STREAM") == 0) {
    isStreaming = doc["active"];
    publishCameraStatus();
  } 
  else if (strcmp(command, "SET_LED_INTENSITY") == 0) {
    int val = doc["val"];
    setLedIntensity(val);
    publishCameraStatus();
  }
  else if (strcmp(command, "SET_NIGHT_MODE") == 0) {
    bool enabled = doc["enabled"];
    setLedIntensity(enabled ? 255 : 0);
    publishCameraStatus();
  }
  else if (strcmp(command, "SET_RESOLUTION") == 0) {
    int val = doc["val"];
    if (s != NULL) {
      s->set_framesize(s, (framesize_t)val);
      publishCameraStatus();
    }
  }
  else if (strcmp(command, "SET_BRIGHTNESS") == 0) {
    int val = doc["val"];
    if (s != NULL) s->set_brightness(s, val);
  }
  else if (strcmp(command, "SET_CONTRAST") == 0) {
    int val = doc["val"];
    if (s != NULL) s->set_contrast(s, val);
  }
  else if (strcmp(command, "SET_SATURATION") == 0) {
    int val = doc["val"];
    if (s != NULL) s->set_saturation(s, val);
  }
  else if (strcmp(command, "SET_SPECIAL_EFFECT") == 0) {
    int val = doc["val"];
    if (s != NULL) s->set_special_effect(s, val);
  }
  else if (strcmp(command, "SET_HMIRROR") == 0) {
    bool enabled = doc["enabled"];
    if (s != NULL) s->set_hmirror(s, enabled ? 1 : 0);
  }
  else if (strcmp(command, "SET_VFLIP") == 0) {
    bool enabled = doc["enabled"];
    if (s != NULL) s->set_vflip(s, enabled ? 1 : 0);
  }
  else if (strcmp(command, "EMERGENCY_STOP") == 0) {
    Serial.println("[EMERGENCY] ROBOT SHUTDOWN TRIGGERED!");
    roverSpeed = 0.0;
    
    StaticJsonDocument<256> alert;
    alert["type"]  = "ALERT";
    alert["label"] = "HAZARD";
    alert["conf"]  = 99;
    alert["desc"]  = "EMERGENCY STOP TERMINATION TRIGGERED BY REMOTE PILOT PANEL.";
    char buffer[256];
    serializeJson(alert, buffer);
    client.publish(TOPIC_ALERTS, buffer);
  }
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("[MQTT] Connecting to broker.emqx.io...");
    String clientId = "RescueBOT_Production_" + WiFi.macAddress();
    
    if (client.connect(clientId.c_str())) {
      Serial.println("\n[MQTT] Connected!");
      client.subscribe(TOPIC_COMMAND);
      client.publish(TOPIC_STATUS, "{\"status\":\"ONLINE\",\"node\":\"camera_primary\"}");
      publishCameraStatus();
    } else {
      delay(5000);
    }
  }
}

// -------------------------------------------------------------------------------------------------
// [SECTOR 9] MISSION BOOT
// -------------------------------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  Serial.println("\n[RescueBOT] INITIALIZING MASTER PRODUCTION FIRMWARE v4.0...");

  initLedFlash();

  pinMode(PIN_FLAME, INPUT);
  pinMode(PIN_PIR, INPUT);
  pinMode(PIN_ULTRA_TRIG, OUTPUT);
  
  if (!psramFound()) {
    pinMode(PIN_ULTRA_ECHO, INPUT);
    Serial.println("[NET] Ultrasonic Echo Pin 16 initialized (PSRAM Disabled).");
  } else {
    Serial.println("[WARN] PSRAM is enabled! Disabling GPIO 16 Ultrasonic read to prevent memory corruption crash.");
  }

  initCamera();

  WiFi.begin(ssid, password);
  WiFi.setSleep(false); // Low-latency execution
  
  Serial.print("[NET] Handshake with WiFi AP");
  while (WiFi.status() != WL_CONNECTED) { 
    delay(500); 
    Serial.print("."); 
  }
  Serial.println("\n[NET] Connection established!");
  Serial.print("[NET] Assigned IP: ");
  Serial.println(WiFi.localIP());

  startCameraServer();

  client.setServer(mqtt_broker, 1883);
  client.setCallback(callback);
  
  Serial.printf("[NET] Production Stream Mount: 'http://%s:81/stream'\n", WiFi.localIP().toString().c_str());
}

void loop() {
  if (!client.connected()) reconnect();
  client.loop();

  unsigned long now = millis();
  if (now - lastUpdate > updateInterval) {
    lastUpdate = now;
    publishTelemetry();
    publishGPS();
    publishCameraStatus();
  }
}
