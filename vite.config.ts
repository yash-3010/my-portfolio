import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves project sites from /<repo>/; Vercel and local dev serve
// from /. The Pages deploy workflow sets DEPLOY_BASE accordingly.
export default defineConfig({
  base: process.env.DEPLOY_BASE ?? '/',
  plugins: [react()],
})
