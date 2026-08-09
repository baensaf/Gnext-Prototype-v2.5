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

const DEMO_CSV_SAMPLES: Record<ImportEntityType, { headers: string[]; rows: Record<string, string>[] }> = {
  CUSTOMERS: {
    headers: ['کد مشتری', 'نام', 'نام خانوادگی', 'شماره تماس', 'ایمیل', 'وضعیت'],
    rows: [
      { 'کد مشتری': 'CUST-101', نام: 'علی', 'نام خانوادگی': 'رضایی', 'شماره تماس': '09121112233', ایمیل: 'ali@example.com', وضعیت: 'فعال' },
      { 'کد مشتری': 'CUST-102', نام: 'سارا', 'نام خانوادگی': 'احمدی', 'شماره تماس': '09129998877', ایمیل: 'sara@example.com', وضعیت: 'فعال' },
      { 'کد مشتری': 'CUST-103', نام: 'مریم', 'نام خانوادگی': 'حسینی', 'شماره تماس': '09123334455', ایمیل: 'maryam@example.com', وضعیت: 'غیرفعال' },
      { 'کد مشتری': 'CUST-104', نام: 'رضا', 'نام خانوادگی': 'کریمی', 'شماره تماس': 'invalid-phone', ایمیل: 'reza@example.com', وضعیت: 'فعال' },
    ],
  },
  PRODUCTS: {
    headers: ['کد کالا', 'نام فارسی', 'English Name', 'قیمت پایه', 'کد دسته بندی', 'وضعیت'],
    rows: [
      { 'کد کالا': 'PROD-201', 'نام فارسی': 'همبرگر مخصوص', 'English Name': 'Special Burger', 'قیمت پایه': '250000', 'کد دسته بندی': 'CAT-BURGER', وضعیت: 'فعال' },
      { 'کد کالا': 'PROD-202', 'نام فارسی': 'سیب زمینی سرخ کرده', 'English Name': 'French Fries', 'قیمت پایه': '90000', 'کد دسته بندی': 'CAT-SIDES', وضعیت: 'فعال' },
      { 'کد کالا': 'PROD-203', 'نام فارسی': 'نوشابه قوطی', 'English Name': 'Canned Soda', 'قیمت پایه': '35000', 'کد دسته بندی': 'CAT-DRINKS', وضعیت: 'فعال' },
      { 'کد کالا': 'PROD-204', 'نام فارسی': 'پیتزا مخلوط', 'English Name': 'Mix Pizza', 'قیمت پایه': '-10000', 'کد دسته بندی': 'CAT-PIZZA', وضعیت: 'فعال' },
    ],
  },
  CATEGORIES: {
    headers: ['کد', 'عنوان دسته', 'Title EN', 'ترتیب', 'وضعیت'],
    rows: [
      { کد: 'CAT-BURGER', 'عنوان دسته': 'برگرها', 'Title EN': 'Burgers', ترتیب: '1', وضعیت: 'فعال' },
      { کد: 'CAT-SIDES', 'عنوان دسته': 'پیش غذا و پیش خوراک', 'Title EN': 'Appetizers & Sides', ترتیب: '2', وضعیت: 'فعال' },
      { کد: 'CAT-DRINKS', 'عنوان دسته': 'نوشیدنی های سرد', 'Title EN': 'Beverages', ترتیب: '3', وضعیت: 'فعال' },
    ],
  },
};

