// SmartAttend AI - school gate reader (Tier 2), simulated on Wokwi.
//
// ESP32 + MFRC522 card reader + SSD1306 OLED + two LEDs + buzzer. The two
// push buttons stand in for a fingerprint sensor: green = finger matches,
// red = wrong finger. The slide switch pulls the gate's Wi-Fi to show what
// happens when the network is down.
//
// Online, each tap is POSTed to the Tier 2 server's /api/rfid/scan, which
// decides whether a fingerprint check is needed. Offline (Wi-Fi off, or the
// server unreachable) taps are saved to flash with the time they happened and
// replayed in order when the server is back, so no arrival is lost.
//
// Wokwi's ESP32 reaches the internet, not your laptop, so SERVER_URL must be
// public: a cloudflared tunnel to localhost:3000, or the hosted server.
//
// Serial monitor commands: s = status, q = list queue, c = clear queue, h = help.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <Wire.h>
#include <MFRC522.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <esp_random.h>
#include <time.h>
#include <esp_arduino_version.h>
#include <vector>

// ---------------------------------------------------------------- settings

// Paste the https://....trycloudflare.com link here (no trailing slash).
const char *SERVER_URL = "https://REPLACE-ME.trycloudflare.com";

// Must match DEVICE_API_KEY in server/.env. Leave empty if the server has none.
const char *DEVICE_KEY = "";

// Shows up in the server's audit log for every offline replay.
const char *DEVICE_ID = "gate-main";

const char *WIFI_SSID = "Wokwi-GUEST";
const char *WIFI_PASS = "";
const int WIFI_CHANNEL = 6;  // Wokwi-GUEST; skips the channel scan

// East Africa Time, UTC+3, no daylight saving.
const long UTC_OFFSET_SECONDS = 3 * 3600;
const char *NTP_SERVER_1 = "pool.ntp.org";
const char *NTP_SERVER_2 = "time.google.com";

// ---------------------------------------------------------------- pins (see diagram.json)

const int PIN_RFID_SS = 5;
const int PIN_RFID_RST = 4;
const int PIN_LED_GREEN = 25;
const int PIN_LED_RED = 26;
const int PIN_BUZZER = 27;
const int PIN_BTN_MATCH = 32;
const int PIN_BTN_NO_MATCH = 33;
const int PIN_WIFI_SWITCH = 14;  // LOW = Wi-Fi pulled (switch towards "down")

// ---------------------------------------------------------------- timings

const unsigned long FINGER_TIMEOUT_MS = 10000;
const unsigned long SAME_CARD_IGNORE_MS = 2500;   // a card held on the reader
const unsigned long RESULT_SHOW_MS = 2500;
const unsigned long HTTP_TIMEOUT_MS = 5000;
const unsigned long SERVER_RETRY_MS = 20000;      // after the server didn't answer
const unsigned long AUTH_RETRY_MS = 60000;        // after a 401, a config problem
const unsigned long FLUSH_GAP_MS = 300;           // between queued uploads
const unsigned long BUTTON_DEBOUNCE_MS = 30;
const unsigned long SWITCH_DEBOUNCE_MS = 50;
const size_t QUEUE_MAX = 100;  // ~7 KB of the 20 KB NVS partition
const time_t CLOCK_VALID_AFTER = 1700000000;  // 2023-11-14; before that NTP hasn't answered

// ---------------------------------------------------------------- types
// Up here, before any function, because the Arduino build generates function
// prototypes at the first function and they need these names.

// A tap waiting in the offline queue.
struct QueuedScan {
  String scanId;
  String cardUid;
  uint32_t epoch;     // when it was tapped; 0 if the clock wasn't set yet
  uint32_t atMillis;  // millis() at the tap, to date it once the clock is set
  uint32_t bootId;    // atMillis only means something within the same boot
};

// What the server said about one scan.
struct ScanReply {
  int httpStatus;  // <= 0 means the request never reached the server
  String outcome;  // recorded | duplicate | rejected | unknown-card | fingerprint-required
  String name;
  bool verified;
  String error;
};

MFRC522 rfid(PIN_RFID_SS, PIN_RFID_RST);
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
Preferences prefs;

// ================================================================ beeper
// Plays a short pattern of tones without blocking the loop.

struct Note {
  uint16_t freq;  // 0 = silence
  uint16_t ms;
};

