import OBR from "@owlbear-rodeo/sdk";
import { UI_SCALE } from "../core/style";
import { ANIMATED_KEY, readAnimated, readUiScale, UI_SCALE_KEY } from "./items";

/** Action popover. The GM sets the scale; players see it read-only. */
const slider = document.getElementById("scale") as HTMLInputElement;
const value = document.getElementById("value") as HTMLOutputElement;
const animated = document.getElementById("animated") as HTMLInputElement;
const notice = document.getElementById("notice") as HTMLElement;

slider.min = String(UI_SCALE.min);
slider.max = String(UI_SCALE.max);
slider.step = String(UI_SCALE.step);

function show(scale: number) {
  slider.value = String(scale);
  value.textContent = `${Math.round(scale * 100)} %`;
}

function applyRole(role: string) {
  const gm = role === "GM";
  slider.disabled = !gm;
  animated.disabled = !gm;
  notice.hidden = gm;
}

OBR.onReady(async () => {
  void OBR.action.setHeight(150);
  applyRole(await OBR.player.getRole());
  OBR.player.onChange((player) => applyRole(player.role));

  // Dragging only updates the label; every window is redrawn on release.
  slider.addEventListener("input", () => show(Number(slider.value)));
  slider.addEventListener("change", () => {
    if (slider.disabled) return;
    void OBR.scene.setMetadata({ [UI_SCALE_KEY]: Number(slider.value) });
  });

  animated.addEventListener("change", () => {
    if (!animated.disabled) void OBR.scene.setMetadata({ [ANIMATED_KEY]: animated.checked });
  });

  const load = async (ready: boolean) => {
    slider.disabled = slider.disabled || !ready;
    if (ready) {
      applyRole(await OBR.player.getRole());
      const metadata = await OBR.scene.getMetadata();
      show(readUiScale(metadata));
      animated.checked = readAnimated(metadata);
    }
  };
  OBR.scene.onReadyChange(load);
  await load(await OBR.scene.isReady());
  OBR.scene.onMetadataChange((metadata) => {
    if (document.activeElement !== slider) show(readUiScale(metadata));
    animated.checked = readAnimated(metadata);
  });
});
