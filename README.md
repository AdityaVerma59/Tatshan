# Tatshan · तत्क्षण

Instant file transfer by QR code. No phone numbers, no links, no WhatsApp. Built so a print shop can put one QR on the counter and see every customer's file arrive, with name, file and time.

- **Static site.** Plain HTML, CSS and JS modules. No framework, no npm, no build step.
- **Firebase free plan** (Anonymous Auth + Firestore). The SDK loads from Google's CDN.
- **Render** serves the folder as a free static site.

Try it right now with no setup: run any static server in this folder (`python3 -m http.server 8080`) and open two tabs. Until you add Firebase keys it runs in **demo mode**, where files move between tabs of the same browser.

## How it behaves

| | |
|---|---|
| Person to person | Receiver opens **Receive**, shows the QR. Sender scans it, picks files, sends. When files arrive the QR folds away and the page slides to the new message. Receiver can **Preview** each file, then **Download**; downloaded files are deleted from Tatshan. |
| Unread dot | A message you haven't opened shows a blue dot (and the tab title shows a count). It clears once you preview, download or open it. |
| Sender | Can preview every file before sending and after it's sent. No account, ever. |
| Not downloaded | Unreadable after 6 hours (security rules) and removed by Firestore's TTL policy. The admin dashboard lists anything older than 24 hours and can delete it. |
| Print shop | The shop **signs in once** (Google or email) the first time it creates a QR. The shop, QR code and history log belong to the account, so switching phones or clearing the browser changes nothing: sign in again and everything is back. Files are copied to the shop's device the moment they arrive, then deleted from the cloud. |
| Shop history | Newest on top. Tap a message to see **every file** with its own Preview and Print, plus Preview all / Print all. The log (sender, files, time, seen or not) follows the account for 48 hours. The files themselves stay on the device that received them. |
| No compression | Files are stored and delivered byte for byte. Each file's SHA-256 is saved when it's sent and checked when it arrives; a file that doesn't match is rejected, never delivered altered. |
| Admin | `#/admin`. Traffic, anonymous vs print-shop visitors, transfers, file types, storage per day, and a list of files nobody downloaded with one-click delete. |

Print and preview work directly in the browser for **PDF, images and text**. Word, Excel and PowerPoint files can't be rendered by a browser without heavy libraries, so those are saved and opened in the shop's own app. This keeps Tatshan dependency-free.

**About "compression" on phones.** Tatshan never touches file contents, but a phone's *photo picker* can convert images before the browser sees them (for example iPhone HEIC to JPEG, or "optimised" copies). To send untouched originals, choose the file from **Files / Browse** instead of the Photos tab.

## Setup (free plan, about 15 minutes)

Everything runs on Firebase's free **Spark** plan. No card needed. Files are stored in Firestore in small pieces instead of Cloud Storage (which requires a paid plan).

### 1. Firebase

1. [console.firebase.google.com](https://console.firebase.google.com) → **Add project** (turn Google Analytics off).
2. **Build → Authentication → Sign-in method →** enable **Anonymous**, **Google** and **Email/Password**. (Anonymous is for everyday senders; Google/Email is for print shops and the admin.)
3. **Build → Firestore Database → Create database** → production mode.
4. **Project settings → Your apps → Web (`</>`)**, register an app (leave Hosting unchecked), and copy the config values into `js/config.js`.
5. **Authentication → Settings → Authorized domains:** add your Render domain (e.g. `tatshan.onrender.com`).

Do **not** set up Storage or upgrade to Blaze. Not needed.

### 2. Deploy the rules (required)

Open `firestore.rules`, find `REPLACE-WITH-YOUR-EMAIL@gmail.com` and put the **Google account email** you'll use for the admin dashboard (lowercase). Then deploy:

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
| `events` | `expireAt` |
| `visits` | `expireAt` |

(`events` and `visits` are the small stats records behind the admin dashboard. They expire after 60 days; finished days are rolled into one `daily` document first, so your history is kept.)

Firestore normally deletes expired documents within about 24 hours. They are unreadable after 6 hours either way (rules), so this only frees space. If your project doesn't offer TTL on the free plan, skip it: unpicked files are still unreadable after 6 hours, and the receiver's browser removes expired ones it sees. A few abandoned pieces could remain, so check Firestore → Data now and then (1 GiB free).

### 4. Admin dashboard

1. Open `https://your-site/#/admin` and **Continue with Google** using the email you put in the rules.
2. The first time, the dashboard may show *"Firestore needs a one-time index"* with a button. Click it, press **Create**, wait a minute or two, then press **Refresh**. (It lets the dashboard list files across every inbox. Two such indexes may be requested: one for `transfers`, one for `parts`.)
3. Nothing links to `#/admin`. Even if someone finds it, the security rules refuse every admin read and delete for any other account.

**What it shows:** unique visitors per day split into anonymous and print-shop (signed-in) visitors; transfers per day (person to person vs to shops); files sent; data uploaded per day; file types; how much is in storage right now; and every transfer waiting longer than 24 hours (change `STALE_HOURS` in `js/config.js`) with **Delete selected / Delete all**. *Clean up leftovers* removes pieces of uploads that were abandoned half-way.

**Cost:** finished days are saved once as a `daily` document and never recomputed, so opening the dashboard reads roughly one document per day in the range, plus today's events.

**Accuracy:** stats are written by visitors' browsers, so they're good for trends, not accounting. A technical person could inflate them; they can't read anyone's files.

### 5. Render

Push this folder to GitHub, then Render → **New → Static Site** (or **Blueprint**, which reads `render.yaml`). Publish directory `.`, no build command.

## Files

```
index.html            page shell
css/style.css         all styling (light + dark)
js/config.js          ← your Firebase keys and settings
js/app.js             router + boot
js/views/             home, send, receive, shop, admin
js/auth-ui.js         sign-in / sign-up panel (shops and admin only)
js/admin-api.js       everything the admin dashboard reads and deletes
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
- **Shop identity.** The shop belongs to the owner's Google/email account, not the browser. Shops created before sign-in existed keep working and show a "Sign in to protect your shop" banner; signing in keeps ownership (the same underlying user id is upgraded, not replaced).
- **Shop on two devices.** Both can be signed in; each sees the same log. Files are kept only on the device that received them, so a message received on the other device shows "Received on another device" and can't be previewed or printed here.
- **Keep the shop page open** while working: files are fetched while it's open. Files that arrive while it's closed are fetched when it next opens, if still under 6 hours.
- **Limits.** 10 files per send, **10 MB each**. Free Firestore allows 1 GiB stored, 50,000 reads and 20,000 writes per day. A 10 MB file uses about 15 writes and 30 reads, so that is roughly 1,000+ files a day.
