/** Design 14 window tokens. Scene units = design px x SCALE. */
export const SCALE = 0.72;

export const COLOR = {
  yellow: "#f5e10a",
  cyan: "#5fcfdc",
  panel: "#07080c",
  sceneBg: "#1e2130",
  white: "#ffffff",
  black: "#000000",
  body: "#c9d3d8",
  dim: "#74828a",
};

export const UI_SCALE = { default: 1, min: 0.5, max: 2, step: 0.05 };

/** Every size scales with the global window scale. */
export function windowTokens(scale: number) {
  const u = (n: number) => n * SCALE * scale;
  return {
    defaultWidth: u(460),
    minWidth: u(260),
    cut: u(26),
    border: u(3),
    shadow: { offset: u(16), stripe: u(5), period: u(14), opacity: 0.34 },
    header: {
      padTop: u(12),
      padBottom: u(10),
      padLeft: u(22),
      padRight: u(44),
      gap: u(14),
      tint: 0.12,
      lineOpacity: 0.3,
      lineHeight: u(1),
      underlineHeight: u(3),
      title: { size: u(28), spacing: 0.06, lineHeight: 1.08 },
      tag: { size: u(13), spacing: 0.12, padX: u(8), padY: u(5) },
    },
    body: {
      padTop: u(14),
      padX: u(22),
      padBottom: u(22),
      size: u(19),
      lineHeight: 1.38,
      paragraphBottom: u(6),
      bulletIndent: u(20),
      bulletRadius: u(5),
      taskIndent: u(30),
      taskRadius: u(12.5),
      taskBorder: u(2),
      itemGap: u(2),
    },
    heading: {
      /** Index 0 = H1 ... index 5 = H6. */
      sizes: [u(22), u(18), u(15), u(12.5), u(12), u(11.5)],
      spacing: 0.18,
      lineHeight: 1.3,
      top: u(14),
      bottom: u(6),
      /** H1-H3 get a line filling the rest of the row. */
      linedDepth: 3,
      lineGap: u(8),
      lineThickness: u(1),
      lineOpacity: 0.22,
    },
    code: { size: u(16), top: u(6), bottom: u(6) },
    quote: { top: u(8), bottom: u(8), indent: u(18), bar: u(3), color: "#8f9ca3", boldColor: "#b3c0c6" },
    callout: {
      top: u(10),
      bottom: u(6),
      padY: u(10),
      padX: u(14),
      border: u(1),
      tint: 0.07,
      titleSize: u(34),
      titleLineHeight: 1.1,
      titleBottom: u(4),
      labelSize: u(13),
      labelSpacing: 0.15,
    },
    rule: { top: u(8), bottom: u(8), height: u(1), opacity: 0.22 },
    connector: {
      width: u(3),
      dash: [u(12), u(9)],
      opacity: 0.8,
      portRadius: u(11.3),
      sideOffset: u(60),
      /** Distance of a shared trunk from the window it leaves. */
      trunkOffset: u(36),
      /** Free space lines keep around windows and their shadows. */
      clearance: u(10),
      bendCost: u(80),
      portGap: u(34),
    },
  };
}

export type WindowTokens = ReturnType<typeof windowTokens>;
export const WINDOW = windowTokens(UI_SCALE.default);
