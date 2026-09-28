import { BadRequestException } from '@nestjs/common';
import { normalizeZonePolygon } from '../src/modules/delivery/zone-shape';

// A zone is drawn on the map and stored as a GeoJSON polygon. The till still picks the zone
// by postal code, so the outline is optional and only has to be a sensible shape.
describe('zone outline', () => {
  const square = [
    [51.38, 35.7],
    [51.4, 35.7],
    [51.4, 35.72],
    [51.38, 35.72],
  ];

  it('keeps a drawn polygon, closing the ring when it was left open', () => {
    const shape = normalizeZonePolygon({ type: 'Polygon', coordinates: [square] });
    expect(shape?.coordinates[0]).toHaveLength(5);
    expect(shape?.coordinates[0][4]).toEqual([51.38, 35.7]);
  });

  it('keeps an already closed ring as it is', () => {
    const shape = normalizeZonePolygon({ type: 'Polygon', coordinates: [[...square, [51.38, 35.7]]] });
    expect(shape?.coordinates[0]).toHaveLength(5);
  });

  it('clears the outline on null', () => {
    expect(normalizeZonePolygon(null)).toBeNull();
    expect(normalizeZonePolygon(undefined)).toBeNull();
  });

  it.each([
    ['not a polygon', { type: 'Point', coordinates: [51.38, 35.7] }],
    ['fewer than three corners', { type: 'Polygon', coordinates: [[[51.38, 35.7], [51.4, 35.7]]] }],
    ['a corner off the map', { type: 'Polygon', coordinates: [[[51.38, 35.7], [251.4, 35.7], [51.4, 35.72]]] }],
    ['a corner that is not a number', { type: 'Polygon', coordinates: [[[51.38, 35.7], ['x', 35.7], [51.4, 35.72]]] }],
  ])('refuses %s', (_label, value) => {
    expect(() => normalizeZonePolygon(value)).toThrow(BadRequestException);
  });
});