const Note BEEP_OK[] = {{2000, 120}};
const Note BEEP_ALREADY_IN[] = {{1500, 80}, {0, 70}, {1500, 80}};
const Note BEEP_REJECTED[] = {{300, 800}};
const Note BEEP_UNKNOWN[] = {{300, 400}};
const Note BEEP_PROMPT[] = {{1000, 60}};
const Note BEEP_QUEUED[] = {{1200, 70}, {0, 50}, {900, 120}};
const Note BEEP_ERROR[] = {{200, 600}};

// Drives the buzzer through the LEDC PWM peripheral directly. tone()/noTone()
// logged "LEDC is not initialized" when a pattern started with a silence.
// The LEDC API changed in Arduino-ESP32 3.x (browser Wokwi) from 2.x (PlatformIO).
class Beeper {
 public:
  explicit Beeper(int pin) : pin_(pin) {}

  void begin() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcAttach(pin_, 2000, 8);
#else
    ledcSetup(CHANNEL, 2000, 8);
    ledcAttachPin(pin_, CHANNEL);
#endif
    write(0);
    ready_ = true;
  }

  void play(const Note *notes, uint8_t count) {
    if (!ready_) return;
    notes_ = notes;
    count_ = count;
    index_ = 0;
    startNote();
  }

  void update() {
    if (!notes_ || millis() < noteEndsAt_) return;
    index_++;
    if (index_ >= count_) {
      write(0);
      notes_ = nullptr;
      return;
    }
    startNote();
  }

 private:
  static const uint8_t CHANNEL = 0;

  void write(uint32_t freq) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcWriteTone(pin_, freq);
#else
    ledcWriteTone(CHANNEL, freq);
#endif
  }

  void startNote() {
    write(notes_[index_].freq);  // 0 = silence
    noteEndsAt_ = millis() + notes_[index_].ms;
  }

  int pin_;
  bool ready_ = false;
  const Note *notes_ = nullptr;
  uint8_t count_ = 0;
  uint8_t index_ = 0;
  unsigned long noteEndsAt_ = 0;
};

#define PLAY(pattern) beeper.play(pattern, sizeof(pattern) / sizeof(pattern[0]))

Beeper beeper(PIN_BUZZER);

// ================================================================ clock

bool clockValid() { return time(nullptr) > CLOCK_VALID_AFTER; }

// "2026-10-12T04:20:05Z" - what the server expects in scannedAt.
String isoUtc(time_t t) {
  struct tm tmUtc;
  gmtime_r(&t, &tmUtc);
  char buf[24];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tmUtc);
  return String(buf);
}

// School-local date, for spotting a card tapped twice on one day while offline.
String localDate(time_t t) {
  struct tm tmLocal;
  localtime_r(&t, &tmLocal);
  char buf[11];
  strftime(buf, sizeof(buf), "%Y-%m-%d", &tmLocal);
  return String(buf);
}

String localClock() {
  if (!clockValid()) return "--:--";
  time_t now = time(nullptr);
  struct tm tmLocal;
  localtime_r(&now, &tmLocal);
  char buf[6];
  strftime(buf, sizeof(buf), "%H:%M", &tmLocal);
  return String(buf);
}

// ================================================================ ids

// Random (version 4) UUID; the server uses it as the attendance event id, so a
// queued scan that is sent twice is only recorded once.
String newUuid() {
  uint8_t b[16];
  esp_fill_random(b, sizeof(b));
  b[6] = (b[6] & 0x0F) | 0x40;
  b[8] = (b[8] & 0x3F) | 0x80;
  char out[37];
  snprintf(out, sizeof(out), "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x", b[0], b[1],
           b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]);
  return String(out);
}

// ================================================================ offline queue
// Scans that could not reach the server. Kept in RAM and mirrored to the
// ESP32's NVS flash (the same store Preferences uses) after every change, so
// a power cut doesn't lose them. NVS rather than a LittleFS file because every
// ESP32 partition layout has it, including the one Wokwi's VS Code runner uses.

// Fixed-size form of QueuedScan, written to NVS as one blob.
struct StoredScan {
  char scanId[37];
  char cardUid[21];
  uint32_t epoch;
  uint32_t atMillis;
  uint32_t bootId;
};

std::vector<QueuedScan> queue;
Preferences queueStore;
bool flashOk = false;
uint32_t bootId = 0;
uint32_t syncedThisRun = 0;

