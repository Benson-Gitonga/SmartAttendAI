// SmartAttend AI - school gate reader (Tier 2), simulated on Wokwi.
//
// ESP32 + MFRC522 card reader + SSD1306 OLED + two LEDs + buzzer. The two
// push buttons stand in for a fingerprint sensor: green = finger matches,
// red = wrong finger. Each scan is POSTed to the Tier 2 server's
// /api/rfid/scan, which decides whether a fingerprint check is needed.
//
// Wokwi's ESP32 reaches the internet, not your laptop, so SERVER_URL must be
// public: a cloudflared tunnel to localhost:3000, or the hosted server.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <Wire.h>
#include <MFRC522.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ArduinoJson.h>

// Paste the https://....trycloudflare.com link here (no trailing slash).
const char *SERVER_URL = "https://REPLACE-ME.trycloudflare.com";

const char *WIFI_SSID = "Wokwi-GUEST";
const char *WIFI_PASS = "";

// Pins (see diagram.json)
const int PIN_RFID_SS = 5;
const int PIN_RFID_RST = 4;
const int PIN_LED_GREEN = 25;
const int PIN_LED_RED = 26;
const int PIN_BUZZER = 27;
const int PIN_BTN_MATCH = 32;
const int PIN_BTN_NO_MATCH = 33;

const unsigned long FINGER_TIMEOUT_MS = 10000;
const unsigned long SAME_CARD_IGNORE_MS = 2500;

MFRC522 rfid(PIN_RFID_SS, PIN_RFID_RST);
Adafruit_SSD1306 oled(128, 64, &Wire, -1);

String lastUid;
unsigned long lastUidAt = 0;

struct ScanReply {
  int httpStatus;  // <= 0 means the request never reached the server
  String outcome;  // recorded | duplicate | rejected | unknown-card | fingerprint-required
  String name;
  bool verified;
};

void show(const String &title, const String &line2 = "", const String &line3 = "") {
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(1);
  oled.setCursor(0, 0);
  oled.println("SmartAttend Gate");
  oled.drawFastHLine(0, 10, 128, SSD1306_WHITE);
  oled.setCursor(0, 16);
  oled.setTextSize(title.length() <= 10 ? 2 : 1);
  oled.println(title);
  oled.setTextSize(1);
  oled.setCursor(0, 40);
  oled.println(line2);
  oled.setCursor(0, 52);
  oled.println(line3);
  oled.display();
}

void idleScreen() {
  digitalWrite(PIN_LED_GREEN, LOW);
  digitalWrite(PIN_LED_RED, LOW);
  show("Tap card", "Hold your card", "near the reader");
}

void beep(int freq, int ms) {
  tone(PIN_BUZZER, freq, ms);
  delay(ms + 30);
}

