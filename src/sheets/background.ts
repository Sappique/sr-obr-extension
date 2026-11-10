/**
 * Opens the screen-fixed popovers on every client: the crew sidebar (left edge,
 * vertically centred) and the dice roll popups (bottom right, left of OBR's right
 * toolbar column and grid-scale button). Both size themselves to their content.
 */
import OBR from "@owlbear-rodeo/sdk";
import { DICE_POPOVER, SHEET_POPOVER, SHEET_POPOVER_POS, SIDEBAR_POPOVER } from "./model";

/** Space kept free right of the dice popups: OBR's right toolbar and its "5ft" grid-scale button. */
const DICE_RIGHT_GAP = 80;
const DICE_BOTTOM_GAP = 16;

async function openDice(width: number, height: number) {
  await OBR.popover.open({
    id: DICE_POPOVER,
    url: "/dice.html",
    // A position-anchored popover opened at 0×0 never loads its page; 1×1 does, and the
    // page shrinks it to 0×0 itself while no roll is showing.
    width: 1,
    height: 1,
    anchorReference: "POSITION",
    anchorPosition: { left: width - DICE_RIGHT_GAP, top: height - DICE_BOTTOM_GAP },
    anchorOrigin: { horizontal: "RIGHT", vertical: "BOTTOM" },
    transformOrigin: { horizontal: "RIGHT", vertical: "BOTTOM" },
    disableClickAway: true,
    hidePaper: true,
    marginThreshold: 0,
  });
}

OBR.onReady(async () => {
  // Not awaited: popover.open does not always resolve, and the dice popover must open regardless.
  void OBR.popover.open({
    id: SIDEBAR_POPOVER,
    url: "/sidebar.html?part=strip",
    width: 0,
    height: 0,
    anchorOrigin: { horizontal: "LEFT", vertical: "CENTER" },
    transformOrigin: { horizontal: "LEFT", vertical: "CENTER" },
    disableClickAway: true,
    hidePaper: true,
    marginThreshold: 8,
  });
  // The open sheet: its own popover at a fixed top-left position, sized by its page
  // (1×1 to start: a position-anchored popover opened at 0×0 never loads its page).
  await new Promise((r) => setTimeout(r, 700));
  void OBR.popover.open({
    id: SHEET_POPOVER,
    url: "/sidebar.html?part=sheet",
    width: 1,
    height: 1,
    anchorReference: "POSITION",
    anchorPosition: SHEET_POPOVER_POS,
    anchorOrigin: { horizontal: "LEFT", vertical: "TOP" },
    transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
    disableClickAway: true,
    hidePaper: true,
    marginThreshold: 0,
  });
  // The dice popover is anchored to a screen position; follow window size changes.
  // Opening a second popover in the same tick leaves it blank, so give the sidebar a moment.
  await new Promise((r) => setTimeout(r, 1500));
  let size = `${await OBR.viewport.getWidth()}x${await OBR.viewport.getHeight()}`;
  void openDice(...(size.split("x").map(Number) as [number, number]));
  setInterval(async () => {
    const next = `${await OBR.viewport.getWidth()}x${await OBR.viewport.getHeight()}`;
    if (next !== size) {
      size = next;
      void openDice(...(next.split("x").map(Number) as [number, number]));
    }
  }, 3000);
});
