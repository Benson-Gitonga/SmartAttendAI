# Simulated school gate (Wokwi)

The Tier 2 gate reader without hardware: an ESP32 with an MFRC522 card reader,
an OLED, two LEDs and a buzzer, simulated in the browser on
[wokwi.com](https://wokwi.com) (free account). The green and red buttons stand
in for a fingerprint sensor. Every tap is sent to the real Tier 2 server, so it
shows up in the teacher's register on the PWA.

```
Wokwi ESP32 -> internet -> https://xxxx.trycloudflare.com -> cloudflared -> localhost:3000
```

Wokwi's ESP32 reaches the internet, not your laptop, so the server needs a
public URL. A free [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
quick tunnel gives it one. Once the server is hosted, use the hosted URL instead.

## Run it

Both ways need the server and a tunnel first:

1. Start the server: `cd server && npm run dev`
2. In a second terminal: `cloudflared tunnel --url http://localhost:3000`
   and copy the `https://....trycloudflare.com` link it prints.
   (Install once with `winget install Cloudflare.cloudflared`.)
3. Paste the link into `SERVER_URL` at the top of `src/sketch.ino`.

The tunnel link changes every time cloudflared restarts, so repeat step 3
after a restart.

### In VS Code (PlatformIO + Wokwi extensions)

1. **File > Open Folder** and open `hardware/wokwi-gate` itself, not the repo root.
2. Build: the tick icon in the PlatformIO bottom bar, or `pio run`. The first
   build downloads the ESP32 toolchain and takes several minutes.
3. Open `diagram.json` and press the play button, or F1 > **Wokwi: Start Simulator**.
   Rebuild after every change to `sketch.ino`.

### In the browser (wokwi.com)

**New project > ESP32 (Arduino)**, then replace `sketch.ino` with
`src/sketch.ino` and `diagram.json` with the one here, add a `libraries.txt`
tab with the contents of `libraries.txt`, and press Run.

Open the PWA register for Form 3B (Kibera Secondary) next to it.

## Cards

Click the reader to open its panel, pick a card, then **Tap**.

| Wokwi card | UID | Student |
|---|---|---|
| Blue Card | `01020304` | Jack Otieno |
| Green Card | `11223344` | Kevin Odhiambo |
| Yellow Card | `55667788` | Lydia Chebet |
| Red Card | `AABBCCDD` | Moses Kipchoge |
| NFC Tag | `04112233445566` | Naomi Waweru |
| Key Fob | `C0FFEE99` | not registered |

## Demo script

| Do this | Gate shows | Teacher app |
|---|---|---|
| Tap Blue | "Welcome, Jack Otieno" (green LED, beep) | Jack ticked at gate |
| Tap Green; if asked for a finger, press the green button | "Present - fingerprint OK" | Kevin ticked, verified |
| Tap Blue again | "Already in" | no second record |
| Tap Red; if asked for a finger, press the red button | "REJECTED" (red LED, long beep) | Moses not ticked; audit log keeps the attempt |
| Tap Key Fob | "Unknown - card not registered" | nothing |

The server picks about 1 in 4 scans for a fingerprint check
(`FINGERPRINT_CHALLENGE_RATE`). Set it to `1` in `server/.env` for the demo so
every tap asks for a finger, which lets you show the rejection on demand.

### Offline first

| Do this | Gate shows | Teacher app |
|---|---|---|
| Slide the Wi-Fi switch right | top bar says `OFFLN` | - |
| Tap Yellow, then NFC Tag | "Saved - offline, card only" and a two-tone beep; top bar `Q1`, `Q2` | nothing yet |
| Tap Yellow again | "Already in - saved offline before" | - |
| Slide the switch left | reconnects, then "Synced 2 offline scan(s)" | Lydia and Naomi ticked, at the time they tapped |

Offline taps are saved to the ESP32's flash with the time they happened (from
NTP), so they survive a restart and land on the right day even if they are
sent the next morning. They are recorded as card-only: the server can't ask
for a fingerprint while it can't be reached. Each one leaves an
`rfid.offline_scan` row in the audit log with how late it arrived.

The gate also queues taps if Wi-Fi is up but the server is not (stop the
server or the tunnel to try it), and retries every 20 seconds.

Type in the serial monitor: `s` status, `q` list the queue, `c` clear it.

## Device key

To stop anyone who finds the tunnel link from posting scans, set a key in
`server/.env`:

```
DEVICE_API_KEY=some-long-random-string
```

and the same value in `DEVICE_KEY` at the top of `src/sketch.ino`. Without
it the gate shows "Not allowed" and the server answers 401.

## How the firmware is laid out

`src/sketch.ino` runs a small state machine (idle, waiting for a finger,
showing a result) driven by `millis()` timers, so the beeper, the LEDs, the
buttons and the reader keep working while a result is on screen. Only the HTTP
call itself blocks, for at most 5 seconds. The queue uploads one scan per pass
through the loop, oldest first, so a long queue never stops new taps.
