# Site Pulse Dashboard

Static dashboard that checks if websites are reachable every 5 minutes.

## Why this works on GitHub Pages

- No backend server is required.
- Everything runs in the browser.
- Checks are done using a public CORS proxy endpoint.

## Local run (Node.js)

1. Install Node.js 18+.
2. Run:

```bash
npm run dev
```

3. Open `http://localhost:5173`.

## Deploy to GitHub Pages

1. Push this project to a GitHub repository.
2. In GitHub, open **Settings > Pages**.
3. Under **Build and deployment**, choose:
   - Source: `Deploy from a branch`
   - Branch: `main` (or your default branch)
   - Folder: `/ (root)`
4. Save and wait for deployment.

Your dashboard will be available at:

`https://<your-username>.github.io/<repository-name>/`

## Notes

- Browser CORS rules prevent direct uptime checks to many websites from static pages.
- This app uses `https://api.allorigins.win` as a proxy. Availability and rate limits depend on that service.
- For strict production monitoring, a backend or dedicated uptime API is recommended.
