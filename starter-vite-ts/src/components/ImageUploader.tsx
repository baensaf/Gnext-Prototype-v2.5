import React, { useState } from 'react';
import {
  Box,
  Button,
  Typography,
  Stack,
  Card,
  CardMedia,
  CardContent,
  CircularProgress,
  Alert,
  Chip,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

import { mediaApi, FileAssetDto } from 'src/api/mediaApi';

interface ImageUploaderProps {
  value?: string;
  onUploadSuccess?: (asset: FileAssetDto) => void;
  label?: string;
}

export function ImageUploader({ value, onUploadSuccess, label = 'Upload Image' }: ImageUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(value || null);
  const [asset, setAsset] = useState<FileAssetDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (PNG, JPEG, WebP)');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const result = await mediaApi.uploadFile(file);
      setAsset(result);
      setPreviewUrl(`http://localhost:3000${result.url}`);
      if (onUploadSuccess) {
        onUploadSuccess(result);
      }
    } catch (err: any) {
      setError(err.detail || 'Failed to upload image asset');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card variant="outlined" sx={{ borderRadius: 2, p: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
        {label}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        {previewUrl ? (
          <Box sx={{ position: 'relative', width: 80, height: 80, borderRadius: 2, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.1)' }}>
            <CardMedia
              component="img"
              height="80"
              image={previewUrl}
              alt="Preview"
              sx={{ objectFit: 'cover' }}
            />
          </Box>
        ) : (
          <Box
            sx={{
              width: 80,
              height: 80,
              borderRadius: 2,
              border: '2px dashed rgba(0,0,0,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'action.hover',
            }}
          >
            <CloudUploadIcon color="disabled" />
          </Box>
        )}

        <Box sx={{ flexGrow: 1 }}>
          <Button
            component="label"
            variant="outlined"
            startIcon={uploading ? <CircularProgress size={16} /> : <CloudUploadIcon />}
            disabled={uploading}
            size="small"
            sx={{ fontWeight: 'bold' }}
          >
            {uploading ? 'Uploading...' : 'Choose File'}
            <input type="file" hidden accept="image/*" onChange={handleFileChange} />
          </Button>

          {asset && (
            <Stack direction="column" spacing={0.5} sx={{ mt: 1 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <CheckCircleIcon color="success" fontSize="small" />
                <Typography variant="caption" color="text.secondary">
                  {(asset.size_bytes / 1024).toFixed(1)} KB | {asset.mime_type}
                </Typography>
              </Stack>
              {asset.checksum_sha256 && (
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
                  SHA256: {asset.checksum_sha256.substring(0, 16)}...
                </Typography>
              )}
            </Stack>
          )}
        </Box>
      </Stack>
    </Card>
  );
}
