# Repository Guidelines

## Project Structure
- `manifest.json` is the Chrome MV3 entry point (permissions, background worker, popup wiring).
- `background/` contains the service worker logic for URL health checks.
- `popup/` contains the UI: `popup.html`, `popup.css`, and `popup.js` (Gemini API calls and bookmark actions).
- `icons/` stores extension icons in multiple sizes.

## Build, Test, and Development Commands
- No build step is required. Load the extension via `chrome://extensions` -> enable Developer Mode -> `Load unpacked` -> select the repo root.
- To debug UI logic, open the popup and use `Inspect` to view the console and network calls.
- To debug the background worker, open `chrome://extensions`, click `Service worker` under the extension, and use its DevTools.

## Coding Style & Naming Conventions
- JavaScript uses 2-space indentation, semicolons, and single quotes for strings.
- Prefer `const`/`let` and `async/await` for asynchronous flows.
- Keep DOM IDs in `popup.html` aligned with selectors in `popup/popup.js`.
- File names are lowercase with dashes or simple nouns (e.g., `popup.js`, `background.js`).

## Testing Guidelines
- There are no automated tests in this repo.
- Manual checks should include:
- Load the extension and confirm the popup renders.
- Save a Gemini API key and verify it persists via `chrome.storage.sync`.
- Run “AI Organize” and “Check Dead” to confirm bookmark updates and status reporting.

## Commit & Pull Request Guidelines
- Use Conventional Commit prefixes as seen in history: `feat:`, `fix:`, `refactor:`.
- Keep subjects short and action-oriented; add scope only when it clarifies impact.
- PRs should include a summary, testing steps, and note any `manifest.json` permission changes.
- Include a popup screenshot or recording for UI changes.

## Security & Configuration Tips
- Never commit API keys. The Gemini key is stored in `chrome.storage.sync` at runtime.
- If new network calls are added, update `host_permissions` in `manifest.json` accordingly.
