import OBR from "@owlbear-rodeo/sdk";
import { UI_SCALE } from "../core/style";
import { IMPORT_MODAL_ID, LABEL_SCALE_KEY, MAP_SCALE, MAP_SCALE_KEY, readLabelScale, readMapScale } from "../map/model";
import { ANIMATED_KEY, readAnimated, readUiScale, UI_SCALE_KEY, writeAnimated } from "./items";

/** Action popover. The GM sets the scale; animation is each viewer's own choice. */
const slider = document.getElementById("scale") as HTMLInputElement;
const value = document.getElementById("value") as HTMLOutputElement;
const animated = document.getElementById("animated") as HTMLInputElement;
const notice = document.getElementById("notice") as HTMLElement;

const mapBox = document.getElementById("mapBox") as HTMLElement;
const mapSlider = document.getElementById("mapScale") as HTMLInputElement;
const mapValue = document.getElementById("mapValue") as HTMLOutputElement;
const labelSlider = document.getElementById("labelScale") as HTMLInputElement;
const labelValue = document.getElementById("labelValue") as HTMLOutputElement;
for (const s of [mapSlider, labelSlider]) {
  s.min = String(MAP_SCALE.min);
  s.max = String(MAP_SCALE.max);
  s.step = String(MAP_SCALE.step);
}
function showLabel(scale: number) {
  labelSlider.value = String(scale);
  labelValue.textContent = `${Math.round(scale * 100)} %`;
}

function showMap(scale: number) {
  mapSlider.value = String(scale);
  mapValue.textContent = `${Math.round(scale * 100)} %`;
}

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
  notice.hidden = gm;
  mapBox.hidden = !gm;
}

OBR.onReady(async () => {
  void OBR.action.setHeight(270);
  applyRole(await OBR.player.getRole());
  OBR.player.onChange((player) => applyRole(player.role));

  // Dragging only updates the label; every window is redrawn on release.
  slider.addEventListener("input", () => show(Number(slider.value)));
  slider.addEventListener("change", () => {
    if (slider.disabled) return;
    void OBR.scene.setMetadata({ [UI_SCALE_KEY]: Number(slider.value) });
  });

  mapSlider.addEventListener("input", () => showMap(Number(mapSlider.value)));
  mapSlider.addEventListener("change", () => {
    void OBR.scene.setMetadata({ [MAP_SCALE_KEY]: Number(mapSlider.value) });
  });
  labelSlider.addEventListener("input", () => showLabel(Number(labelSlider.value)));
  labelSlider.addEventListener("change", () => {
    void OBR.scene.setMetadata({ [LABEL_SCALE_KEY]: Number(labelSlider.value) });
  });
  document.getElementById("import")!.addEventListener("click", () => {
    void OBR.modal.open({ id: IMPORT_MODAL_ID, url: "/map-import.html", width: 620, height: 520 });
  });

  animated.checked = readAnimated();
  animated.addEventListener("change", () => {
    writeAnimated(animated.checked);
    void OBR.broadcast.sendMessage(ANIMATED_KEY, animated.checked, { destination: "LOCAL" });
  });

  const load = async (ready: boolean) => {
    slider.disabled = slider.disabled || !ready;
    if (ready) {
      applyRole(await OBR.player.getRole());
      const metadata = await OBR.scene.getMetadata();
      show(readUiScale(metadata));
      showMap(readMapScale(metadata));
      showLabel(readLabelScale(metadata));
    }
  };
  OBR.scene.onReadyChange(load);
  await load(await OBR.scene.isReady());
  OBR.scene.onMetadataChange((metadata) => {
    if (document.activeElement !== slider) show(readUiScale(metadata));
    if (document.activeElement !== mapSlider) showMap(readMapScale(metadata));
    if (document.activeElement !== labelSlider) showLabel(readLabelScale(metadata));
  });
});