void saveQueue() {
  if (!flashOk) return;
  if (queue.empty()) {
    if (queueStore.isKey("scans")) queueStore.remove("scans");
    return;
  }
  std::vector<StoredScan> out(queue.size());
  for (size_t i = 0; i < queue.size(); i++) {
    StoredScan &o = out[i];
    memset(&o, 0, sizeof(o));
    strlcpy(o.scanId, queue[i].scanId.c_str(), sizeof(o.scanId));
    strlcpy(o.cardUid, queue[i].cardUid.c_str(), sizeof(o.cardUid));
    o.epoch = queue[i].epoch;
    o.atMillis = queue[i].atMillis;
    o.bootId = queue[i].bootId;
  }
  size_t bytes = out.size() * sizeof(StoredScan);
  if (queueStore.putBytes("scans", out.data(), bytes) != bytes) {
    Serial.println("[queue] could not write flash, keeping the queue in RAM only");
  }
}

void loadQueue() {
  queue.clear();
  if (!flashOk) return;
  if (!queueStore.isKey("scans")) return;  // first boot, nothing saved yet
  size_t bytes = queueStore.getBytesLength("scans");
  if (bytes == 0 || bytes % sizeof(StoredScan) != 0) return;  // nothing saved, or an older format
  std::vector<StoredScan> in(bytes / sizeof(StoredScan));
  queueStore.getBytes("scans", in.data(), bytes);
  for (const StoredScan &o : in) {
    queue.push_back({String(o.scanId), String(o.cardUid), o.epoch, o.atMillis, o.bootId});
  }
}

// Was this card already saved offline for the same day? Then it's "already in".
bool queuedSameDay(const String &uid, time_t epoch) {
  if (!epoch) return false;
  String day = localDate(epoch);
  for (const QueuedScan &q : queue) {
    if (q.cardUid == uid && q.epoch && localDate(q.epoch) == day) return true;
  }
  return false;
}

// Scans taken before NTP answered get their real time once it does.
void dateUndatedScans() {
  if (!clockValid()) return;
  time_t now = time(nullptr);
  bool changed = false;
  for (QueuedScan &q : queue) {
    if (q.epoch == 0 && q.bootId == bootId) {
      q.epoch = now - (millis() - q.atMillis) / 1000;
      changed = true;
    }
  }
  if (changed) saveQueue();
}

// ================================================================ network state

bool wifiEnabled = true;          // the slide switch
unsigned long serverRetryAt = 0;  // don't try the server again before this
unsigned long nextFlushAt = 0;

bool wifiUp() { return wifiEnabled && WiFi.status() == WL_CONNECTED; }
bool serverReachable() { return wifiUp() && millis() >= serverRetryAt; }
void markServerDown(unsigned long forMs = SERVER_RETRY_MS) { serverRetryAt = millis() + forMs; }

void setWifi(bool enabled) {
  wifiEnabled = enabled;
  if (enabled) {
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS, WIFI_CHANNEL);
    serverRetryAt = 0;
    Serial.println("[wifi] switch on, reconnecting");
  } else {
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
    Serial.println("[wifi] switch off, gate is offline - taps will be queued");
  }
}

// ================================================================ server

// 5xx from the tunnel (server stopped) counts as unreachable, like no answer at all.
bool networkFailure(const ScanReply &r) { return r.httpStatus <= 0 || r.httpStatus >= 500; }

ScanReply postScan(JsonDocument &body) {
  ScanReply reply = {0, "", "", false, ""};
  body["deviceId"] = DEVICE_ID;
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
  if (DEVICE_KEY[0]) http.addHeader("X-Device-Key", DEVICE_KEY);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setConnectTimeout(HTTP_TIMEOUT_MS);

  reply.httpStatus = http.POST(payload);
  if (reply.httpStatus > 0) {
    JsonDocument filter;
    filter["outcome"] = true;
    filter["challenged"] = true;
    filter["error"] = true;
    filter["student"]["full_name"] = true;

    JsonDocument res;
    if (!deserializeJson(res, http.getString(), DeserializationOption::Filter(filter))) {
      reply.outcome = res["outcome"] | "";
      reply.name = res["student"]["full_name"] | "";
      reply.verified = res["challenged"] | false;
      reply.error = res["error"] | "";
    }
  }
  http.end();

  Serial.printf("[http] %s -> %d %s %s %s\n", payload.c_str(), reply.httpStatus, reply.outcome.c_str(),
                reply.name.c_str(), reply.error.c_str());
  return reply;
}

