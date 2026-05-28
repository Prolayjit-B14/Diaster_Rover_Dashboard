#include <WiFi.h>
#include <PubSubClient.h>
#include <HardwareSerial.h>
#include <TinyGPSPlus.h>
#include <ArduinoJson.h>

// -------------------------------------------------------------------------------------------------
// [CONFIG] NETWORK & CLOUD
// -------------------------------------------------------------------------------------------------
const char* ssid         = "YOUR_WIFI_SSID";
const char* password     = "YOUR_WIFI_PASSWORD";
const char* mqtt_broker  = "broker.emqx.io";

const char* TOPIC_TELEMETRY = "ares1/Robot/telemetry";

WiFiClient espClient;
PubSubClient client(espClient);

// -------------------------------------------------------------------------------------------------
// [CONFIG] GPS MODULE
// -------------------------------------------------------------------------------------------------
TinyGPSPlus gps;
HardwareSerial SerialGPS(1); // Use UART1 for GPS

unsigned long lastUpdate = 0;
const int updateInterval = 1000; // Publish telemetry every 1 second

// -------------------------------------------------------------------------------------------------
// [FUNCTIONS] MQTT & WIFI
// -------------------------------------------------------------------------------------------------
void reconnect() {
  while (!client.connected()) {
    Serial.print("[MQTT] Connecting to broker.emqx.io...");
    String clientId = "RescueBOT_GPS_Test_" + WiFi.macAddress();
    
    if (client.connect(clientId.c_str())) {
      Serial.println("\n[MQTT] Connected!");
    } else {
      delay(5000);
    }
  }
}

// -------------------------------------------------------------------------------------------------
// [MAIN] SETUP
// -------------------------------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  Serial.println("\n[RescueBOT] INITIALIZING GPS TEST FIRMWARE...");

  // Initialize GPS (RX Pin 16, TX Pin 17)
  #define GPS_RX 16
  #define GPS_TX 17
  SerialGPS.begin(9600, SERIAL_8N1, GPS_RX, GPS_TX); 
  Serial.println("[GPS] NEO-6M Module Initialized on pins 16 & 17.");

  // Initialize WiFi
  WiFi.begin(ssid, password);
  Serial.print("[NET] Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) { 
    delay(500); 
    Serial.print("."); 
  }
  Serial.println("\n[NET] WiFi Connected!");

  // Initialize MQTT
  client.setServer(mqtt_broker, 1883);
}

// -------------------------------------------------------------------------------------------------
// [MAIN] LOOP
// -------------------------------------------------------------------------------------------------
void loop() {
  if (!client.connected()) reconnect();
  client.loop();

  // 1. Continuously feed the GPS parser with incoming serial data
  while (SerialGPS.available() > 0) {
    gps.encode(SerialGPS.read());
  }

  // 2. Publish telemetry on a set interval
  unsigned long now = millis();
  if (now - lastUpdate > updateInterval) {
    lastUpdate = now;
    
    // Only publish if the GPS location has been successfully read and updated
    if (gps.location.isUpdated() || gps.location.isValid()) {
      StaticJsonDocument<256> doc;
      char buffer[256];
      
      // Format the exact JSON structure the Dashboard expects
      doc["sensor"] = "gps";
      
      JsonObject value = doc.createNestedObject("value");
      value["lat"] = gps.location.lat();
      value["lng"] = gps.location.lng();
      value["sats"] = gps.satellites.value();
      
      // Determine Fix Status
      if (gps.location.isValid() && gps.location.age() < 2000) {
        value["status"] = "3D FIX";
      } else {
        value["status"] = "ACQUIRING";
      }
      
      // Publish to broker
      serializeJson(doc, buffer);
      client.publish(TOPIC_TELEMETRY, buffer);
      
      Serial.printf("[MQTT] Sent GPS Coordinates: %s\n", buffer);
    } else {
      Serial.println("[GPS] Waiting for valid satellite fix...");
    }
  }
}
