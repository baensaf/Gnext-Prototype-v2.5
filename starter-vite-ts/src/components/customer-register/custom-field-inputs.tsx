import type { CustomField } from 'src/api/customerApi';

import { Grid, MenuItem, TextField } from '@mui/material';

import { CalendarDateField } from 'src/components/calendar-date-field';

type Props = {
  fields: CustomField[];
  values: Record<string, string | null>;
  onChange: (fieldId: string, value: string) => void;
};

/** One input per customer field head office has added, in its order. */
export function CustomFieldInputs({ fields, values, onChange }: Props) {
  return (
    <>
      {fields.map((field) => {
        const value = values[field.id] ?? '';
        const common = {
          label: field.name,
          required: field.is_required,
          fullWidth: true,
          size: 'small' as const,
        };
        return (
          <Grid key={field.id} size={{ xs: 12, sm: 6 }}>
            {field.data_type === 'DATE' ? (
              <CalendarDateField {...common} value={value} onChange={(e) => onChange(field.id, e.target.value)} />
            ) : field.data_type === 'CHOICE' ? (
              <TextField select {...common} value={value} onChange={(e) => onChange(field.id, e.target.value)}>
                {!field.is_required && <MenuItem value="">—</MenuItem>}
                {field.options.map((option) => (
                  <MenuItem key={option} value={option}>
                    {option}
                  </MenuItem>
                ))}
              </TextField>
            ) : (
              <TextField
                {...common}
                type={field.data_type === 'NUMBER' ? 'number' : 'text'}
                value={value}
                onChange={(e) => onChange(field.id, e.target.value)}
              />
            )}
          </Grid>
        );
      })}
    </>
  );
}
