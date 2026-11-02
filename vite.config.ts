import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5180,
    strictPort: true,
    // Development also contains the real private database. Never serve it as
    // a Vite file or ?raw import, even to another device on the event LAN.
    fs: {
      deny: [
        "**/.env*",
        "**/.git/**",
        "**/data/**",
        "**/server/**",
        "**/*.sqlite*",
        "**/*.{crt,pem,key}",
      ],
    },
    proxy: {
      "/api": { target: "http://localhost:3001" },
      "/socket.io": { target: "http://localhost:3001", ws: true },
    },
  },
});
