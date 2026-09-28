import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';

import type { Map as LeafletMap } from 'leaflet';
import type { Theme, SxProps } from '@mui/material/styles';

import L from 'leaflet';
import { useTranslation } from 'react-i18next';
import { useRef, useMemo, useState, useEffect } from 'react';
import { useMap, Tooltip, GeoJSON, TileLayer, MapContainer } from 'react-leaflet';

import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';

// ----------------------------------------------------------------------

/** A zone's outline as the server stores it: a GeoJSON Polygon of [lng, lat] points. */
export type ZonePolygon = { type: 'Polygon'; coordinates: number[][][] };

export type MapZone = { id: string; name: string; polygon?: ZonePolygon | null };

/** Where the map opens when there is nothing drawn yet: central Tehran. */
const DEFAULT_CENTER: [number, number] = [35.6997, 51.338];
const DEFAULT_ZOOM = 12;

/**
 * The drawing tools (Geoman) are a plain script that looks for Leaflet on `window.L` and
 * adds itself to maps made after it loads. So Leaflet goes on the window first, and a map
 * that draws is only made once the tools are in.
 */
let geomanLoading: Promise<unknown> | null = null;
function loadDrawingTools() {
  if (!geomanLoading) {
    (window as unknown as { L: typeof L }).L = L;
    geomanLoading = import('@geoman-io/leaflet-geoman-free');
  }
  return geomanLoading;
}

const isPolygon = (value: unknown): value is ZonePolygon =>
  !!value && (value as ZonePolygon).type === 'Polygon' && Array.isArray((value as ZonePolygon).coordinates);

/** Opens the map on what is drawn, and fixes Leaflet's size once a dialog has finished opening. */
function FitTo({ polygons }: { polygons: ZonePolygon[] }) {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
      if (polygons.length) {
        const bounds = L.geoJSON({ type: 'FeatureCollection', features: polygons.map((geometry) => ({ type: 'Feature', geometry, properties: {} })) } as any).getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
      }
    }, 150);
    return () => clearTimeout(timer);
    // Only when the map opens: refitting on every edit would jump under the pointer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  return null;
}

/**
 * The drawing tools, for one zone. Drawing a new outline replaces the old one, so a zone
 * only ever has one; the bin clears it.
 */
function DrawZone({ initial, color, onChange }: { initial: ZonePolygon | null; color: string; onChange: (value: ZonePolygon | null) => void }) {
  const map = useMap();
  const { i18n } = useTranslation();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const pm = (map as LeafletMap & { pm: any }).pm;
    pm.setLang(i18n.language === 'fa' ? 'fa' : 'en');
    pm.setPathOptions({ color, fillColor: color, fillOpacity: 0.2 });
    pm.addControls({
      position: 'topleft',
      drawPolygon: true,
      editMode: true,
      removalMode: true,
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawRectangle: false,
      drawCircle: false,
      drawText: false,
      cutPolygon: false,
      rotateMode: false,
      dragMode: false,
    });

    let layer: L.Polygon | null = null;
    const emit = () => onChangeRef.current(layer ? (layer.toGeoJSON().geometry as ZonePolygon) : null);
    const watch = (target: L.Polygon) => target.on('pm:edit', emit);

    if (initial) {
      layer = L.geoJSON(initial as any, { style: { color, fillOpacity: 0.2 } }).getLayers()[0] as L.Polygon;
      layer.addTo(map);
      watch(layer);
    }

    const onCreate = (event: any) => {
      if (layer) map.removeLayer(layer);
      layer = event.layer as L.Polygon;
      watch(layer);
      emit();
    };
    const onRemove = (event: any) => {
      if (event.layer === layer) {
        layer = null;
        emit();
      }
    };
    map.on('pm:create', onCreate);
    map.on('pm:remove', onRemove);

    return () => {
      map.off('pm:create', onCreate);
      map.off('pm:remove', onRemove);
      pm.removeControls();
      if (layer) map.removeLayer(layer);
    };
    // The outline starts from `initial` once; after that the map holds it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  return null;
}

type ZoneMapProps = {
  /** The branch's zones, drawn for reference and named on hover. */
  zones: MapZone[];
  /** With `onChange`, the map edits this zone's outline; the other zones stay faint behind it. */
  editing?: { id?: string; polygon: ZonePolygon | null; onChange: (value: ZonePolygon | null) => void };
  height?: number;
  sx?: SxProps<Theme>;
};

/**
 * Delivery zones on an OpenStreetMap. The outline is only a picture of the area in V1: the
 * till still picks a zone by postal code.
 */
export function ZoneMap({ zones, editing, height = 320, sx }: ZoneMapProps) {
  const theme = useTheme();
  const shown = useMemo(() => zones.filter((zone) => isPolygon(zone.polygon) && zone.id !== editing?.id), [zones, editing?.id]);
  const fitTo = useMemo(
    () => [...shown.map((zone) => zone.polygon as ZonePolygon), ...(editing?.polygon ? [editing.polygon] : [])],
    // The map fits once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // A map that draws waits for the drawing tools; one that only shows does not need them.
  const [toolsReady, setToolsReady] = useState(!editing);
  useEffect(() => {
    if (!editing) return undefined;
    let live = true;
    loadDrawingTools().then(() => live && setToolsReady(true));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    // Leaflet lays its controls out left to right whatever the page's direction.
    <Box dir="ltr" sx={[{ height, borderRadius: 1.5, overflow: 'hidden', border: 1, borderColor: 'divider', '& .leaflet-container': { height: 1, fontFamily: 'inherit' } }, ...(Array.isArray(sx) ? sx : [sx])]}>
      {toolsReady && (
      <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {shown.map((zone) => (
          <GeoJSON
            key={zone.id}
            data={zone.polygon as any}
            style={{
              color: editing ? theme.palette.grey[500] : theme.palette.primary.main,
              weight: 2,
              fillOpacity: editing ? 0.08 : 0.18,
            }}
          >
            <Tooltip sticky>{zone.name}</Tooltip>
          </GeoJSON>
        ))}
        {editing && <DrawZone initial={editing.polygon} color={theme.palette.primary.main} onChange={editing.onChange} />}
        <FitTo polygons={fitTo} />
      </MapContainer>
      )}
    </Box>
  );
}
