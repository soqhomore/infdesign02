import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// 메인(index.html) = 도트 수조판, classic.html = 예전 파스텔 수조
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        classic: resolve(__dirname, 'classic.html'),
      },
    },
  },
})
