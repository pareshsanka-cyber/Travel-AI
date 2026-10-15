# TravelAI — Frontend Client

The frontend interface for TravelAI, built with React 19, TypeScript, Vite, Tailwind CSS, Lucide icons, and Leaflet maps.

## Development Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment variables**:
   Create a `.env.local` or copy from `.env.example`:
   ```bash
   VITE_FASTAPI_URL="http://localhost:8000"
   ```

3. **Run the development server**:
   ```bash
   npm run dev
   ```

## Production Build
```bash
npm run build
npm run preview
```

The development server uses port 3000. Auth and trip requests share `VITE_FASTAPI_URL`; see the [project README](../README.md) for backend prerequisites.

Run `npm run lint` for TypeScript checks, `npm test` for service/export tests, and `npm run test:e2e` for desktop/mobile browser checks. Install Chromium once with `npm run browsers:install`.
