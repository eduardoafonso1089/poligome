import { performance } from 'node:perf_hooks';
import { planRasterTiles } from '../app/editor/raster/tile-plan.ts';

const ITERATIONS = Number(process.env.COG_BENCH_ITERATIONS ?? 20_000);
const SOURCE = { width: 50_000, height: 30_000 };
const VIEWPORT = { width: 1000, height: 700 };

const scenarios = [
  { name: 'fit', renderedWidth: 1000, renderedHeight: 600 },
  { name: 'native', renderedWidth: 50_000, renderedHeight: 30_000 },
  { name: 'deep-2x', renderedWidth: 100_000, renderedHeight: 60_000 },
];

function runScenario(scenario) {
  let tileCount = 0;
  let decodedPixels = 0;
  const started = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    const maxX = Math.max(1, scenario.renderedWidth - VIEWPORT.width);
    const maxY = Math.max(1, scenario.renderedHeight - VIEWPORT.height);
    const scrollLeft = (i * 211) % maxX;
    const scrollTop = (i * 137) % maxY;
    const tiles = planRasterTiles({
      sourceWidth: SOURCE.width,
      sourceHeight: SOURCE.height,
      renderedWidth: scenario.renderedWidth,
      renderedHeight: scenario.renderedHeight,
      canvasLeft: 0,
      canvasTop: 0,
      scrollLeft,
      scrollTop,
      viewportWidth: VIEWPORT.width,
      viewportHeight: VIEWPORT.height,
    });
    tileCount += tiles.length;
    for (const tile of tiles) decodedPixels += tile.outputWidth * tile.outputHeight;
  }
  const elapsed = performance.now() - started;
  return {
    scenario: scenario.name,
    iterations: ITERATIONS,
    elapsedMs: Math.round(elapsed * 100) / 100,
    plansPerSecond: Math.round(ITERATIONS / elapsed * 1000),
    averageTiles: Math.round(tileCount / ITERATIONS * 100) / 100,
    averageDecodedMegapixels: Math.round(decodedPixels / ITERATIONS / 1_000_000 * 1000) / 1000,
  };
}

console.table(scenarios.map(runScenario));
