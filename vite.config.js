import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: 'blue-hour/index.html',
    },
  },
})
