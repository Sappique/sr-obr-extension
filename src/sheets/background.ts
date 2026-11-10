/**
 * Opens the screen-fixed popovers on every client: the crew sidebar (left edge,
 * vertically centred) and the dice roll popups (bottom left, above OBR's menu
 * button). Both start at 0×0 and size themselves to their content.
 */
import OBR from "@owlbear-rodeo/sdk";
import { DICE_POPOVER, SIDEBAR_POPOVER } from "./model";

/** Space kept free below the dice popups for OBR's bottom-left menu button. */
const DICE_BOTTOM_GAP = 64;

async function openDice(height: number) {
  await OBR.popover.open({
    id: DICE_POPOVER,
    url: "/dice.html",
    // A position-anchored popover opened at 0×0 never loads its page; 1×1 does, and the
    // page shrinks it to 0×0 itself while no roll is showing.
    width: 1,
    height: 1,
    anchorReference: "POSITION",
    anchorPosition: { left: 8, top: height - DICE_BOTTOM_GAP },
    anchorOrigin: { horizontal: "LEFT", vertical: "BOTTOM" },
    transformOrigin: { horizontal: "LEFT", vertical: "BOTTOM" },
    disableClickAway: true,
    hidePaper: true,
    marginThreshold: 0,
  });
}

OBR.onReady(async () => {
  // Not awaited: popover.open does not always resolve, and the dice popover must open regardless.
  void OBR.popover.open({
    id: SIDEBAR_POPOVER,
    url: "/sidebar.html",
    width: 0,
    height: 0,
    anchorOrigin: { horizontal: "LEFT", vertical: "CENTER" },
    transformOrigin: { horizontal: "LEFT", vertical: "CENTER" },
    disableClickAway: true,
    hidePaper: true,
    marginThreshold: 8,
  });
  // The dice popover is anchored to a screen position; follow window height changes.
  // Opening a second popover in the same tick leaves it blank, so give the sidebar a moment.
  await new Promise((r) => setTimeout(r, 1500));
  let height = await OBR.viewport.getHeight();
  void openDice(height);
  setInterval(async () => {
    const h = await OBR.viewport.getHeight();
    if (h !== height) {
      height = h;
      void openDice(h);
    }
  }, 3000);
});
