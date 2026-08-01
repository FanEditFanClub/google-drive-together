# Google Drive Together

A Discord Activity that lets you watch Google Drive videos together in sync (like YouTube Watch Together).

## Features
- Pure Discord Activity (launches from the rocket ship)
- Paste a public Google Drive video link
- Synchronized play / pause / seek for everyone in the voice channel
- Works with ~10 people easily
- Free to host on free tiers

## Requirements
- Discord Application with Activities enabled
- Public Google Drive video links ("Anyone with the link can view")
- Node.js 18+

---

## 1. Discord Developer Portal Setup

1. Go to https://discord.com/developers/applications
2. Select your app **Google Drive Together** (Client ID: `1532918410151858236`)
3. **OAuth2 → General**
   - Add Redirect URI: `https://127.0.0.1` (for local testing)
4. **OAuth2 → URL Generator**
   - Scopes: `identify`
5. **Activities → Enable Activities** → turn it **ON**
6. **Activities → URL Mappings**
   - You will add these later after you deploy (or when using a tunnel)

**Important:** Regenerate your Client Secret if you previously shared it.

---

## 2. Local Development

### Backend
```bash
cd server
cp .env.example .env
# Edit .env and put your Client ID + Client Secret
npm install
npm run dev
```

### Frontend
```bash
cd client
cp .env.example .env
# Edit .env and put your Client ID
npm install
npm run dev
```

### Tunnel (required to test inside Discord)
```bash
# Install cloudflared if you don't have it
npx cloudflared tunnel --url http://localhost:5173
```

Copy the `https://xxxx.trycloudflare.com` URL and add it as an Activity URL Mapping in the Discord Developer Portal:

- Prefix: `/`
- Target: `xxxx.trycloudflare.com` (without https://)

Then launch the Activity from a voice channel.

---

## 3. Environment Variables

### server/.env
```
DISCORD_CLIENT_ID=1532918410151858236
DISCORD_CLIENT_SECRET=your_regenerated_secret_here
PORT=3001
```

### client/.env
```
VITE_DISCORD_CLIENT_ID=1532918410151858236
VITE_SERVER_URL=http://localhost:3001
```

---

## Notes about Google Drive
- Videos **must** be set to "Anyone with the link can view"
- Large files sometimes show a virus-scan confirmation page (the `&confirm=t` helps)
- Google Drive is not a perfect streaming CDN — expect occasional buffering with many concurrent viewers

## Tech Stack
- Frontend: React + Vite + @discord/embedded-app-sdk
- Backend: Express + Socket.io
- Sync: Real-time via Socket.io rooms (keyed by Discord activity instanceId)
