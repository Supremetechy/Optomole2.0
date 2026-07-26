import { defineConfig } from "vite";

export default defineConfig({
  server: {
    // game/*.json (the engine-agnostic content bundle) lives one level up
    fs: { allow: [".."] },
  },
  build: {
    rollupOptions: {
      // One page per engine adapter, both playing the same DSL bundle.
      input: { phaser: "index.html", pixi: "pixi.html" },
    },
  },
});
