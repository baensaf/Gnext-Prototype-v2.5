import type { ChangeEvent } from 'react';
import type { ImportJobDto, ImportRowDto } from 'src/api/importExportApi';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Box,
  Card,
  Step,
  Grid,
  Chip,
  Table,
  Paper,
  Alert,
  Stack,
  Button,
  Stepper,
  Divider,
  MenuItem,
  TableRow,
  StepLabel,
  TextField,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  TableContainer,
  LinearProgress,
} from '@mui/material';

import { importExportApi } from 'src/api/importExportApi';

import { Iconify } from 'src/components/iconify';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

type ImportEntityType = 'CUSTOMERS' | 'PRODUCTS' | 'CATEGORIES';

const TARGET_FIELDS: Record<ImportEntityType, { field: string; labelKey: string; required?: boolean }[]> = {
  CUSTOMERS: [
    { field: 'code', labelKey: 'tools.importWizard.fields.code' },
    { field: 'first_name', labelKey: 'tools.importWizard.fields.first_name', required: true },
    { field: 'last_name', labelKey: 'tools.importWizard.fields.last_name', required: true },
    { field: 'mobile', labelKey: 'tools.importWizard.fields.mobile', required: true },
    { field: 'email', labelKey: 'tools.importWizard.fields.email' },
    { field: 'national_id', labelKey: 'tools.importWizard.fields.national_id' },
    { field: 'is_active', labelKey: 'tools.importWizard.fields.is_active' },
  ],
  PRODUCTS: [
    { field: 'code', labelKey: 'tools.importWizard.fields.code', required: true },
    { field: 'name_fa', labelKey: 'tools.importWizard.fields.name_fa', required: true },
    { field: 'name_en', labelKey: 'tools.importWizard.fields.name_en' },
    { field: 'category_code', labelKey: 'tools.importWizard.fields.category_code' },
    { field: 'is_active', labelKey: 'tools.importWizard.fields.is_active' },
  ],
  CATEGORIES: [
    { field: 'code', labelKey: 'tools.importWizard.fields.code', required: true },
    { field: 'name_fa', labelKey: 'tools.importWizard.fields.name_fa', required: true },
    { field: 'name_en', labelKey: 'tools.importWizard.fields.name_en' },
    { field: 'is_active', labelKey: 'tools.importWizard.fields.is_active' },
  ],
};

const DEFAULT_CSV_TEMPLATES: Record<ImportEntityType, string> = {
  CUSTOMERS: 'کد مشتری,نام,نام خانوادگی,شماره تماس,ایمیل,وضعیت\nCUST-101,علی,رضایی,09121112233,ali@example.com,فعال\nCUST-102,سارا,احمدی,09129998877,sara@example.com,فعال\nCUST-103,مریم,حسینی,invalid-phone,maryam@example.com,غیرفعال',
  PRODUCTS: 'کد کالا,نام فارسی,English Name,قیمت پایه,کد دسته بندی,وضعیت\nPROD-201,همبرگر مخصوص,Special Burger,250000,CAT-BURGER,فعال\nPROD-202,سیب زمینی سرخ کرده,French Fries,90000,CAT-SIDES,فعال\nPROD-203,پیتزا مخلوط,Mix Pizza,-10000,CAT-PIZZA,فعال',
  CATEGORIES: 'کد,عنوان دسته,Title EN,ترتیب,وضعیت\nCAT-BURGER,برگرها,Burgers,1,فعال\nCAT-SIDES,پیش غذا و پیش خوراک,Appetizers & Sides,2,فعال',
};