ScanReply sendLiveScan(const String &uid, const String &scanId, time_t epoch, const char *fingerprint) {
  JsonDocument body;
  body["cardUid"] = uid;
  body["interactive"] = true;
  body["scanId"] = scanId;
  if (epoch) body["scannedAt"] = isoUtc(epoch);
  if (fingerprint) body["fingerprint"] = fingerprint;
  return postScan(body);
}

ScanReply sendQueuedScan(const QueuedScan &q) {
  JsonDocument body;
  body["cardUid"] = q.cardUid;
  body["offline"] = true;
  body["scanId"] = q.scanId;
  body["scannedAt"] = isoUtc(q.epoch);
  return postScan(body);
}

// ================================================================ screen

void drawStatusBar() {
  oled.setTextSize(1);
  oled.setCursor(0, 0);
  oled.print("Gate ");
  oled.print(localClock());
  oled.print(wifiUp() ? (serverReachable() ? " ONLINE" : " NO SRV") : " OFFLN ");
  if (!queue.empty()) {
    oled.print(" Q");
    oled.print(queue.size());
  }
  oled.drawFastHLine(0, 10, 128, SSD1306_WHITE);
}

void show(const String &title, const String &line2 = "", const String &line3 = "") {
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  drawStatusBar();
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

void lights(bool green, bool red) {
  digitalWrite(PIN_LED_GREEN, green);
  digitalWrite(PIN_LED_RED, red);
}

String firstName(const String &fullName) {
  int space = fullName.indexOf(' ');
  return space > 0 ? fullName.substring(0, space) : fullName;
}

// ================================================================ gate flow
// IDLE -> (tap) -> WAIT_FINGER? -> SHOW_RESULT -> IDLE. Nothing here blocks
// except the HTTP call itself, so taps, buttons and beeps keep working.

enum Mode { IDLE, WAIT_FINGER, SHOW_RESULT };
Mode mode = IDLE;
unsigned long modeStartedAt = 0;
unsigned long modeUntil = 0;
String idleSignature;  // what the idle screen last drew, to redraw only on change

// The tap waiting for a finger.
String pendingUid;
String pendingScanId;
String pendingName;
time_t pendingEpoch = 0;

String lastUid;
unsigned long lastUidAt = 0;

void enterIdle() {
  mode = IDLE;
  lights(false, false);
  idleSignature = "";  // force a redraw
}

void showResultFor(unsigned long ms = RESULT_SHOW_MS) {
  mode = SHOW_RESULT;
  modeStartedAt = millis();
  modeUntil = millis() + ms;
}

void drawIdle() {
  String line3 = syncedThisRun ? "Synced " + String(syncedThisRun) + " offline scan(s)" : "near the reader";
  String sig = localClock() + "|" + String(wifiUp() ? 1 : 0) + String(serverReachable() ? 1 : 0) + "|" +
               String((unsigned)queue.size()) + "|" + line3;
  if (sig == idleSignature) return;
  idleSignature = sig;
  if (!queue.empty() && !serverReachable()) {
    show("Tap card", "Offline: " + String(queue.size()) + " saved", "Will sync when back");
  } else {
    show("Tap card", "Hold your card", line3);
  }
}

void queueTap(const String &uid, const String &scanId, time_t epoch, unsigned long atMillis) {
  if (queuedSameDay(uid, epoch)) {
    lights(true, false);
    show("Already in", "Card " + uid, "Saved offline before");
    PLAY(BEEP_ALREADY_IN);
    showResultFor();
    return;
  }
  if (queue.size() >= QUEUE_MAX) {
    lights(false, true);
    show("Queue full", "Cannot save scan", "Reconnect the gate");
    PLAY(BEEP_ERROR);
    showResultFor();
    return;
  }
  queue.push_back({scanId, uid, (uint32_t)epoch, (uint32_t)atMillis, bootId});
  saveQueue();
  Serial.printf("[queue] saved %s at %s (%u waiting)\n", uid.c_str(), epoch ? isoUtc(epoch).c_str() : "unknown time",
                (unsigned)queue.size());

  lights(true, false);
  show("Saved", "Offline - card only", String(queue.size()) + " waiting to sync");
  PLAY(BEEP_QUEUED);
  showResultFor();
}

void showOutcome(const ScanReply &r) {
  if (r.outcome == "recorded") {
    lights(true, false);
    show("Welcome", r.name, r.verified ? "Present - fingerprint OK" : "Present");
    PLAY(BEEP_OK);
  } else if (r.outcome == "duplicate") {
    lights(true, false);
    show("Already in", r.name, "Scanned in today");
    PLAY(BEEP_ALREADY_IN);
  } else if (r.outcome == "rejected") {
    lights(false, true);
    show("REJECTED", "Fingerprint does not", "match " + firstName(r.name));
    PLAY(BEEP_REJECTED);
  } else if (r.outcome == "unknown-card") {
    lights(false, true);
    show("Unknown", "Card not registered", "See the office");
    PLAY(BEEP_UNKNOWN);
  } else if (r.httpStatus == 401) {
    lights(false, true);
    show("Not allowed", "Server refused the", "device key");
    PLAY(BEEP_ERROR);
  } else {
    lights(false, true);
    show("Error", "HTTP " + String(r.httpStatus), r.error.length() ? r.error : r.outcome);
    PLAY(BEEP_ERROR);
  }
  showResultFor();
}

void handleTap(const String &uid) {
  // A held card is read again and again; treat it as one tap.
  if (uid == lastUid && millis() - lastUidAt < SAME_CARD_IGNORE_MS) return;
  lastUid = uid;
  lastUidAt = millis();

  String scanId = newUuid();
  time_t epoch = clockValid() ? time(nullptr) : 0;
  unsigned long atMillis = millis();

  if (!serverReachable()) {
    queueTap(uid, scanId, epoch, atMillis);
    return;
  }

  show("Reading", "Card " + uid, "Please wait...");
  ScanReply reply = sendLiveScan(uid, scanId, epoch, nullptr);

  if (networkFailure(reply)) {
    markServerDown();
    queueTap(uid, scanId, epoch, atMillis);
    return;
  }

  if (reply.outcome == "fingerprint-required") {
    pendingUid = uid;
    pendingScanId = scanId;
    pendingName = reply.name;
    pendingEpoch = epoch;
    mode = WAIT_FINGER;
    modeStartedAt = millis();
    show("Finger", "Hi " + firstName(reply.name) + ", place", "finger (green/red)");
    PLAY(BEEP_PROMPT);
    return;
  }

  showOutcome(reply);
}

// Pressed for at least BUTTON_DEBOUNCE_MS, so contact bounce on a real
// button can't count as a press.
bool buttonPressed(int pin, unsigned long &lowSince) {
  if (digitalRead(pin) == HIGH) {
    lowSince = 0;
    return false;
  }
  if (!lowSince) lowSince = millis();
  return millis() - lowSince >= BUTTON_DEBOUNCE_MS;
}

void updateWaitFinger() {
  static unsigned long matchLowSince = 0;
  static unsigned long noMatchLowSince = 0;

  unsigned long waited = millis() - modeStartedAt;
  bool on = (waited / 300) % 2;
  lights(on, on);

  const char *finger = nullptr;
  if (buttonPressed(PIN_BTN_MATCH, matchLowSince)) finger = "match";
  else if (buttonPressed(PIN_BTN_NO_MATCH, noMatchLowSince)) finger = "no_match";

  if (finger) {
    matchLowSince = noMatchLowSince = 0;
    show("Checking", "Fingerprint...");
    ScanReply reply = sendLiveScan(pendingUid, pendingScanId, pendingEpoch, finger);
    if (networkFailure(reply)) {
      // Lost the server between the tap and the finger: keep the arrival as a card-only scan.
      markServerDown();
      queueTap(pendingUid, pendingScanId, pendingEpoch, millis());
    } else {
      showOutcome(reply);
    }
    lastUidAt = millis();
    return;
  }

  if (waited >= FINGER_TIMEOUT_MS) {
    lights(false, true);
    show("Timed out", "No finger placed", "Tap your card again");
    PLAY(BEEP_UNKNOWN);
    showResultFor(2000);
  }
}

// Upload one queued scan per call, oldest first, so a long queue never stops
// the gate from taking new taps.
void flushQueue() {
  if (queue.empty() || !serverReachable() || millis() < nextFlushAt) return;
  nextFlushAt = millis() + FLUSH_GAP_MS;

  QueuedScan &q = queue.front();
  if (q.epoch == 0) {
    if (q.bootId != bootId) {
      // Tapped before NTP answered, then the gate restarted: there is no way to
      // know when it happened, and an undated record would be worse than none.
      Serial.printf("[queue] dropped %s: no time and the gate restarted since\n", q.cardUid.c_str());
      queue.erase(queue.begin());
      saveQueue();
    }
    return;  // wait for the clock (dateUndatedScans fills it in)
  }

  ScanReply r = sendQueuedScan(q);
  if (networkFailure(r)) {
    markServerDown();
    return;
  }
  if (r.httpStatus == 401) {
    markServerDown(AUTH_RETRY_MS);
    Serial.println("[queue] server refused the device key - check DEVICE_KEY");
    return;
  }

  // Recorded, duplicate, unknown card, or a scan the server won't take (too old):
  // all final, so it leaves the queue either way.
  Serial.printf("[queue] %s -> %d %s %s\n", q.cardUid.c_str(), r.httpStatus, r.outcome.c_str(), r.error.c_str());
  if (r.outcome == "recorded") syncedThisRun++;
  queue.erase(queue.begin());
  saveQueue();
}

// ================================================================ inputs

void pollWifiSwitch() {
  static int lastReading = HIGH;
  static unsigned long changedAt = 0;
  int reading = digitalRead(PIN_WIFI_SWITCH);
  if (reading != lastReading) {
    lastReading = reading;
    changedAt = millis();
  }
  bool wantOn = lastReading == HIGH;
  if (wantOn != wifiEnabled && millis() - changedAt >= SWITCH_DEBOUNCE_MS) setWifi(wantOn);
}

void pollCard() {
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;
  String uid;
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(rfid.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();
  rfid.PICC_HaltA();
  handleTap(uid);
}

void printStatus() {
  Serial.printf("wifi switch %s, wifi %s, server %s, clock %s, queue %u, synced this run %u, flash %s\n",
                wifiEnabled ? "on" : "off", WiFi.status() == WL_CONNECTED ? "connected" : "down",
                serverReachable() ? "reachable" : "backing off", clockValid() ? isoUtc(time(nullptr)).c_str() : "not set",
                (unsigned)queue.size(), (unsigned)syncedThisRun, flashOk ? "ok" : "unavailable (RAM only)");
}

void handleSerial() {
  if (!Serial.available()) return;
  char c = Serial.read();
  switch (c) {
    case 's':
      printStatus();
      break;
    case 'q':
      if (queue.empty()) Serial.println("[queue] empty");
      for (size_t i = 0; i < queue.size(); i++) {
        Serial.printf("  %u. %s at %s (scan %s)\n", (unsigned)(i + 1), queue[i].cardUid.c_str(),
                      queue[i].epoch ? isoUtc(queue[i].epoch).c_str() : "unknown time", queue[i].scanId.c_str());
      }
      break;
    case 'c':
      queue.clear();
      saveQueue();
      idleSignature = "";
      Serial.println("[queue] cleared");
      break;
    case 'h':
      Serial.println("s = status, q = list queue, c = clear queue, h = help");
      break;
    default:
      break;  // newlines etc.
  }
}

// ================================================================ setup / loop

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_BTN_MATCH, INPUT_PULLUP);
  pinMode(PIN_BTN_NO_MATCH, INPUT_PULLUP);
  pinMode(PIN_WIFI_SWITCH, INPUT_PULLUP);

  oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  show("Starting", "Loading saved scans");

  prefs.begin("gate", false);
  bootId = prefs.getUInt("boot", 0) + 1;
  prefs.putUInt("boot", bootId);

  beeper.begin();
  flashOk = queueStore.begin("scanq", false);
  loadQueue();
  Serial.printf("Boot %u, %u scan(s) waiting from before\n", (unsigned)bootId, (unsigned)queue.size());

  SPI.begin();
  rfid.PCD_Init();

  configTime(UTC_OFFSET_SECONDS, 0, NTP_SERVER_1, NTP_SERVER_2);

  wifiEnabled = digitalRead(PIN_WIFI_SWITCH) == HIGH;
  if (wifiEnabled) {
    setWifi(true);
    show("Starting", "Connecting to WiFi");
    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) delay(100);  // setup only
  } else {
    setWifi(false);
  }
  Serial.printf("Server: %s  (type h for commands)\n", SERVER_URL);
  enterIdle();
}

void loop() {
  beeper.update();
  handleSerial();
  pollWifiSwitch();
  dateUndatedScans();

  switch (mode) {
    case WAIT_FINGER:
      updateWaitFinger();
      return;  // the reader waits until this student is done
    case SHOW_RESULT:
      if (millis() >= modeUntil) enterIdle();
      break;
    case IDLE:
      break;
  }

  pollCard();  // a new tap cuts a result screen short

  if (mode == IDLE) {
    flushQueue();
    drawIdle();
  }
}
