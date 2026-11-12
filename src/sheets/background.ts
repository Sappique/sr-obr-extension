/**
 * Opens the screen-fixed popovers on every client: the crew sidebar (left edge,
 * vertically centred) and the dice roll popups (bottom right, left of OBR's right
 * toolbar column and grid-scale button). Both size themselves to their content; the dice page
 * also places its popover and follows window size changes.
 */
import OBR from "@owlbear-rodeo/sdk";
import { DICE_POPOVER, DICE_READY_CHANNEL, diceRect, SHEET_POPOVER, SHEET_POPOVER_POS, SIDEBAR_POPOVER } from "./model";

/** Opens the dice popover once at its spot; dice.html then sizes and places it itself (top-left anchored). */
function openDice(width: number, height: number) {
  return OBR.popover.open({
    id: DICE_POPOVER,
    url: "/dice.html", // must match src/dice/dice.ts exactly, or a re-open reloads the page
    // A position-anchored popover opened at 0×0 never loads its page; 1×1 does, and the
    // page shrinks it to 0×0 itself while no roll is showing.
    width: 1,
    height: 1,
    anchorReference: "POSITION",
    anchorPosition: diceRect(width, height, 1, 1),
    anchorOrigin: { horizontal: "LEFT", vertical: "TOP" },
    transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
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
  // Opening a second popover in the same tick leaves it blank, so give the sidebar a moment.
  await new Promise((r) => setTimeout(r, 1500));
  // OBR sometimes drops a popover.open made while other popovers are opening: retry until
  // dice.html reports that it runs (re-opening it after that would reset its size).
  let diceUp = false;
  OBR.broadcast.onMessage(DICE_READY_CHANNEL, () => (diceUp = true));
  for (let i = 0; i < 10 && !diceUp; i++) {
    try {
      void openDice(await OBR.viewport.getWidth(), await OBR.viewport.getHeight()).catch(() => {});
    } catch {
      /* viewport not ready yet: retry */
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
});