String readUid() {
  String uid;
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(rfid.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();
  return uid;
}

ScanReply postScan(const String &uid, const char *fingerprint) {
  ScanReply reply = {0, "", "", false};

  JsonDocument body;
  body["cardUid"] = uid;
  body["interactive"] = true;
  if (fingerprint) body["fingerprint"] = fingerprint;
  String payload;
  serializeJson(body, payload);

  WiFiClientSecure secure;
  WiFiClient plain;
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/rfid/scan";
  if (url.startsWith("https")) {
    secure.setInsecure();  // demo only: skip certificate checks
    http.begin(secure, url);
  } else {
    http.begin(plain, url);
  }
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(8000);

  reply.httpStatus = http.POST(payload);
  if (reply.httpStatus > 0) {
    JsonDocument filter;
    filter["outcome"] = true;
    filter["challenged"] = true;
    filter["student"]["full_name"] = true;

    JsonDocument res;
    if (!deserializeJson(res, http.getString(), DeserializationOption::Filter(filter))) {
      reply.outcome = res["outcome"] | "";
      reply.name = res["student"]["full_name"] | "";
      reply.verified = res["challenged"] | false;
    }
  }
  http.end();
  Serial.printf("[scan] %s fp=%s -> HTTP %d %s %s\n", uid.c_str(), fingerprint ? fingerprint : "-",
                reply.httpStatus, reply.outcome.c_str(), reply.name.c_str());
  return reply;
}

// Returns "match", "no_match", or nullptr on timeout.
const char *waitForFinger() {
  unsigned long start = millis();
  while (millis() - start < FINGER_TIMEOUT_MS) {
    if (digitalRead(PIN_BTN_MATCH) == LOW) return "match";
    if (digitalRead(PIN_BTN_NO_MATCH) == LOW) return "no_match";
    // blink both LEDs while waiting
    bool on = ((millis() - start) / 300) % 2;
    digitalWrite(PIN_LED_GREEN, on);
    digitalWrite(PIN_LED_RED, on);
    delay(20);
  }
  return nullptr;
}

String firstName(const String &fullName) {
  int space = fullName.indexOf(' ');
  return space > 0 ? fullName.substring(0, space) : fullName;
}

void showResult(const ScanReply &r) {
  digitalWrite(PIN_LED_GREEN, LOW);
  digitalWrite(PIN_LED_RED, LOW);

  if (r.httpStatus <= 0) {
    digitalWrite(PIN_LED_RED, HIGH);
    show("Offline", "Server unreachable", "Check SERVER_URL");
    beep(200, 600);
  } else if (r.outcome == "recorded") {
    digitalWrite(PIN_LED_GREEN, HIGH);
    show("Welcome", r.name, r.verified ? "Present - fingerprint OK" : "Present");
    beep(2000, 120);
  } else if (r.outcome == "duplicate") {
    digitalWrite(PIN_LED_GREEN, HIGH);
    show("Already in", r.name, "Scanned in today");
    beep(1500, 80);
    beep(1500, 80);
  } else if (r.outcome == "rejected") {
    digitalWrite(PIN_LED_RED, HIGH);
    show("REJECTED", "Fingerprint does not", "match " + firstName(r.name));
    beep(300, 800);
  } else if (r.outcome == "unknown-card") {
    digitalWrite(PIN_LED_RED, HIGH);
    show("Unknown", "Card not registered", "See the office");
    beep(300, 400);
  } else {
    digitalWrite(PIN_LED_RED, HIGH);
    show("Error", "HTTP " + String(r.httpStatus), r.outcome);
    beep(300, 400);
  }
  delay(2500);
  idleScreen();
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_BTN_MATCH, INPUT_PULLUP);
  pinMode(PIN_BTN_NO_MATCH, INPUT_PULLUP);

  oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  show("Starting", "Connecting to WiFi");

  SPI.begin();
  rfid.PCD_Init();

  WiFi.begin(WIFI_SSID, WIFI_PASS, 6);
  while (WiFi.status() != WL_CONNECTED) delay(100);
  Serial.printf("WiFi connected, server: %s\n", SERVER_URL);
  idleScreen();
}

void loop() {
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;

  String uid = readUid();
  rfid.PICC_HaltA();

  // A held card is read again and again; treat it as one tap.
  if (uid == lastUid && millis() - lastUidAt < SAME_CARD_IGNORE_MS) return;
  lastUid = uid;

  show("Reading", "Card " + uid, "Please wait...");
  ScanReply reply = postScan(uid, nullptr);

  if (reply.outcome == "fingerprint-required") {
    show("Finger", "Hi " + firstName(reply.name) + ", place", "finger (green/red)");
    beep(1000, 60);
    const char *finger = waitForFinger();
    if (!finger) {
      show("Timed out", "No finger placed", "Tap your card again");
      beep(300, 300);
      delay(2000);
      idleScreen();
      lastUidAt = millis();
      return;
    }
    show("Checking", "Fingerprint...");
    reply = postScan(uid, finger);
  }

  showResult(reply);
  lastUidAt = millis();
}
