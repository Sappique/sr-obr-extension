import OBR, { Item } from "@owlbear-rodeo/sdk";

import { migratedKey, NAMESPACE } from "./migrateKey";

/**
 * One-time move of item and scene metadata from the extension's earlier
 * namespace to the current one (see migrateKey.ts). Only the GM client
 * writes; running it again finds nothing to do.
 */
function rename(metadata: Record<string, unknown>) {
  for (const key of Object.keys(metadata)) {
    const next = migratedKey(key);
    if (!next) continue;
    if (!(next in metadata)) metadata[next] = metadata[key];
    delete metadata[key];
  }
}

const hasOld = (metadata: Record<string, unknown>) => Object.keys(metadata).some((k) => migratedKey(k));

async function migrateScene() {
  if ((await OBR.player.getRole()) !== "GM") return;
  const items = await OBR.scene.items.getItems((i: Item) => hasOld(i.metadata));
  if (items.length) {
    await OBR.scene.items.updateItems(items.map((i) => i.id), (drafts) => {
      for (const d of drafts) rename(d.metadata);
    });
  }
  const scene = await OBR.scene.getMetadata();
  if (hasOld(scene)) {
    // setMetadata merges, so the old keys are cleared with undefined.
    const update: Record<string, unknown> = {};
    for (const key of Object.keys(scene)) {
      const next = migratedKey(key);
      if (!next) continue;
      if (!(next in scene)) update[next] = scene[key];
      update[key] = undefined;
    }
    await OBR.scene.setMetadata(update);
  }
  if (items.length) console.info(`[${NAMESPACE}] moved ${items.length} items to the current metadata keys`);
}

/** Runs the migration whenever a scene becomes ready. Resolves after the first run. */
export async function migrateOnSceneReady() {
  OBR.scene.onReadyChange((ready) => {
    if (ready) void migrateScene().catch((e) => console.error(`[${NAMESPACE}] migration failed`, e));
  });
  if (await OBR.scene.isReady()) await migrateScene().catch((e) => console.error(`[${NAMESPACE}] migration failed`, e));
}
