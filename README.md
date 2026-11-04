# Tatshan · तत्क्षण

Instant file transfer by QR code. No phone numbers, no links, no WhatsApp. Built so a print shop can put one QR on the counter and see every customer's file arrive, with name, file and time.

- **Static site.** Plain HTML, CSS and JS modules. No framework, no npm, no build step.
- **Firebase free plan** (Anonymous Auth + Firestore). The SDK loads from Google's CDN.
- **Render** serves the folder as a free static site.

Try it right now with no setup: run any static server in this folder (`python3 -m http.server 8080`) and open two tabs. Until you add Firebase keys it runs in **demo mode**, where files move between tabs of the same browser.

## How it behaves

| | |
|---|---|
| Person to person | Receiver opens **Receive**, shows the QR. Sender scans it, picks files, sends. Receiver taps Download and the files are deleted from Tatshan. |
| Not downloaded | Unreadable after 6 hours (enforced by security rules) and removed by Firestore's TTL policy. |
| Print shop | Shop opens **For print shops**, names the shop, and gets a permanent QR (with a printable poster). Files are copied to the shop's device the moment they arrive, then deleted from the cloud. |
| History | Newest message on top, older ones slide down. Each row: sender, first file + "+ N more", format, date and time. Tap a row for just **Preview** and **Print**. Kept on the shop's device for 48 hours. |

Print and preview work directly in the browser for **PDF, images and text**. Word, Excel and PowerPoint files can't be rendered by a browser without heavy libraries, so those are saved and opened in the shop's own app. This keeps Tatshan dependency-free.

## Setup (free plan, about 15 minutes)

Everything runs on Firebase's free **Spark** plan. No card needed. Files are stored in Firestore in small pieces instead of Cloud Storage (which requires a paid plan).

### 1. Firebase

1. [console.firebase.google.com](https://console.firebase.google.com) → **Add project** (turn Google Analytics off).
2. **Build → Authentication → Sign-in method →** enable **Anonymous**.
3. **Build → Firestore Database → Create database** → production mode.
4. **Project settings → Your apps → Web (`</>`)**, register an app (leave Hosting unchecked), and copy the config values into `js/config.js`.
5. **Authentication → Settings → Authorized domains:** add your Render domain (e.g. `tatshan.onrender.com`).

Do **not** set up Storage or upgrade to Blaze. Not needed.

### 2. Deploy the rules (required)

```bash
npm i -g firebase-tools
firebase login
firebase use --add            # pick your project
firebase deploy --only firestore:rules
```

### 3. Auto-delete in Firestore (recommended)

Downloaded files are deleted immediately by the app. For files nobody downloads (and uploads abandoned half-way), add a time-to-live policy so Firestore removes them for you:

Firestore → **Time-to-live** → **Create policy**, twice:

| Collection group | Timestamp field |
|---|---|
| `parts` | `expireAt` |
| `transfers` | `expireAt` |

Firestore normally deletes expired documents within about 24 hours. They are unreadable after 6 hours either way (rules), so this only frees space. If your project doesn't offer TTL on the free plan, skip it: unpicked files are still unreadable after 6 hours, and the receiver's browser removes expired ones it sees. A few abandoned pieces could remain, so check Firestore → Data now and then (1 GiB free).

### 4. Render

Push this folder to GitHub, then Render → **New → Static Site** (or **Blueprint**, which reads `render.yaml`). Publish directory `.`, no build command.

## Files

```
index.html            page shell
css/style.css         all styling (light + dark)
js/config.js          ← your Firebase keys and settings
js/app.js             router + boot
js/views/             home, send, receive, shop
js/backend-firebase.js / backend-demo.js
js/qr.js              QR generator (no library)
js/print.js           preview + print
js/store.js           shop history on the device (IndexedDB)
assets/pigeon.svg     pigeon artwork (swap via PIGEON_SRC in config.js)
firestore.rules
```

## Notes

- **The pigeon.** The stock photo you shared carries a Pngtree watermark and licence, and I did not remove it. The app uses an original pigeon illustration instead. If you buy the licensed image, save it as `assets/pigeon.png` and set `PIGEON_SRC` in `js/config.js`.
- **Privacy.** Anyone with a code can send into that inbox, but only the owner can list or download. Shop QR codes are 8 characters (about 10¹² combinations); person-to-person inboxes are 6 and expire after 6 hours.
- **Shop identity.** The shop is tied to the browser's anonymous sign-in. Use the same browser and don't clear site data, or set the shop up again.
- **Keep the shop page open** while working: files are fetched while it's open. Files that arrive while it's closed are fetched when it next opens, if still under 6 hours.
- **Limits.** 10 files per send, **10 MB each**. Free Firestore allows 1 GiB stored, 50,000 reads and 20,000 writes per day. A 10 MB file uses about 15 writes and 30 reads, so that is roughly 1,000+ files a day.