export function ImportWizardPage() {
  const { t } = useTranslation();

  const STEPS = [
    t('tools.importWizard.steps.step1', 'Upload File & Target Entity'),
    t('tools.importWizard.steps.step2', 'Column Mapping & Auto-Match'),
    t('tools.importWizard.steps.step3', 'Value Mapping'),
    t('tools.importWizard.steps.step4', 'Validation Preview'),
    t('tools.importWizard.steps.step5', 'Import Summary'),
  ];

  const [activeStep, setActiveStep] = useState(0);
  const [entityType, setEntityType] = useState<ImportEntityType>('PRODUCTS');
  const [fileName, setFileName] = useState<string>('products_catalog.csv');
  const [fileContent, setFileContent] = useState<string>(DEFAULT_CSV_TEMPLATES.PRODUCTS);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [activeJob, setActiveJob] = useState<ImportJobDto | null>(null);
  const [jobRows, setJobRows] = useState<ImportRowDto[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [distinctValues, setDistinctValues] = useState<Record<string, string[]>>({});
  const [valueMapping, setValueMapping] = useState<Record<string, Record<string, string>>>({
    is_active: { فعال: 'true', غیرفعال: 'false' },
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<{ importedCount: number; failedCount: number } | null>(null);

  const handleEntityChange = (newType: ImportEntityType) => {
    setEntityType(newType);
    setSelectedFile(null);
    setFileContent(DEFAULT_CSV_TEMPLATES[newType]);
    setFileName(`${newType.toLowerCase()}_import.csv`);
    setActiveJob(null);
    setJobRows([]);
    setErrorMsg(null);
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      const isXlsx = file.name.toLowerCase().endsWith('.xlsx');
      if (isXlsx) {
        setSelectedFile(file);
        setFileContent('');
      } else {
        setSelectedFile(null);
        const reader = new FileReader();
        reader.onload = (event) => {
          const text = event.target?.result as string;
          setFileContent(text);
        };
        reader.readAsText(file);
      }
    }
  };

  const handleNext = async () => {
    setErrorMsg(null);
    setIsProcessing(true);

    try {
      if (activeStep === 0) {
        let job: ImportJobDto;
        if (selectedFile) {
          job = await importExportApi.uploadFileAsFormData(entityType, selectedFile);
        } else {
          if (!fileContent.trim()) {
            throw new Error('Please upload an Excel (.xlsx) file or provide CSV content');
          }
          job = await importExportApi.uploadFile(entityType, fileContent, fileName);
        }
        setActiveJob(job);

        // Auto-mapping setup
        const mappedCols = job.column_mapping || {};
        if (Object.keys(mappedCols).length > 0) {
          setColumnMapping(mappedCols);
        } else if (!selectedFile && fileContent.trim()) {
          const firstLine = fileContent.split(/\r?\n/)[0];
          const parsedHeaders = firstLine.split(/,|\t|;/).map((h) => h.replace(/^["']|["']$/g, '').trim());
          const autoMap = await importExportApi.autoMap(parsedHeaders, entityType);
          const mapObj: Record<string, string> = {};
          autoMap.forEach((m) => {
            if (m.mappedField) mapObj[m.header] = m.mappedField;
          });
          setColumnMapping(mapObj);
        }

        setActiveStep(1);
      } else if (activeStep === 1) {
        if (!activeJob) throw new Error('Active staged import job missing');
        const distinct = await importExportApi.getDistinctValues(activeJob.id, columnMapping);
        setDistinctValues(distinct);
        setActiveStep(2);
      } else if (activeStep === 2) {
        if (!activeJob) throw new Error('Active staged import job missing');
        const validatedJob = await importExportApi.validateJob(activeJob.id, columnMapping, valueMapping);
        setActiveJob(validatedJob);

        const detail = await importExportApi.getJobDetail(activeJob.id);
        setJobRows(detail.rows);
        setActiveStep(3);
      } else if (activeStep === 3) {
        if (!activeJob) throw new Error('Active staged import job missing');
        const result = await importExportApi.executeJob(activeJob.id);
        setImportSummary(result);
        setActiveStep(4);
      }
    } catch (err: any) {
      setErrorMsg(err.detail || err.message || t('common.errorOccurred', 'Import step operation failed'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBack = () => {
    setErrorMsg(null);
    setActiveStep((prev) => prev - 1);
  };

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('tools.importWizard.title', 'Data Import & Bulk Migration Wizard')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('tools.importWizard.title', 'Data Import Wizard') },
        ]}
      />

      {errorMsg && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setErrorMsg(null)}>
          {errorMsg}
        </Alert>
      )}

      <Card sx={{ p: 3, mb: 4 }}>
        <Stepper activeStep={activeStep} alternativeLabel>
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      </Card>

      {/* STEP 0: Upload & Target Entity */}
      {activeStep === 0 && (
        <Card sx={{ p: 4 }}>
          <Typography variant="h6" sx={{ mb: 3, fontWeight: 600 }}>
            {t('tools.importWizard.steps.step1', 'Step 1: Select Target Entity & Upload Spreadsheet (.xlsx / .csv)')}
          </Typography>
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                select
                fullWidth
                label={t('tools.importWizard.targetEntity', 'Target Import Entity')}
                value={entityType}
                onChange={(e) => handleEntityChange(e.target.value as ImportEntityType)}
              >
                <MenuItem value="PRODUCTS">{t('tools.importWizard.entities.PRODUCTS', 'Products Catalog (Products, Prices & Categories)')}</MenuItem>
                <MenuItem value="CUSTOMERS">{t('tools.importWizard.entities.CUSTOMERS', 'Customer Directory (Profiles, Phone Numbers & Identifiers)')}</MenuItem>
                <MenuItem value="CATEGORIES">{t('tools.importWizard.entities.CATEGORIES', 'Menu Categories (Category Codes & Ordering)')}</MenuItem>
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Button variant="outlined" component="label" fullWidth sx={{ height: 56 }}>
                {t('tools.importWizard.uploadFile', 'Choose File')} ({fileName})
                <input type="file" hidden accept=".csv,.xlsx" onChange={handleFileUpload} />
              </Button>
            </Grid>
            <Grid size={{ xs: 12 }}>
              {selectedFile ? (
                <Alert severity="info" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                    {t('tools.importWizard.fileSelected', 'Excel Workbook Selected: {{name}} ({{size}} KB)', {
                      name: selectedFile.name,
                      size: (selectedFile.size / 1024).toFixed(1),
                    })}
                  </Typography>
                </Alert>
              ) : (
                <TextField
                  fullWidth
                  multiline
                  rows={6}
                  label={t('tools.importWizard.dropFile', 'File Raw CSV Content Preview / Editor')}
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                />
              )}
            </Grid>
          </Grid>
        </Card>
      )}

      {/* STEP 1: Column Auto-Mapping */}
      {activeStep === 1 && (
        <Card sx={{ p: 4 }}>
          <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
            {t('tools.importWizard.steps.step2', 'Step 2: Column Mapping & Auto-Match Engine')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t('tools.importWizard.autoMatchSuccess', 'Auto-mapped {{count}} columns successfully', {
              count: Object.keys(columnMapping).length,
            })}
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table>
              <TableHead sx={{ bgcolor: 'action.hover' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 'bold' }}>{t('tools.importWizard.colSource', 'Spreadsheet Header')}</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>{t('common.status', 'Mapping Status')}</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>{t('tools.importWizard.colTarget', 'Target Schema Field')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {Object.keys(columnMapping).map((header) => (
                  <TableRow key={header}>
                    <TableCell sx={{ fontWeight: 'medium' }}>{header}</TableCell>
                    <TableCell>
                      {columnMapping[header] ? (
                        <Chip label={t('common.active', 'Auto Mapped')} color="success" size="small" />
                      ) : (
                        <Chip label={t('common.inactive', 'Unmapped')} color="warning" size="small" />
                      )}
                    </TableCell>
                    <TableCell>
                      <TextField
                        select
                        size="small"
                        fullWidth
                        value={columnMapping[header] || ''}
                        onChange={(e) => setColumnMapping({ ...columnMapping, [header]: e.target.value })}
                      >
                        <MenuItem value="">
                          <em>-- {t('common.none', 'Do Not Import (Skip)')} --</em>
                        </MenuItem>
                        {TARGET_FIELDS[entityType].map((f) => (
                          <MenuItem key={f.field} value={f.field}>
                            {t(f.labelKey, f.field)} {f.required ? '*' : ''} ({f.field})
                          </MenuItem>
                        ))}
                      </TextField>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}

      {/* STEP 2: Value Mapping */}
      {activeStep === 2 && (
        <Card sx={{ p: 4 }}>
          <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
            {t('tools.importWizard.steps.step3', 'Step 3: Distinct Spreadsheet Value Mapping')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t('tools.importWizard.subtitle', 'Map distinct raw spreadsheet cell values to internal enum codes.')}
          </Typography>

          {Object.keys(distinctValues).length === 0 ? (
            <Alert severity="info" sx={{ mb: 3 }}>
              {t('common.none', 'No distinct lookup fields require custom value transformation for this entity. Click Next to proceed to dry-run validation.')}
            </Alert>
          ) : (
            <Grid container spacing={2}>
              {Object.entries(distinctValues).map(([field, vals]) => (
                <Grid size={{ xs: 12 }} key={field}>
                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                    {field} ({vals.join(', ') || 'None'})
                  </Typography>
                  <Grid container spacing={2}>
                    {vals.map((v) => (
                      <Grid size={{ xs: 12, md: 6 }} key={v}>
                        <TextField
                          fullWidth
                          size="small"
                          label={`"${v}"`}
                          value={valueMapping[field]?.[v] ?? v}
                          onChange={(e) =>
                            setValueMapping({
                              ...valueMapping,
                              [field]: { ...(valueMapping[field] || {}), [v]: e.target.value },
                            })
                          }
                        />
                      </Grid>
                    ))}
                  </Grid>
                </Grid>
              ))}
            </Grid>
          )}
        </Card>
      )}

      {/* STEP 3: Dry-Run Validation */}
      {activeStep === 3 && activeJob && (
        <Card sx={{ p: 4 }}>
          <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
            {t('tools.importWizard.steps.step4', 'Step 4: Backend Dry-Run Validation & Row Error Inspection')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Job #{activeJob.id}
          </Typography>

          <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
            <Alert severity="success" sx={{ flex: 1 }}>
              {t('tools.importWizard.validationSuccess', 'Valid Rows Ready for Import: {{valid}}', { valid: activeJob.valid_rows })}
            </Alert>
            <Alert severity="error" sx={{ flex: 1 }}>
              {t('tools.importWizard.validationWarnings', 'Invalid Rows: {{invalid}}', { invalid: activeJob.error_rows })}
            </Alert>
          </Stack>

          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead sx={{ bgcolor: 'action.hover' }}>
                <TableRow>
                  <TableCell>Row #</TableCell>
                  <TableCell>{t('common.status', 'Validation Status')}</TableCell>
                  <TableCell>{t('tools.importWizard.colSample', 'Parsed Data Preview')}</TableCell>
                  <TableCell>{t('common.actions', 'Validation Messages / Errors')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {jobRows.map((r) => {
                  const isError = r.status === 'INVALID';
                  return (
                    <TableRow key={r.id} sx={{ bgcolor: isError ? 'error.lighter' : 'inherit' }}>
                      <TableCell>{r.row_number}</TableCell>
                      <TableCell>
                        {isError ? (
                          <Chip label="INVALID" color="error" size="small" />
                        ) : (
                          <Chip label="VALID" color="success" size="small" />
                        )}
                      </TableCell>
                      <TableCell><code>{JSON.stringify(r.parsed_data || r.raw_data)}</code></TableCell>
                      <TableCell>
                        {isError ? (
                          <Typography variant="caption" color="error.main" sx={{ fontWeight: 600 }}>
                            {r.errors?.join(', ') || 'Row failed validation'}
                          </Typography>
                        ) : (
                          <Typography variant="caption" color="success.main">
                            Ready
                          </Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}

      {/* STEP 4: Execution & Summary */}
      {activeStep === 4 && importSummary && (
        <Card sx={{ p: 4, textAlign: 'center' }}>
          <Iconify icon={'solar:check-circle-bold' as any} width={64} height={64} sx={{ color: 'success.main', mb: 2 }} />
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
            {t('tools.importWizard.importCompleted', 'Import Job Executed Successfully!')}
          </Typography>

          <Grid container spacing={3} sx={{ justifyContent: 'center', mb: 4, mt: 2 }}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'success.lighter' }}>
                <Typography variant="h4" color="success.dark" sx={{ fontWeight: 700 }}>
                  {importSummary.importedCount}
                </Typography>
                <Typography variant="subtitle2" color="success.dark">
                  {t('common.active', 'Successfully Inserted / Updated')}
                </Typography>
              </Paper>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'error.lighter' }}>
                <Typography variant="h4" color="error.dark" sx={{ fontWeight: 700 }}>
                  {importSummary.failedCount}
                </Typography>
                <Typography variant="subtitle2" color="error.dark">
                  {t('common.inactive', 'Skipped / Invalid Rows')}
                </Typography>
              </Paper>
            </Grid>
          </Grid>

          <Button variant="contained" size="large" onClick={() => { setActiveStep(0); setActiveJob(null); }}>
            {t('tools.importWizard.startImport', 'Start Another Import')}
          </Button>
        </Card>
      )}

      {isProcessing && (
        <Box sx={{ mt: 3 }}>
          <LinearProgress />
        </Box>
      )}

      <Divider sx={{ my: 3 }} />

      {activeStep < 4 && (
        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
          <Button disabled={activeStep === 0 || isProcessing} onClick={handleBack} variant="outlined">
            {t('tools.importWizard.prevStep', 'Back')}
          </Button>
          <Button variant="contained" onClick={handleNext} disabled={isProcessing}>
            {activeStep === 3
              ? t('tools.importWizard.startImport', 'Execute Import')
              : t('tools.importWizard.nextStep', 'Next Step')}
          </Button>
        </Stack>
      )}
    </Box>
  );
}
