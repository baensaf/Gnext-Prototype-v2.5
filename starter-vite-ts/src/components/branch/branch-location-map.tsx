import 'leaflet/dist/leaflet.css';

import type { LeafletMouseEvent } from 'leaflet';

import L from 'leaflet';
import { useTranslation } from 'react-i18next';
import { useMemo, useState, useEffect } from 'react';
import { Marker, useMap, TileLayer, MapContainer, useMapEvents } from 'react-leaflet';

import { useTheme } from '@mui/material/styles';
import SearchIcon from '@mui/icons-material/Search';
import {
  Box,
  List,
  Paper,
  Stack,
  Button,
  TextField,
  Typography,
  ListItemButton,
  InputAdornment,
  CircularProgress,
} from '@mui/material';

// ----------------------------------------------------------------------

export type Pin = { latitude: number; longitude: number };

/** Where the map opens for a branch with no pin yet: central Tehran. */
const TEHRAN: [number, number] = [35.6997, 51.338];

/** A map pin drawn in the theme's colour; Leaflet's own marker images do not survive bundling. */
const pinIcon = (color: string) =>
  L.divIcon({
    className: '',
    iconSize: [32, 42],
    iconAnchor: [16, 42],
    html: `<svg width="32" height="42" viewBox="0 0 32 42" xmlns="http://www.w3.org/2000/svg"><path d="M16 0C7.2 0 0 7 0 15.7 0 27.5 16 42 16 42s16-14.5 16-26.3C32 7 24.8 0 16 0z" fill="${color}"/><circle cx="16" cy="15.5" r="6" fill="#fff"/></svg>`,
  });

/** Places the pin where the map is clicked. */
function ClickToPlace({ onPick }: { onPick: (pin: Pin) => void }) {
  useMapEvents({
    click: (e: LeafletMouseEvent) => onPick({ latitude: e.latlng.lat, longitude: e.latlng.lng }),
  });
  return null;
}

/** Moves the view to the pin when it is placed from outside the map (a search result). */
function FollowPin({ pin, version }: { pin: Pin | null; version: number }) {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 150);
    return () => clearTimeout(timer);
  }, [map]);
  useEffect(() => {
    if (pin && version > 0) map.setView([pin.latitude, pin.longitude], Math.max(map.getZoom(), 16));
    // Only when a search moves it: following every drag would jump under the pointer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  return null;
}

type SearchHit = { display_name: string; lat: string; lon: string };

type BranchLocationMapProps = {
  value: Pin | null;
  onChange?: (pin: Pin) => void;
  height?: number;
};

/**
 * The branch's pin on an OpenStreetMap map. Head office searches an address, clicks the map
 * or drags the pin. Without `onChange` it only shows where the branch is.
 */
export function BranchLocationMap({ value, onChange, height = 380 }: BranchLocationMapProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const icon = useMemo(() => pinIcon(theme.palette.primary.main), [theme.palette.primary.main]);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  // The address search is a separate service from the map: "nothing found" and "could not
  // ask" are different answers, and neither touches the pin already placed.
  const [searchFailed, setSearchFailed] = useState(false);
  const [moved, setMoved] = useState(0);

  const center: [number, number] = value ? [value.latitude, value.longitude] : TEHRAN;

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchFailed(false);
    try {
      const params = new URLSearchParams({ q, format: 'json', limit: '5', countrycodes: 'ir', 'accept-language': i18n.language });
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
      if (!res.ok) throw new Error(`search ${res.status}`);
      setHits(await res.json());
    } catch {
      setHits([]);
      setSearchFailed(true);
    } finally {
      setSearching(false);
    }
  };

  const pick = (hit: SearchHit) => {
    onChange?.({ latitude: Number(hit.lat), longitude: Number(hit.lon) });
    setHits(null);
    setMoved((n) => n + 1);
  };

  return (
    <Stack spacing={1.5}>
      {onChange && (
        <Box sx={{ position: 'relative' }}>
          <Stack direction="row" spacing={1}>
            <TextField
              fullWidth
              size="small"
              value={query}
              placeholder={t('branchMgmt.location.searchPlaceholder', 'Search an address or place')}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  search();
                }
              }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Button variant="outlined" onClick={search} disabled={searching || !query.trim()}>
              {searching ? <CircularProgress size={18} /> : t('branchMgmt.location.search', 'Search')}
            </Button>
          </Stack>
          {hits && (
            <Paper elevation={6} sx={{ position: 'absolute', zIndex: 1000, left: 0, right: 0, mt: 0.5, maxHeight: 260, overflow: 'auto' }}>
              {hits.length === 0 ? (
                <Typography variant="body2" color={searchFailed ? 'error' : 'text.secondary'} sx={{ p: 2 }}>
                  {searchFailed
                    ? t('branchMgmt.location.searchFailed', 'Address search is unavailable right now. Click the map to place the pin.')
                    : t('branchMgmt.location.noResults', 'Nothing found. Try another name, or click the map.')}
                </Typography>
              ) : (
                <List dense disablePadding>
                  {hits.map((hit) => (
                    <ListItemButton key={`${hit.lat},${hit.lon}`} onClick={() => pick(hit)}>
                      <Typography variant="body2">{hit.display_name}</Typography>
                    </ListItemButton>
                  ))}
                </List>
              )}
            </Paper>
          )}
        </Box>
      )}

      {/* Leaflet lays its controls out left to right whatever the page's direction. */}
      <Box
        dir="ltr"
        sx={{
          height,
          borderRadius: 1.5,
          overflow: 'hidden',
          border: 1,
          borderColor: 'divider',
          '& .leaflet-container': { height: 1, fontFamily: 'inherit', cursor: onChange ? 'crosshair' : 'grab' },
        }}
      >
        <MapContainer center={center} zoom={value ? 16 : 12} scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {value && (
            <Marker
              position={[value.latitude, value.longitude]}
              icon={icon}
              draggable={!!onChange}
              eventHandlers={{
                dragend: (e) => {
                  const { lat, lng } = (e.target as L.Marker).getLatLng();
                  onChange?.({ latitude: lat, longitude: lng });
                },
              }}
            />
          )}
          {onChange && <ClickToPlace onPick={onChange} />}
          <FollowPin pin={value} version={moved} />
        </MapContainer>
      </Box>

      <Typography variant="caption" color="text.secondary" dir="ltr" sx={{ textAlign: 'end' }}>
        {value
          ? `${value.latitude.toFixed(6)}, ${value.longitude.toFixed(6)}`
          : onChange
            ? t('branchMgmt.location.clickToPlace', 'Click the map to place the pin')
            : t('branchMgmt.location.none', 'No pin yet')}
      </Typography>
    </Stack>
  );
}
