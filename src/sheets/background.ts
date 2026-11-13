/**
 * Opens the screen-fixed popovers on every client: the crew sidebar (left edge,
 * vertically centred) and the open sheet, both sized by their pages, and starts the dice
 * manager (one popover per roll, bottom right; see src/dice/manager.ts).
 */
import OBR from "@owlbear-rodeo/sdk";
import { startDiceManager } from "../dice/manager";
import { SHEET_POPOVER, SHEET_POPOVER_POS, SIDEBAR_POPOVER } from "./model";

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
  void startDiceManager();
});
