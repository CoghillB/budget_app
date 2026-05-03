# 💰 Budget Quest

A fun, neon-themed budget tracker. Open `index.html` in a browser — no backend required.
Optional Firebase sync lets you and your partner share the same budget across devices in real time.

## Features

- **Budget categories** with animated progress bars that fill as you spend.
- **Over-budget alerts** — bars pulse red, the page shakes, and a warning toast pops up.
- **Income tracker** with confetti when you add some.
- **Monthly reset** — start a new month and your categories carry over with $0 spent.
- **History** — flip back through previous months as read-only snapshots.
- **Custom icons & colors** per category.
- **Cross-device household sync** (optional, via Firebase).
- All data stored in your browser's `localStorage`. With sync on, also mirrored to Firestore.

## Run it locally

Because the app uses ES modules, you have to serve it (don't double-click — `file://` blocks modules).

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Files

- `index.html` — markup
- `styles.css` — theme & animations
- `app.js` — state, rendering, effects
- `sync.js` — optional Firebase Firestore sync layer
- `firebase-config.js` — your Firebase project config (placeholders by default)

---

## 🤝 Setting up household sync (optional, ~10 min)

This lets you and your partner share the same budget across phones, laptops, browsers — anything.
Updates show up on the other device in real time.

### 1. Create a Firebase project

1. Go to **https://console.firebase.google.com**
2. Click **Add project** → name it anything (e.g. "budget-quest") → continue
3. You can skip Google Analytics

### 2. Add a Web app

1. In the project dashboard, click the **`</>`** (Web) icon
2. Give it a nickname → **Register app**
3. Copy the `firebaseConfig` object that's shown — you'll paste this in step 4
4. Skip the SDK scripts step — Budget Quest already includes them

### 3. Enable services

1. **Authentication** → Get started → **Sign-in method** tab → enable **Anonymous**
2. **Firestore Database** → Create database → choose any location → start in **production mode**
3. Once Firestore is created, go to its **Rules** tab and replace the rules with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /households/{householdId} {
      allow read, write: if request.auth != null
        && householdId.size() >= 6
        && householdId.size() <= 50;
    }
  }
}
```

Click **Publish**.

### 4. Authorize your domain

1. **Authentication** → **Settings** → **Authorized domains**
2. Add your GitHub Pages domain (e.g. `coghillb.github.io`)
3. `localhost` is already authorized for local testing

### 5. Drop your config into the app

Open `firebase-config.js` in this repo and paste the values from step 2:

```js
export const firebaseConfig = {
  apiKey: "AIzaSy…",
  authDomain: "budget-quest-xxxx.firebaseapp.com",
  projectId: "budget-quest-xxxx",
  storageBucket: "budget-quest-xxxx.appspot.com",
  messagingSenderId: "123…",
  appId: "1:123…:web:abc…"
};
```

These values are **not secrets** — Firebase web configs are public by design. Security comes from
the Firestore rules and authorized domains, not from hiding the keys.

Commit and push. The next time GitHub Pages redeploys, sync goes live.

### 6. Use it

1. Open the app — it'll prompt you to **Create new** or **Join existing** household.
2. Pick a friendly code like `mint-tiger-7`. Share it with your partner.
3. They open the app on their device and **Join existing** with the same code.
4. You're both editing the same budget. Add an expense on your phone, watch it appear on their laptop a second later.

The little **🔗 Synced** badge in the top bar shows connection status. Click it to see/copy your code, change household, or disconnect.

### Troubleshooting

- **"Sync error"** → check the browser console. Most often: domain not authorized, or rules not published.
- **Wife sees old data** → make sure she's joined the same code as you (case-insensitive).
- **I want to start over** → click 🔗 in the header → Disconnect, then re-create with a new code.

---

## Privacy

- **Without sync**: data lives only in your browser's `localStorage`. Nothing leaves your machine.
- **With sync**: data also lives in your private Firestore database. Anyone with your household code (and access to a browser pointed at your authorized domain) can read/edit. So pick a code that's not guessable.
