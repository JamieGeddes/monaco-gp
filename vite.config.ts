import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig, Plugin } from 'vite';

// @babylonjs/havok's package exports don't expose the .wasm file, so a `?url`
// deep import breaks at build time. Serve it in dev and emit it as an asset in
// builds; src/physics/havok.ts points locateFile at BASE_URL + this name.
function havokWasm(): Plugin {
  const require = createRequire(import.meta.url);
  const wasmPath = join(dirname(require.resolve('@babylonjs/havok')), 'HavokPhysics.wasm');
  return {
    name: 'havok-wasm',
    configureServer(server) {
      server.middlewares.use('/HavokPhysics.wasm', (_req, res) => {
        res.setHeader('Content-Type', 'application/wasm');
        res.end(readFileSync(wasmPath));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'HavokPhysics.wasm', source: readFileSync(wasmPath) });
    },
  };
}

export default defineConfig({
  plugins: [havokWasm()],
  // ESBuild pre-bundling cannot handle @babylonjs/havok's WASM import.
  optimizeDeps: { exclude: ['@babylonjs/havok'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 6000 },
});
