import { BadRequestException } from '@nestjs/common';

/** A zone's outline as drawn on the map: a GeoJSON Polygon, one outer ring, [lng, lat] points. */
export type ZonePolygon = { type: 'Polygon'; coordinates: number[][][] };

const refuse = (detail: string) =>
  new BadRequestException({ code: 'ZONE_SHAPE_INVALID', title: 'Zone Shape Not Valid', detail });

/**
 * Checks and tidies a zone's outline. Nothing (null, undefined) clears it: a zone without one
 * still works, since the till picks the zone by postal code. The ring is closed if it was left
 * open, and needs three distinct corners at least.
 */
export function normalizeZonePolygon(value: unknown): ZonePolygon | null {
  if (value === null || value === undefined) return null;
  const shape = value as any;
  if (shape?.type !== 'Polygon' || !Array.isArray(shape.coordinates) || !Array.isArray(shape.coordinates[0])) {
    throw refuse('A zone is drawn as one polygon.');
  }

  const ring: number[][] = shape.coordinates[0].map((point: unknown) => {
    const [lng, lat] = Array.isArray(point) ? point.map(Number) : [NaN, NaN];
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) {
      throw refuse('A corner of the zone is not a point on the map.');
    }
    return [lng, lat];
  });

  const [first] = ring;
  const last = ring[ring.length - 1];
  if (first && (first[0] !== last[0] || first[1] !== last[1])) ring.push([first[0], first[1]]);
  if (ring.length < 4) throw refuse('A zone needs at least three corners.');

  return { type: 'Polygon', coordinates: [ring] };
}
