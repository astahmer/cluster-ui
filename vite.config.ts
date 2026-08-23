import react from "@vitejs/plugin-react"
import path from "node:path"
import { defineConfig } from "vite"
import tailwindcss from "@tailwindcss/vite"

// kumo-ui's published JS bundle embeds its own React and crashes when mixed
// with ours — we only reuse its stylesheet, aliased to the real css file.
const kumoUiCss = path.resolve(__dirname, "node_modules/kumo-ui/dist/style.css")

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [{ find: /^kumo-ui\/styles\.css$/, replacement: kumoUiCss }]
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/healthz": "http://127.0.0.1:8787"
    }
  }
})
