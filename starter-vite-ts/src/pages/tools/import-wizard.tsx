import type { ChangeEvent } from 'react';
import type { ImportJobDto, ImportRowDto } from 'src/api/importExportApi';

import { useState } from 'react';

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
  Container,
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

type ImportEntityType = 'CUSTOMERS' | 'PRODUCTS' | 'CATEGORIES';

const STEPS = [
  'Upload File & Target Entity',
  'Column Mapping & Auto-Match',
  'Value Mapping',
  'Validation Preview',
  'Import Summary',
];

const TARGET_FIELDS: Record<ImportEntityType, { field: string; label: string; required?: boolean }[]> = {
  CUSTOMERS: [
    { field: 'code', label: 'Customer Code' },
    { field: 'first_name', label: 'First Name', required: true },
    { field: 'last_name', label: 'Last Name', required: true },
    { field: 'mobile', label: 'Mobile Number', required: true },
    { field: 'email', label: 'Email Address' },
    { field: 'national_id', label: 'National Code / SSN' },
    { field: 'is_active', label: 'Active Status' },
  ],
  PRODUCTS: [
    { field: 'code', label: 'Product Code / SKU', required: true },
    { field: 'name_fa', label: 'Persian Product Name', required: true },
    { field: 'name_en', label: 'English Product Name' },
    { field: 'category_code', label: 'Category Code' },
    { field: 'base_price', label: 'Base Unit Price', required: true },
    { field: 'is_active', label: 'Active Status' },
  ],
  CATEGORIES: [
    { field: 'code', label: 'Category Code', required: true },
    { field: 'name_fa', label: 'Persian Category Title', required: true },
    { field: 'name_en', label: 'English Category Title' },
    { field: 'sort_order', label: 'Sort Display Order' },
    { field: 'is_active', label: 'Active Status' },
  ],
};

const DEFAULT_CSV_TEMPLATES: Record<ImportEntityType, string> = {
  CUSTOMERS: 'کد مشتری,نام,نام خانوادگی,شماره تماس,ایمیل,وضعیت\nCUST-101,علی,رضایی,09121112233,ali@example.com,فعال\nCUST-102,سارا,احمدی,09129998877,sara@example.com,فعال\nCUST-103,مریم,حسینی,invalid-phone,maryam@example.com,غیرفعال',
  PRODUCTS: 'کد کالا,نام فارسی,English Name,قیمت پایه,کد دسته بندی,وضعیت\nPROD-201,همبرگر مخصوص,Special Burger,250000,CAT-BURGER,فعال\nPROD-202,سیب زمینی سرخ کرده,French Fries,90000,CAT-SIDES,فعال\nPROD-203,پیتزا مخلوط,Mix Pizza,-10000,CAT-PIZZA,فعال',
  CATEGORIES: 'کد,عنوان دسته,Title EN,ترتیب,وضعیت\nCAT-BURGER,برگرها,Burgers,1,فعال\nCAT-SIDES,پیش غذا و پیش خوراک,Appetizers & Sides,2,فعال',
};

