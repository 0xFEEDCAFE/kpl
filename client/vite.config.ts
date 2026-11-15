import { defineConfig, loadEnv } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  // Fail production builds without a backend URL instead of silently pointing
  // players at localhost (or, as before, at someone else's server).
  if (command === 'build' && !loadEnv(mode, '.', 'VITE_').VITE_SERVER_URL) {
    throw new Error('VITE_SERVER_URL must be set for production builds (see DEPLOYMENT.md)')
  }

  return {
    plugins: [svelte()],
  }
})
