export type RasterTile = {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  outputWidth: number;
  outputHeight: number;
  reduction: number;
};

export type RasterTilePlanInput = {
  sourceWidth: number;
  sourceHeight: number;
  renderedWidth: number;
  renderedHeight: number;
  canvasLeft: number;
  canvasTop: number;
  scrollLeft: number;
  scrollTop: number;
  viewportWidth: number;
  viewportHeight: number;
  tileScreenSize?: number;
  overscan?: number;
};

function powerOfTwoReduction(scale: number) {
  if (!(scale > 0) || !Number.isFinite(scale)) return 1;
  return Math.max(1, 2 ** Math.max(0, Math.round(Math.log2(1 / scale))));
}

export function planRasterTiles(input: RasterTilePlanInput): RasterTile[] {
  const {
    sourceWidth, sourceHeight, renderedWidth, renderedHeight,
    canvasLeft, canvasTop, scrollLeft, scrollTop,
    viewportWidth, viewportHeight,
    tileScreenSize = 256, overscan = 1,
  } = input;
  if (![sourceWidth, sourceHeight, renderedWidth, renderedHeight, viewportWidth, viewportHeight].every((value) => Number.isFinite(value) && value > 0)) return [];

  const scaleX = renderedWidth / sourceWidth;
  const scaleY = renderedHeight / sourceHeight;
  const reduction = powerOfTwoReduction(Math.min(scaleX, scaleY));
  const sourceTile = tileScreenSize * reduction;

  const localLeft = scrollLeft - canvasLeft;
  const localTop = scrollTop - canvasTop;
  const localRight = localLeft + viewportWidth;
  const localBottom = localTop + viewportHeight;
  const sourceLeft = Math.max(0, localLeft / scaleX);
  const sourceTop = Math.max(0, localTop / scaleY);
  const sourceRight = Math.min(sourceWidth, localRight / scaleX);
  const sourceBottom = Math.min(sourceHeight, localBottom / scaleY);
  if (sourceRight <= 0 || sourceBottom <= 0 || sourceLeft >= sourceWidth || sourceTop >= sourceHeight) return [];

  const minCol = Math.max(0, Math.floor(sourceLeft / sourceTile) - overscan);
  const minRow = Math.max(0, Math.floor(sourceTop / sourceTile) - overscan);
  const maxCol = Math.min(Math.ceil(sourceWidth / sourceTile) - 1, Math.floor(sourceRight / sourceTile) + overscan);
  const maxRow = Math.min(Math.ceil(sourceHeight / sourceTile) - 1, Math.floor(sourceBottom / sourceTile) + overscan);
  const tiles: RasterTile[] = [];
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const x = col * sourceTile;
      const y = row * sourceTile;
      const width = Math.min(sourceTile, sourceWidth - x);
      const height = Math.min(sourceTile, sourceHeight - y);
      tiles.push({
        key: `${reduction}:${col}:${row}`,
        x, y, width, height,
        outputWidth: Math.max(1, Math.ceil(width / reduction)),
        outputHeight: Math.max(1, Math.ceil(height / reduction)),
        reduction,
      });
    }
  }
  return tiles;
}