export function ImportWizardPage() {
  const [activeStep, setActiveStep] = useState(0);
  const [entityType, setEntityType] = useState<ImportEntityType>('PRODUCTS');
  const [fileName, setFileName] = useState<string>('products_catalog.csv');
  const [fileContent, setFileContent] = useState<string>(DEFAULT_CSV_TEMPLATES.PRODUCTS);
  
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
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setFileContent(text);
      };
      reader.readAsText(file);
    }
  };

  const handleNext = async () => {
    setErrorMsg(null);
    setIsProcessing(true);

    try {
      if (activeStep === 0) {
        if (!fileContent.trim()) {
          throw new Error('Please upload or enter spreadsheet CSV/Excel content');
        }
        // Step 1: Upload & stage job via backend API
        const job = await importExportApi.uploadFile(entityType, fileContent, fileName);
        setActiveJob(job);

        // Fetch auto mapping suggestions
        const headers = Object.keys(job.column_mapping || {});
        if (headers.length === 0) {
          const firstLine = fileContent.split(/\r?\n/)[0];
          const parsedHeaders = firstLine.split(/,|\t|;/).map((h) => h.replace(/^["']|["']$/g, '').trim());
          const autoMap = await importExportApi.autoMap(parsedHeaders, entityType);
          const mapObj: Record<string, string> = {};
          autoMap.forEach((m) => {
            if (m.mappedField) mapObj[m.header] = m.mappedField;
          });
          setColumnMapping(mapObj);
        } else {
          setColumnMapping(job.column_mapping);
        }

        setActiveStep(1);
      } else if (activeStep === 1) {
        if (!activeJob) throw new Error('Active staged import job missing');
        // Extract distinct raw values for mapped enum fields
        const distinct = await importExportApi.getDistinctValues(activeJob.id, columnMapping);
        setDistinctValues(distinct);
        setActiveStep(2);
      } else if (activeStep === 2) {
        if (!activeJob) throw new Error('Active staged import job missing');
        // Dry-run validate job via backend API
        const validatedJob = await importExportApi.validateJob(activeJob.id, columnMapping, valueMapping);
        setActiveJob(validatedJob);

        // Fetch row results from database
        const detail = await importExportApi.getJobDetail(activeJob.id);
        setJobRows(detail.rows);
        setActiveStep(3);
      } else if (activeStep === 3) {
        if (!activeJob) throw new Error('Active staged import job missing');
        // Execute atomic database insertion transaction
        const result = await importExportApi.executeJob(activeJob.id);
        setImportSummary(result);
        setActiveStep(4);
      }
    } catch (err: any) {
      setErrorMsg(err.detail || err.message || 'Import step operation failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBack = () => {
    setErrorMsg(null);
    setActiveStep((prev) => prev - 1);
  };

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            Advanced Excel & CSV Import Engine
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Real Backend-Driven Multi-Entity Import Engine (Staged Jobs, Auto-Mapping, Row Validation & DB Execution)
          </Typography>
        </Box>
        <Chip label="Real Import API" color="primary" variant="filled" sx={{ fontWeight: 'bold' }} />
      </Stack>

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
            Step 1: Select Target Entity & Upload Spreadsheet (.xlsx / .csv)
          </Typography>
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                select
                fullWidth
                label="Target Import Entity"
                value={entityType}
                onChange={(e) => handleEntityChange(e.target.value as ImportEntityType)}
              >
                <MenuItem value="PRODUCTS">Products Catalog (Products, Prices & Categories)</MenuItem>
                <MenuItem value="CUSTOMERS">Customer Directory (Profiles, Phone Numbers & Identifiers)</MenuItem>
                <MenuItem value="CATEGORIES">Menu Categories (Category Codes & Ordering)</MenuItem>
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Button variant="outlined" component="label" fullWidth sx={{ height: 56 }}>
                Choose File ({fileName})
                <input type="file" hidden accept=".csv,.xlsx,.xls" onChange={handleFileUpload} />
              </Button>
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth
                multiline
                rows={6}
                label="File Raw CSV Content Preview"
                value={fileContent}
                onChange={(e) => setFileContent(e.target.value)}
              />
            </Grid>
          </Grid>
        </Card>
      )}

      {/* STEP 1: Column Auto-Mapping */}
      {activeStep === 1 && (
        <Card sx={{ p: 4 }}>
          <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
            Step 2: Column Mapping & Auto-Match Engine
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Auto-detected spreadsheet headers mapped against {entityType} schema in Job #{activeJob?.id}.
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table>
              <TableHead sx={{ bgcolor: 'action.hover' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 'bold' }}>Spreadsheet Header</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Mapping Status</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Target Schema Field</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {Object.keys(columnMapping).map((header) => (
                  <TableRow key={header}>
                    <TableCell sx={{ fontWeight: 'medium' }}>{header}</TableCell>
                    <TableCell>
                      {columnMapping[header] ? (
                        <Chip label="Auto Mapped" color="success" size="small" variant="soft" />
                      ) : (
                        <Chip label="Unmapped" color="warning" size="small" variant="soft" />
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
                          <em>-- Do Not Import (Skip) --</em>
                        </MenuItem>
                        {TARGET_FIELDS[entityType].map((f) => (
                          <MenuItem key={f.field} value={f.field}>
                            {f.label} {f.required ? '*' : ''} ({f.field})
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
            Step 3: Distinct Spreadsheet Value Mapping
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Map distinct raw spreadsheet cell values to internal enum codes.
          </Typography>

          {Object.keys(distinctValues).length === 0 ? (
            <Alert severity="info" sx={{ mb: 3 }}>
              No distinct lookup fields require custom value transformation for this entity. Click Next to proceed to dry-run validation.
            </Alert>
          ) : (
            <Grid container spacing={2}>
              {Object.entries(distinctValues).map(([field, vals]) => (
                <Grid size={{ xs: 12 }} key={field}>
                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                    Field: {field} (Distinct Raw Values: {vals.join(', ') || 'None'})
                  </Typography>
                  <Grid container spacing={2}>
                    {vals.map((v) => (
                      <Grid size={{ xs: 12, md: 6 }} key={v}>
                        <TextField
                          fullWidth
                          size="small"
                          label={`Raw Value: "${v}"`}
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
            Step 4: Backend Dry-Run Validation & Row Error Inspection
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Validation results stored in backend database for Job #{activeJob.id}.
          </Typography>

          <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
            <Alert severity="success" sx={{ flex: 1 }}>
              Valid Rows Ready for Import: <strong>{activeJob.valid_rows}</strong>
            </Alert>
            <Alert severity="error" sx={{ flex: 1 }}>
              Invalid Rows (Will Be Skipped): <strong>{activeJob.error_rows}</strong>
            </Alert>
          </Stack>

          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead sx={{ bgcolor: 'action.hover' }}>
                <TableRow>
                  <TableCell>Row #</TableCell>
                  <TableCell>Validation Status</TableCell>
                  <TableCell>Parsed Data Preview</TableCell>
                  <TableCell>Validation Messages / Errors</TableCell>
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
                      <TableCell>{JSON.stringify(r.parsed_data || r.raw_data)}</TableCell>
                      <TableCell>
                        {isError ? (
                          <Typography variant="caption" color="error.main" sx={{ fontWeight: 600 }}>
                            {r.errors?.join(', ') || 'Row failed domain schema validation'}
                          </Typography>
                        ) : (
                          <Typography variant="caption" color="success.main">
                            Ready for database commit
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
          <Iconify icon={"solar:check-circle-bold" as any} width={64} height={64} sx={{ color: 'success.main', mb: 2 }} />
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
            Import Job Executed Successfully!
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
            Batch database transaction completed with audit event log write.
          </Typography>

          <Grid container spacing={3} sx={{ justifyContent: 'center', mb: 4 }}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'success.lighter' }}>
                <Typography variant="h4" color="success.dark" sx={{ fontWeight: 700 }}>
                  {importSummary.importedCount}
                </Typography>
                <Typography variant="subtitle2" color="success.dark">
                  Successfully Inserted / Updated
                </Typography>
              </Paper>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'error.lighter' }}>
                <Typography variant="h4" color="error.dark" sx={{ fontWeight: 700 }}>
                  {importSummary.failedCount}
                </Typography>
                <Typography variant="subtitle2" color="error.dark">
                  Skipped / Invalid Rows
                </Typography>
              </Paper>
            </Grid>
          </Grid>

          <Button variant="contained" size="large" onClick={() => { setActiveStep(0); setActiveJob(null); }}>
            Start Another Import
          </Button>
        </Card>
      )}

      {isProcessing && (
        <Box sx={{ mt: 3 }}>
          <LinearProgress />
          <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mt: 1 }}>
            Processing real backend API request...
          </Typography>
        </Box>
      )}

      <Divider sx={{ my: 3 }} />

      {activeStep < 4 && (
        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
          <Button disabled={activeStep === 0 || isProcessing} onClick={handleBack} variant="outlined">
            Back
          </Button>
          <Button variant="contained" onClick={handleNext} disabled={isProcessing}>
            {activeStep === 3 ? 'Execute Import' : 'Next Step'}
          </Button>
        </Stack>
      )}
    </Container>
  );
}
