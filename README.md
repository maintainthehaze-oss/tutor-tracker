# Tutoring Tracker Pro

A lightweight tutoring business tracker with cloud sync via GitHub Gist.

## Features
- Client management (family-grouped cards)
- Session logging with mileage calculation
- Expense tracking
- Reports with monthly breakdown
- Tax Summary (Schedule C format, PDF export)
- Cloud sync across devices
- Works offline (PWA)

## Setup (10 minutes)

### 1. Create a GitHub account
Go to [github.com](https://github.com) and sign up (or log in).

### 2. Create a Personal Access Token
1. Go to **Settings → Developer Settings → Personal Access Tokens → Tokens (classic)**
2. Click **Generate new token (classic)**
3. Name it "Tutoring Tracker"
4. Check ONLY the **gist** scope
5. Click **Generate token**
6. **Copy the token now** — you won't see it again

### 3. Create a secret Gist
1. Go to [gist.github.com](https://gist.github.com)
2. Filename: `tutoring-data.json`
3. Content: `{}`
4. Click **Create secret gist**
5. Copy the **Gist ID** from the URL (the long string after your username)

### 4. Deploy to GitHub Pages
1. Create a new repository: [github.com/new](https://github.com/new)
2. Name it `tutor-tracker` (or anything you like)
3. Upload all files from this folder (`index.html`, `styles.css`, `app.js`, `manifest.json`, `sw.js`)
4. Go to **Settings → Pages → Source: Deploy from a branch → Branch: main → Save**
5. Your app will be live at `https://yourusername.github.io/tutor-tracker`

### 5. Configure the app
1. Open your app URL
2. Click **⚙️ Settings**
3. Enter your **Gist ID** and **Personal Access Token**
4. Click **Save Settings**
5. If you have a backup file, click **📥 Restore** to import your data

## Files
- `index.html` — HTML structure (modals, tabs, forms)
- `styles.css` — All styling (grayscale theme, Times New Roman)
- `app.js` — All logic (73 functions, Gist sync)
- `manifest.json` — PWA config (installable on phone)
- `sw.js` — Service worker (offline support, caching)

## Phone Setup
1. Open the app URL in Chrome/Safari on your phone
2. Tap **Share → Add to Home Screen**
3. The app appears as an icon — tap to open full-screen

## How Sync Works
- Data saves locally on every change (instant)
- Syncs to GitHub Gist every 30 seconds (if changes were made)
- Syncs on tab close
- On load: fetches from Gist, falls back to local cache if offline
- Gist credentials stored in browser only (never uploaded)
