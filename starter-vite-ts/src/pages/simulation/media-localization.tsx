import type { Product } from 'src/api/catalogApi';
import type { FileAssetDto } from 'src/api/mediaApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import SaveIcon from '@mui/icons-material/Save';
import {
  Box,
  Card,
  Grid,
  Stack,
  Alert,
  Button,
  MenuItem,
  TextField,
  Typography,
  CardContent,
} from '@mui/material';

import { catalogApi } from 'src/api/catalogApi';
import { localizationApi } from 'src/api/localizationApi';

import { ImageUploader } from 'src/components/ImageUploader';
import { BilingualInput } from 'src/components/BilingualInput';

export function MediaLocalizationDemoPage() {
  const { t } = useTranslation();

  // Translations belong to a real menu item; the page used to write them against a made-up id.
  const [products, setProducts] = useState<Product[]>([]);
  const [entityId, setEntityId] = useState('');

  const [productTitleFa, setProductTitleFa] = useState('');
  const [productTitleEn, setProductTitleEn] = useState('');

  const [descriptionFa, setDescriptionFa] = useState('');
  const [descriptionEn, setDescriptionEn] = useState('');

  const [uploadedAsset, setUploadedAsset] = useState<FileAssetDto | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    catalogApi
      .getProducts()
      .then((list) => setProducts(list.filter((p) => p.is_active !== false)))
      .catch(() => setProducts([]));
  }, []);

  useEffect(() => {
    const product = products.find((p) => p.id === entityId);
    if (!product) return;
    localizationApi
      .getBilingualMap('PRODUCT', product.id)
      .catch(() => ({}) as Record<string, Record<string, string>>)
      .then((map) => {
        setProductTitleFa(map.name?.fa || product.name || '');
        setProductTitleEn(map.name?.en || '');
        setDescriptionFa(map.description?.fa || product.description || '');
        setDescriptionEn(map.description?.en || '');
      });
  }, [entityId, products]);

  const handleSaveTranslations = async () => {
    if (!entityId) return;
    try {
      const strings = [
        { entity_type: 'PRODUCT', entity_id: entityId, field_name: 'name', locale: 'fa', text_value: productTitleFa },
        { entity_type: 'PRODUCT', entity_id: entityId, field_name: 'name', locale: 'en', text_value: productTitleEn },
        { entity_type: 'PRODUCT', entity_id: entityId, field_name: 'description', locale: 'fa', text_value: descriptionFa },
        { entity_type: 'PRODUCT', entity_id: entityId, field_name: 'description', locale: 'en', text_value: descriptionEn },
      ].filter((row) => row.text_value.trim());
      await localizationApi.upsertStrings(strings);
      setStatus(t('settings.localizationPage.saveSuccess', 'Bilingual localized strings saved successfully!'));
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.message || err.detail || t('settings.localizationPage.saveError', 'Failed to save translations'));
    }
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'bold', mb: 1 }}>
        {t('settings.localizationPage.title', 'Media Assets & Bilingual Localization Studio')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t(
          'settings.localizationPage.subtitle',
          'Upload media images with SHA256 checksums and manage bilingual Persian/English product translations'
        )}
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
                {t('settings.localizationPage.mediaCardTitle', 'Media File Asset Upload (AD-18)')}
              </Typography>
              <ImageUploader
                label={t('settings.localizationPage.uploaderLabel', 'Product Image Media Asset')}
                onUploadSuccess={(asset) => {
                  setUploadedAsset(asset);
                  setStatus(t('settings.localizationPage.uploadSuccess', 'Image asset uploaded successfully: {{url}}', { url: asset.url }));
                }}
              />

              {uploadedAsset && (
                <Box sx={{ mt: 3, p: 2, bgcolor: 'background.default', borderRadius: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                    {t('settings.localizationPage.assetMetadata', 'Asset Metadata:')}
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
                {t('settings.localizationPage.bilingualCardTitle', 'Bilingual Localized Content (Persian & English)')}
              </Typography>

              <Stack spacing={3}>
                <TextField
                  select
                  fullWidth
                  label={t('settings.localizationPage.selectProduct', 'Menu item')}
                  value={entityId}
                  onChange={(e) => setEntityId(e.target.value)}
                >
                  {products.map((p) => (
                    <MenuItem key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </MenuItem>
                  ))}
                </TextField>

                <BilingualInput
                  label={t('settings.localizationPage.productTitle', 'Product Title')}
                  faValue={productTitleFa}
                  enValue={productTitleEn}
                  onFaChange={setProductTitleFa}
                  onEnChange={setProductTitleEn}
                  required
                />

                <BilingualInput
                  label={t('settings.localizationPage.productDescription', 'Product Description')}
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
                  disabled={!entityId}
                  sx={{ fontWeight: 'bold', alignSelf: 'flex-start' }}
                >
                  {t('settings.localizationPage.saveButton', 'Save Localized Strings')}
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