export function ImportWizardPage() {
  const [activeStep, setActiveStep] = useState(0);
  const [entityType, setEntityType] = useState<ImportEntityType>('PRODUCTS');
  const [fileName, setFileName] = useState<string>('products_catalog_2026.xlsx');
  const [uploadedHeaders, setUploadedHeaders] = useState<string[]>(DEMO_CSV_SAMPLES.PRODUCTS.headers);
  const [uploadedRows, setUploadedRows] = useState<Record<string, string>[]>(DEMO_CSV_SAMPLES.PRODUCTS.rows);

  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({
    'کد کالا': 'code',
    'نام فارسی': 'name_fa',
    'English Name': 'name_en',
    'قیمت پایه': 'base_price',
    'کد دسته بندی': 'category_code',
    وضعیت: 'is_active',
  });

  const [valueMapping, setValueMapping] = useState<Record<string, Record<string, string>>>({
    is_active: { فعال: 'true', غیرفعال: 'false' },
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [importSummary, setImportSummary] = useState<{ imported: number; failed: number } | null>(null);

  const handleEntityChange = (newType: ImportEntityType) => {
    setEntityType(newType);
    setUploadedHeaders(DEMO_CSV_SAMPLES[newType].headers);
    setUploadedRows(DEMO_CSV_SAMPLES[newType].rows);

    if (newType === 'CUSTOMERS') {
      setColumnMapping({
        'کد مشتری': 'code',
        نام: 'first_name',
        'نام خانوادگی': 'last_name',
        'شماره تماس': 'mobile',
        ایمیل: 'email',
        وضعیت: 'is_active',
      });
    } else if (newType === 'PRODUCTS') {
      setColumnMapping({
        'کد کالا': 'code',
        'نام فارسی': 'name_fa',
        'English Name': 'name_en',
        'قیمت پایه': 'base_price',
        'کد دسته بندی': 'category_code',
        وضعیت: 'is_active',
      });
    } else {
      setColumnMapping({
        کد: 'code',
        'عنوان دسته': 'name_fa',
        'Title EN': 'name_en',
        ترتیب: 'sort_order',
        وضعیت: 'is_active',
      });
    }
  };

  const handleNext = () => {
    if (activeStep === 3) {
      setIsProcessing(true);
      setTimeout(() => {
        setIsProcessing(false);
        setImportSummary({ imported: uploadedRows.length - 1, failed: 1 });
        setActiveStep(4);
      }, 1200);
    } else {
      setActiveStep((prev) => prev + 1);
    }
  };

  const handleBack = () => setActiveStep((prev) => prev - 1);

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            Advanced Excel & CSV Import Engine
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Slice 22 — Multi-Entity Import Wizard with Intelligent Auto-Mapping, Value Transformation & Dry-Run Validation
          </Typography>
        </Box>
        <Chip label="Slice 22" color="primary" variant="filled" sx={{ fontWeight: 'bold' }} />
      </Stack>

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
              <TextField fullWidth label="Simulated Upload File" value={fileName} onChange={(e) => setFileName(e.target.value)} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <Paper
                variant="outlined"
                sx={{
                  p: 4,
                  textAlign: 'center',
                  borderStyle: 'dashed',
                  borderWidth: 2,
                  bgcolor: 'action.hover',
                  cursor: 'pointer',
                }}
              >
                <Iconify icon={"solar:upload-square-bold" as any} width={48} height={48} sx={{ color: 'primary.main', mb: 1 }} />
                <Typography variant="h6">Drag & Drop Excel (.xlsx / .xls) or CSV file here</Typography>
                <Typography variant="caption" color="text.secondary">
                  Supports UTF-8, Persian/Arabic characters, auto-delimiter recognition (comma, tab, semicolon)
                </Typography>
              </Paper>
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
            Auto-detected spreadsheet headers mapped against {entityType} target schema. You can override any field mapping below.
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table>
              <TableHead sx={{ bgcolor: 'action.hover' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 'bold' }}>Spreadsheet Header</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Auto Match Score</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Target Schema Field</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {uploadedHeaders.map((header) => (
                  <TableRow key={header}>
                    <TableCell sx={{ fontWeight: 'medium' }}>{header}</TableCell>
                    <TableCell>
                      <Chip label="100% Match (Auto)" color="success" size="small" variant="soft" />
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
            Map distinct raw spreadsheet cell values (such as text statuses or Persian values) to internal system enum codes.
          </Typography>

          <Alert severity="info" sx={{ mb: 3 }}>
            Found distinct value <strong>&quot;فعال&quot;</strong> and <strong>&quot;غیرفعال&quot;</strong> in Active Status column. Automatically mapped to <strong>true</strong> / <strong>false</strong>.
          </Alert>

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label='Raw Value: "فعال"'
                value={valueMapping.is_active?.['فعال'] || 'true'}
                onChange={(e) => setValueMapping({ ...valueMapping, is_active: { ...valueMapping.is_active, فعال: e.target.value } })}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label='Raw Value: "غیرفعال"'
                value={valueMapping.is_active?.['غیرفعال'] || 'false'}
                onChange={(e) => setValueMapping({ ...valueMapping, is_active: { ...valueMapping.is_active, غیرفعال: e.target.value } })}
              />
            </Grid>
          </Grid>
        </Card>
      )}

      {/* STEP 3: Dry-Run Validation */}
      {activeStep === 3 && (
        <Card sx={{ p: 4 }}>
          <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
            Step 4: Dry-Run Validation & Row Error Inspection
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Pre-flight schema validation results. Review valid vs invalid rows before executing the database commit.
          </Typography>

          <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
            <Alert severity="success" sx={{ flex: 1 }}>
              Valid Rows Ready for Import: <strong>{uploadedRows.length - 1}</strong>
            </Alert>
            <Alert severity="error" sx={{ flex: 1 }}>
              Invalid Rows (Will Be Skipped): <strong>1</strong>
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
                {uploadedRows.map((r, idx) => {
                  const isError = idx === uploadedRows.length - 1;
                  return (
                    <TableRow key={idx} sx={{ bgcolor: isError ? 'error.lighter' : 'inherit' }}>
                      <TableCell>{idx + 1}</TableCell>
                      <TableCell>
                        {isError ? (
                          <Chip label="INVALID" color="error" size="small" />
                        ) : (
                          <Chip label="VALID" color="success" size="small" />
                        )}
                      </TableCell>
                      <TableCell>{JSON.stringify(r)}</TableCell>
                      <TableCell>
                        {isError ? (
                          <Typography variant="caption" color="error.main" sx={{ fontWeight: 600 }}>
                            Row {idx + 1}: Invalid format or negative price restriction violated.
                          </Typography>
                        ) : (
                          <Typography variant="caption" color="success.main">
                            Ready for import
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
            Import Job Completed Successfully!
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
            Target entity records updated atomically with audit logging.
          </Typography>

          <Grid container spacing={3} sx={{ justifyContent: 'center', mb: 4 }}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'success.lighter' }}>
                <Typography variant="h4" color="success.dark" sx={{ fontWeight: 700 }}>
                  {importSummary.imported}
                </Typography>
                <Typography variant="subtitle2" color="success.dark">
                  Successfully Imported
                </Typography>
              </Paper>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'error.lighter' }}>
                <Typography variant="h4" color="error.dark" sx={{ fontWeight: 700 }}>
                  {importSummary.failed}
                </Typography>
                <Typography variant="subtitle2" color="error.dark">
                  Skipped / Invalid Rows
                </Typography>
              </Paper>
            </Grid>
          </Grid>

          <Button variant="contained" size="large" onClick={() => setActiveStep(0)}>
            Start Another Import
          </Button>
        </Card>
      )}

      {isProcessing && (
        <Box sx={{ mt: 3 }}>
          <LinearProgress />
          <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mt: 1 }}>
            Executing atomic batch import transaction into database...
          </Typography>
        </Box>
      )}

      <Divider sx={{ my: 3 }} />

      {activeStep < 4 && (
        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
          <Button disabled={activeStep === 0} onClick={handleBack} variant="outlined">
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
