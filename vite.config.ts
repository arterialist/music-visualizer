import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

async function scrapeClientId(): Promise<string | null> {
  const page = await fetch("https://soundcloud.com/");
  const html = await page.text();
  const scripts = [
    ...html.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+)"/g),
  ];
  for (const [, scriptUrl] of scripts) {
    const js = await fetch(scriptUrl).then((r) => r.text());
    const match = js.match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{32})"/);
    if (match) return match[1];
  }
  return null;
}

function soundcloudDevHelpers(): Plugin {
  return {
    name: "soundcloud-dev-helpers",
    configureServer(server) {
      server.middlewares.use("/sc-client-id", async (_req, res) => {
        try {
          const clientId = await scrapeClientId();
          res.setHeader("content-type", "application/json");
          if (!clientId) {
            res.statusCode = 502;
            res.end(JSON.stringify({ error: "client_id not found" }));
            return;
          }
          res.end(JSON.stringify({ clientId }));
        } catch {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: "SoundCloud lookup failed" }));
        }
      });
    },
  };
}

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss(), soundcloudDevHelpers()],
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (/node_modules\/(three|@react-three)\//.test(id)) return "three";
          return undefined;
        },
      },
    },
  },
  server: {
    open: false,
    proxy: {
      "/sc-api": {
        target: "https://api-v2.soundcloud.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/sc-api/, ""),
      },
    },
  },
});
