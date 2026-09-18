import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import StarIcon from '@mui/icons-material/Star';
import DeleteIcon from '@mui/icons-material/Delete';
import AddAPhotoIcon from '@mui/icons-material/AddAPhoto';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import { Box, Alert, Stack, Tooltip, IconButton, CircularProgress } from '@mui/material';

import { mediaApi } from 'src/api/mediaApi';

/**
 * A product's photos, main one first, as Snappfood's panel shows them: a row of tiles
 * and an add tile. The caller keeps the ids; this only uploads and reorders.
 */
export function ProductPhotos({
  ids,
  onChange,
  disabled,
}: {
  ids: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ids
      .filter((id) => !urls[id])
      .forEach((id) =>
        mediaApi
          .getFile(id)
          .then((asset) => setUrls((u) => ({ ...u, [id]: asset.url })))
          .catch(() => undefined)
      );
  }, [ids, urls]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError(t('catalog.productDetailPage.photos.notImage', 'Choose an image file (PNG, JPEG, WebP)'));
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const asset = await mediaApi.uploadFile(file);
      setUrls((u) => ({ ...u, [asset.id]: asset.url }));
      onChange([...ids, asset.id]);
    } catch (err: any) {
      setError(err.detail || t('catalog.productDetailPage.photos.uploadFailed', 'Could not upload the photo'));
    } finally {
      setUploading(false);
    }
  };

  const tile = { width: 120, height: 120, borderRadius: 2, overflow: 'hidden', position: 'relative' as const };

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5 }}>
        {ids.map((id, index) => (
          <Box key={id} sx={{ ...tile, border: 1, borderColor: index === 0 ? 'primary.main' : 'divider' }}>
            {urls[id] && <Box component="img" src={urls[id]} alt="" sx={{ width: 1, height: 1, objectFit: 'cover' }} />}
            {!disabled && (
              <Stack direction="row" sx={{ position: 'absolute', top: 4, insetInlineEnd: 4, gap: 0.5 }}>
                <Tooltip title={t('catalog.productDetailPage.photos.makeMain', 'Main photo')}>
                  <IconButton
                    size="small"
                    sx={{ bgcolor: 'background.paper' }}
                    onClick={() => onChange([id, ...ids.filter((x) => x !== id)])}
                  >
                    {index === 0 ? <StarIcon fontSize="small" color="warning" /> : <StarBorderIcon fontSize="small" />}
                  </IconButton>
                </Tooltip>
                <IconButton size="small" sx={{ bgcolor: 'background.paper' }} onClick={() => onChange(ids.filter((x) => x !== id))}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
            )}
          </Box>
        ))}
        {!disabled && (
          <Box
            component="label"
            sx={{
              ...tile,
              bgcolor: 'action.hover',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            {uploading ? <CircularProgress size={24} /> : <AddAPhotoIcon color="action" />}
            <input type="file" hidden accept="image/*" onChange={handleFile} />
          </Box>
        )}
      </Stack>
    </Box>
  );
}
