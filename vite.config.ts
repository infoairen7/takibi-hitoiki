// Vite設定（標準の開発・ビルド手順）。
// 注意：この第0段階の制作環境ではnpmレジストリへ接続できなかったため、
// 検証ビルドは scripts/build.mjs（esbuild）で行った。Viteでのビルドは未検証。
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
});
