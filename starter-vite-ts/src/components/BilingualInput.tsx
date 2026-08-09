import React, { useState } from 'react';

import {
  Box,
  Tab,
  Tabs,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

interface BilingualInputProps {
  label: string;
  faValue: string;
  enValue: string;
  onFaChange: (val: string) => void;
  onEnChange: (val: string) => void;
  multiline?: boolean;
  rows?: number;
  required?: boolean;
}

export function BilingualInput({
  label,
  faValue,
  enValue,
  onFaChange,
  onEnChange,
  multiline = false,
  rows = 1,
  required = false,
}: BilingualInputProps) {
  const [activeTab, setActiveTab] = useState<'fa' | 'en'>('fa');

  return (
    <Box sx={{ border: '1px solid rgba(0, 0, 0, 0.12)', borderRadius: 2, p: 2, bgcolor: 'background.paper' }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
          {label} {required && <span style={{ color: 'red' }}>*</span>}
        </Typography>
        <Tabs
          value={activeTab}
          onChange={(_, val) => setActiveTab(val)}
          sx={{ minHeight: 32, '& .MuiTab-root': { py: 0.5, px: 1.5, minHeight: 32, fontSize: '0.8rem', fontWeight: 'bold' } }}
        >
          <Tab value="fa" label="فارسی (FA)" />
          <Tab value="en" label="English (EN)" />
        </Tabs>
      </Stack>

      {activeTab === 'fa' && (
        <TextField
          fullWidth
          multiline={multiline}
          rows={rows}
          value={faValue}
          onChange={(e) => onFaChange(e.target.value)}
          placeholder={`Enter Persian (${label})...`}
          slotProps={{ htmlInput: { dir: 'rtl' } }}
        />
      )}

      {activeTab === 'en' && (
        <TextField
          fullWidth
          multiline={multiline}
          rows={rows}
          value={enValue}
          onChange={(e) => onEnChange(e.target.value)}
          placeholder={`Enter English (${label})...`}
          slotProps={{ htmlInput: { dir: 'ltr' } }}
        />
      )}
    </Box>
  );
}
