import React, { useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Stack,
  Button,
  Alert,
  Divider,
  Grid,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';

import { ImageUploader } from 'src/components/ImageUploader';
import { BilingualInput } from 'src/components/BilingualInput';
import { mediaApi, FileAssetDto } from 'src/api/mediaApi';
import { localizationApi } from 'src/api/localizationApi';

export function MediaLocalizationDemoPage() {
  const [productTitleFa, setProductTitleFa] = useState('همبرگر مخصوص اسپشال');
  const [productTitleEn, setProductTitleEn] = useState('Special Beef Burger');

  const [descriptionFa, setDescriptionFa] = useState('تهیه شده از گوشت تازه گوساله و پنیر گودا');
  const [descriptionEn, setDescriptionEn] = useState('Made with fresh beef patty and gouda cheese');

  const [uploadedAsset, setUploadedAsset] = useState<FileAssetDto | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dummyEntityId = '00000000-0000-0000-0000-000000000001';

  const handleSaveTranslations = async () => {
    try {
      await localizationApi.upsertStrings([
        { entity_type: 'PRODUCT', entity_id: dummyEntityId, field_name: 'name', locale: 'fa', text_value: productTitleFa },
        { entity_type: 'PRODUCT', entity_id: dummyEntityId, field_name: 'name', locale: 'en', text_value: productTitleEn },
        { entity_type: 'PRODUCT', entity_id: dummyEntityId, field_name: 'description', locale: 'fa', text_value: descriptionFa },
        { entity_type: 'PRODUCT', entity_id: dummyEntityId, field_name: 'description', locale: 'en', text_value: descriptionEn },
      ]);
      setStatus('Bilingual localized strings saved successfully!');
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to save translations');
    }
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'bold', mb: 1 }}>
        Media Assets & Bilingual Localization Studio
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Upload media images with SHA256 checksums and manage bilingual Persian/English product translations
      </Typography>

      {status && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setStatus(null)}>
          {status}
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Media Asset Uploader */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
                Media File Asset Upload (AD-18)
              </Typography>
              <ImageUploader
                label="Product Image Media Asset"
                onUploadSuccess={(asset) => {
                  setUploadedAsset(asset);
                  setStatus(`Image asset uploaded successfully: ${asset.url}`);
                }}
              />

              {uploadedAsset && (
                <Box sx={{ mt: 3, p: 2, bgcolor: 'background.default', borderRadius: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                    Asset Metadata:
                  </Typography>
                  <Typography variant="body2">ID: <code>{uploadedAsset.id}</code></Typography>
                  <Typography variant="body2">URL: <code>{uploadedAsset.url}</code></Typography>
                  <Typography variant="body2">MIME: <code>{uploadedAsset.mime_type}</code></Typography>
                  <Typography variant="body2">SHA256: <code style={{ fontSize: '0.75rem' }}>{uploadedAsset.checksum_sha256}</code></Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Bilingual Inputs */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
                Bilingual Localized Content (Persian & English)
              </Typography>

              <Stack spacing={3}>
                <BilingualInput
                  label="Product Title"
                  faValue={productTitleFa}
                  enValue={productTitleEn}
                  onFaChange={setProductTitleFa}
                  onEnChange={setProductTitleEn}
                  required
                />

                <BilingualInput
                  label="Product Description"
                  multiline
                  rows={3}
                  faValue={descriptionFa}
                  enValue={descriptionEn}
                  onFaChange={setDescriptionFa}
                  onEnChange={setDescriptionEn}
                />

                <Button
                  variant="contained"
                  startIcon={<SaveIcon />}
                  onClick={handleSaveTranslations}
                  sx={{ fontWeight: 'bold', alignSelf: 'flex-start' }}
                >
                  Save Localized Strings
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
