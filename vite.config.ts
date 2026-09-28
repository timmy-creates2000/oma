import { vlyPlugin } from "@vly-ai/integrations";
import { ReplitConnectors } from "@replit/connectors-sdk";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig } from "vite";

function readBody(req: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    if (req.method === "GET" || req.method === "HEAD") {
      resolve(undefined);
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8") || undefined));
    req.on("error", reject);
  });
}

function writeProxyResponse(res: ServerResponse, upstream: Response) {
  res.statusCode = upstream.status;
  upstream.headers.forEach((value, key) => {
    if (!["content-encoding", "content-length", "transfer-encoding"].includes(key.toLowerCase())) {
      res.setHeader(key, value);
    }
  });
  upstream.arrayBuffer().then((body) => res.end(Buffer.from(body))).catch(() => {
    if (!res.headersSent) res.statusCode = 502;
    res.end("Supabase proxy response failed");
  });
}

function supabaseProxyPlugin() {
  const connectors = new ReplitConnectors();
  return {
    name: "officeflow-supabase-proxy",
    configureServer(server: { middlewares: { use: (path: string, handler: (req: IncomingMessage & { url?: string }, res: ServerResponse) => void) => void } }) {
      server.middlewares.use("/api/supabase", async (req, res) => {
        try {
          const requestUrl = new URL(req.url ?? "/", "http://localhost");
          const path = `${requestUrl.pathname.replace(/^\/api\/supabase/, "") || "/"}${requestUrl.search}`;
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(req.headers)) {
            if (value && !["host", "content-length", "apikey"].includes(key.toLowerCase())) {
              headers[key] = Array.isArray(value) ? value.join(",") : value;
            }
          }
          const body = await readBody(req);
          const upstream = await connectors.proxy("supabase", path, {
            method: req.method,
            headers,
            body,
          });
          writeProxyResponse(res, upstream);
        } catch (error) {
          console.error("[Supabase proxy]", error);
          if (!res.headersSent) {
            res.statusCode = 502;
            res.setHeader("content-type", "application/json");
          }
          res.end(JSON.stringify({ message: "Supabase connection unavailable" }));
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), vlyPlugin(), tailwindcss(), supabaseProxyPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // Force a single copy of React across all packages (including vlyPlugin).
    // Without this, @vly-ai/integrations can resolve its own React copy, which
    // triggers "Invalid hook call" errors at runtime.
    dedupe: ["react", "react/jsx-runtime", "react-dom", "react-dom/client"],
  },
  build: {
    // Enable source maps for better debugging (disable in production if needed)
    sourcemap: false,
    // Optimize chunk splitting
    rollupOptions: {
      output: {
        // Manual chunk splitting for better caching and lazy loading
        manualChunks: {
          // Vendor chunks for large libraries
          'react-vendor': ['react', 'react-dom', 'react-router'],
          // Large UI library chunks
          'radix-ui': [
            '@radix-ui/react-accordion',
            '@radix-ui/react-alert-dialog',
            '@radix-ui/react-avatar',
            '@radix-ui/react-checkbox',
            '@radix-ui/react-collapsible',
            '@radix-ui/react-context-menu',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-hover-card',
            '@radix-ui/react-label',
            '@radix-ui/react-menubar',
            '@radix-ui/react-navigation-menu',
            '@radix-ui/react-popover',
            '@radix-ui/react-progress',
            '@radix-ui/react-radio-group',
            '@radix-ui/react-scroll-area',
            '@radix-ui/react-select',
            '@radix-ui/react-separator',
            '@radix-ui/react-slider',
            '@radix-ui/react-switch',
            '@radix-ui/react-tabs',
            '@radix-ui/react-toggle',
            '@radix-ui/react-toggle-group',
            '@radix-ui/react-tooltip',
          ],
          // Heavy optional libraries - separate chunks for better lazy loading
          'framer-motion': ['framer-motion'],
          'charts': ['recharts'],
          'forms': ['react-hook-form', '@hookform/resolvers', 'zod'],
        },
        // Optimize chunk size
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    // Increase chunk size warning limit for better chunking
    chunkSizeWarningLimit: 1000,
    // Target modern browsers for better optimization
    target: 'esnext',
    // Minify options - using esbuild (faster than terser)
    minify: 'esbuild',
  },
  // Optimize dependencies
  optimizeDeps: {
    // Only scan the app entry HTML; avoids crawling unrelated *.html files
    // if a legacy snapshot accidentally contains leaked package folders.
    entries: ['index.html'],
    include: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
      'react-router',
      'framer-motion',
      // vlyPlugin() injects this import at serve time, so the dep scanner
      // never sees it. Without it here the first page load discovers it,
      // re-optimizes and full-reloads the preview mid-screenshot.
      '@vly-ai/integrations',
    ],
  },
  // Performance hints
  server: {
    // Bind to all interfaces so the browser runtime's server-ready event fires.
    host: true,
    port: 5173,
    allowedHosts: true,
    // Keep HMR on, but disable full-screen error overlay
    hmr: {
      overlay: false,
    },
  },
});
