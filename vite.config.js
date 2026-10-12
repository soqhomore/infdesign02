import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// 수조(index.html) + 도트 수조 셰이더 테스트(pool.html)
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        pool: resolve(__dirname, 'pool.html'),
      },
    },
  },
})
