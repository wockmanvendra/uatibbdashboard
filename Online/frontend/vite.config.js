import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// VITE_API_URL is required (see .env.development.example) — the app calls
// the backend's absolute origin directly, so no dev-server proxy is needed.
export default defineConfig({
  plugins: [react()],
})
