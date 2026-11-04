# S1 IPTV – GitHub Pages edition

Static version of the S1 IPTV system. No Python host, no installs.

- `index.html` – the **TV page** (open this on the computer/TV). Shows a QR code with a private pairing code.
- `remote.html` – the **phone remote** (opened by scanning the QR code, or by typing the code).
- `channels_ml.json` – channel list. Edit it in GitHub to add/remove/reorder channels (the remote's channel number = position in the file).
- `s1-host.js` / `s1-remote.js` – the TV-side and phone-side link code. `qrcode.js` – QR generator.

## Publish
1. Create a GitHub repository and upload all files in this folder (keep `.nojekyll`).
2. Repository **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. After a minute the TV page is at `https://<user>.github.io/<repo>/`.

## Use
1. Open the TV page on the computer, click once to start (it also goes fullscreen).
2. Scan the QR code with the phone (same Wi‑Fi). The remote opens and connects.
3. Pick a channel on the phone. The star sets the TV's start-up channel (saved in that browser).

## How pairing works
Each TV page creates its own random 8-character code (kept in that browser). The QR code contains it; only a phone that
has the code can connect, so several people can use the site at the same time without interfering with each other.
The phone shows a "same Wi‑Fi required" notice, and the TV refuses phones whose public IP differs from its own.

## Not available in this version (needs the PC host)
Recording and recordings playback, mouse/keyboard control, power/open-close TV, YouTube launcher. These buttons are hidden.
