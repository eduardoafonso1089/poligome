import proj4 from 'proj4';

// Offline definitions for common imagery in Brazil and international WGS84 UTM.
for (let zone = 1; zone <= 60; zone++) {
  proj4.defs(`EPSG:${32600 + zone}`, `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`);
  proj4.defs(`EPSG:${32700 + zone}`, `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs`);
}
proj4.defs('EPSG:4674', '+proj=longlat +ellps=GRS80 +towgs84=0,0,0 +no_defs');
for (let zone = 11; zone <= 22; zone++) proj4.defs(`EPSG:${31954 + zone}`, `+proj=utm +zone=${zone} +ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs`);
for (let zone = 17; zone <= 25; zone++) proj4.defs(`EPSG:${31960 + zone}`, `+proj=utm +zone=${zone} +south +ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs`);

export function toWgs84(crs: string): (point: [number, number]) => [number, number] {
  try {
    const converter = proj4(crs.trim(), 'EPSG:4326');
    return point => {
      if (!point.every(Number.isFinite)) throw new Error('rasterInvalidCoordinates');
      const result = converter.forward(point);
      if (!result.every(Number.isFinite) || Math.abs(result[0]) > 180 || Math.abs(result[1]) > 90) throw new Error('rasterInvalidCoordinates');
      return result;
    };
  } catch { throw new Error('rasterUnknownCrs'); }
}
