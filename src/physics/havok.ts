import { HavokPlugin, Scene, Vector3 } from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';

// Collision filter groups
export const FILTER_TRACK = 1;
export const FILTER_CAR = 2;

export async function initHavok(scene: Scene): Promise<HavokPlugin> {
  // served in dev / emitted in build by the havok-wasm plugin in vite.config.ts
  const wasmUrl = `${import.meta.env.BASE_URL}HavokPhysics.wasm`;
  const havok = await HavokPhysics({ locateFile: () => wasmUrl });
  const plugin = new HavokPlugin(true, havok);
  scene.enablePhysics(new Vector3(0, -9.81, 0), plugin);
  return plugin;
}
