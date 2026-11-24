# ClickShield v0.3 — Gemini integration (local-only developer prototype)

## Important
- Keep your existing `frontend/` folder unchanged.
- The `extension/` files update the already-installed Chrome extension. They do NOT replace your website.
- The `backend/` Python proxy holds the Gemini secret. **Never put an API key in popup.js, GitHub, screenshots, or ChatGPT.**
- The AI button only appears enabled when the extension detects warning signals. Clicking it sends only fixed indicator IDs + the broad warning category, **not** webpage text, website address, form values or private information.
- Your local rule scanner and form-intervention work even if Gemini is offline.
- Local backend is intentionally restricted to the Chrome extension ID and binds to 127.0.0.1. It is NOT production-ready for public hosting.

## 1. Copy files to your EXISTING ClickShield repository
Inside `ClickShield`, paste the `backend` folder and the *contents* of the updated `extension` folder into your existing `extension` folder. Replace matching files. Preserve your existing `frontend` folder and README.

## 2. Create a private local .env file
In VS Code Explorer: `backend` -> copy `.env.example` -> paste as `.env`.
Find your ClickShield extension ID: Chrome -> `chrome://extensions` -> Developer mode -> under ClickShield look for ID. Paste it in `CLICKSHIELD_EXTENSION_ID=...` in `.env`.
Get a Gemini API key at https://aistudio.google.com/apikey and paste it only into the LOCAL `.env` file next to `GEMINI_API_KEY=`. **Never upload that file**.
Model defaults to `gemini-3.5-flash-lite` (may depend on your account/region/quota). If your model is unavailable, check AI Studio models.

## 3. Start backend (a different port from your demo webpage)
In VS Code -> Terminal -> New Terminal:

```powershell
cd backend
python server.py
```

Leave this terminal running. You should see `ClickShield local AI backend running: http://127.0.0.1:8765`.
You can check `http://127.0.0.1:8765/health` in Chrome; it displays only booleans, never the key. The backend needs your laptop internet connection to contact Google Gemini.

## 4. Reload extension
Go to `chrome://extensions`, find ClickShield, click Reload. Confirm it says v0.3.0. Refresh any test tabs.

## 5. Try the AI explanation
On your suspicious internship sample running at `http://127.0.0.1:8000/demo-suspicious.html`, click ClickShield -> Scan this page -> **Explain detected warning signs**.
Your backend must be running and your `.env` must have a valid key and extension ID. A Gemini explanation appears inside the popup; verify the wording cautiously. Test an ordinary page to ensure no false alarm.

## If there's an error
- `Extension origin not allowed`: the 32-character extension ID in `.env` doesn't match Chrome, or backend wasn't restarted.
- `Gemini API key is not configured`: check your private `.env` file, restart backend.
- `Cannot connect`: check that the backend terminal is still running and that Windows Firewall isn't blocking loopback.
- `HTTP 429 / 403 / 404`: check quota, billing, API key type, model availability/permissions in Google AI Studio.
- On any error: ClickShield's existing local rule-based warnings continue to function. **Do not disable the scanner to fix Gemini.**

## Security / release caveats
This is for your own PC and hackathon demo only. For production, deploy over HTTPS with real authentication, CORS allow-listing, server abuse controls, secret management, content privacy review, monitoring and integration tests. Do NOT publish this localhost backend to the internet.
