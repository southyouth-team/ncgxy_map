import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    // 后端构建产物不参与前端 HMR；Windows 下监听其中的 SQL 文件可能触发 EBUSY。
    watch: {
      ignored: ['**/server/dist/**'],
    },
  },
})