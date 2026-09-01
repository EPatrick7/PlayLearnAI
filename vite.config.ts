import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // Each suite runs a simulation and its own DOM. Avoid oversubscribing the
    // workstation and turning CPU contention into spurious five-second timeouts.
    maxWorkers: 4,
  },
})
