import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'path';

// Plugin to automatically redirect plain HTTP requests to HTTPS on port 5173
const httpToHttpsRedirectPlugin = (): Plugin => ({
  name: 'http-to-https-redirect',
  configureServer(server) {
    server.httpServer?.on('tlsClientError', (_err, socket) => {
      if (socket && socket.writable) {
        socket.end(
          'HTTP/1.1 302 Found\r\n' +
          'Location: https://localhost:5173/\r\n' +
          'Connection: close\r\n' +
          'Content-Length: 0\r\n\r\n'
        );
      }
    });
  },
});

export default defineConfig({
  plugins: [react(), basicSsl(), httpToHttpsRedirectPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    watch: {
      ignored: ['**/*.zip', '**/dist/**', '**/extension/**', '**/.git/**'],
    },
  },
});
