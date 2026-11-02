// Percentage coordinates in the ORIGINAL 1920×1080 image, not the viewport.
export const tilePositions = [
  [1, 16, 71],
  [2, 9, 51],
  [3, 10, 36],
  [4, 17, 22],
  [5, 27, 24],
  [6, 37, 21],
  [7, 47, 16],
  [8, 58, 17],
  [9, 67, 30],
  [10, 59, 47],
  [11, 48, 49],
  [12, 34, 49],
  [13, 28, 69],
  [14, 38, 82],
  [15, 50, 81],
  [16, 63, 74],
  [17, 68, 55],
  [18, 81, 48],
  [19, 90, 57],
  [20, 86, 82],
].map(([id, x, y]) => ({ id, x, y }));
export const startPosition = { x: 23, y: 83 };
