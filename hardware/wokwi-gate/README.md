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

1. Start the server: `cd server && npm run dev`
2. In a second terminal: `cloudflared tunnel --url http://localhost:3000`
   and copy the `https://....trycloudflare.com` link it prints.
   (Install once with `winget install Cloudflare.cloudflared`.)
3. On wokwi.com: **New project -> ESP32**, then replace `sketch.ino` and
   `diagram.json` with the files here, and add a `libraries.txt` tab with the
   contents of `libraries.txt`.
4. Paste the tunnel link into `SERVER_URL` at the top of `sketch.ino` and press Run.
5. Open the PWA register for Form 3B (Kibera Secondary) next to it.

The tunnel link changes every time cloudflared restarts, so repeat step 4 after
a restart.

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
