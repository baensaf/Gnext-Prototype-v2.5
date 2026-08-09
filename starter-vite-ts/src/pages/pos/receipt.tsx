import type { ReceiptData } from 'src/api/paymentApi';

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';

import PrintIcon from '@mui/icons-material/Print';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import {
  Box,
  Paper,
  Stack,
  Alert,
  Button,
  Divider,
  Typography,
} from '@mui/material';

import { paymentApi } from 'src/api/paymentApi';

export function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const fetchReceipt = async () => {
      try {
        const res = await paymentApi.getReceipt(id);
        setReceipt(res);
      } catch (err: any) {
        setError(err.detail || 'Failed to generate receipt');
      } finally {
        setLoading(false);
      }
    };
    fetchReceipt();
  }, [id]);

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return <Typography sx={{ p: 4 }}>Loading receipt...</Typography>;
  }

  if (error || !receipt) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">{error || 'Receipt not found'}</Alert>
      </Box>
    );
  }

  const { receipt_header: header, items, totals, tenders, receipt_footer: footer } = receipt;

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Top Action Controls */}
      <Stack direction="row" spacing={2} sx={{ mb: 3, '@media print': { display: 'none' } }}>
        <Button variant="outlined" startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)}>
          Back
        </Button>
        <Button variant="contained" startIcon={<PrintIcon />} onClick={handlePrint} sx={{ fontWeight: 'bold' }}>
          Print Receipt
        </Button>
      </Stack>

      {/* Thermal Receipt Paper Layout (80mm width standard = 320px) */}
      <Paper
        elevation={3}
        sx={{
          width: 320,
          p: 3,
          fontFamily: 'monospace, "Courier New", Courier',
          backgroundColor: '#fff',
          color: '#000',
          border: '1px dashed #ccc',
          borderRadius: 2,
        }}
      >
        {/* Header */}
        <Box sx={{ textAlign: 'center', mb: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', fontFamily: 'inherit' }}>
            {header.tenant_name}
          </Typography>
          <Typography variant="body2" sx={{ fontFamily: 'inherit' }}>
            {header.branch_name}
          </Typography>
          <Typography variant="caption" sx={{ fontFamily: 'inherit', display: 'block' }}>
            {header.branch_address}
          </Typography>
          <Typography variant="caption" sx={{ fontFamily: 'inherit', display: 'block' }}>
            Tel: {header.branch_phone}
          </Typography>
        </Box>

        <Divider sx={{ borderStyle: 'dashed', my: 1.5, borderColor: '#000' }} />

        {/* Order Metadata */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" sx={{ fontFamily: 'inherit', display: 'block' }}>
            Order #: <strong>{header.order_number}</strong>
          </Typography>
          <Typography variant="caption" sx={{ fontFamily: 'inherit', display: 'block' }}>
            Type: {header.order_type} {header.table_number ? `(Table ${header.table_number})` : ''}
          </Typography>
          <Typography variant="caption" sx={{ fontFamily: 'inherit', display: 'block' }}>
            Date: {new Date(header.placed_at).toLocaleString()}
          </Typography>
        </Box>

        <Divider sx={{ borderStyle: 'dashed', my: 1.5, borderColor: '#000' }} />

        {/* Itemized Line Breakdown */}
        <Stack spacing={1} sx={{ mb: 2 }}>
          {items.map((item, idx) => (
            <Box key={idx}>
              <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                <Typography variant="body2" sx={{ fontFamily: 'inherit', fontWeight: 'bold' }}>
                  {Number(item.quantity).toFixed(0)}x {item.product_name}
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'inherit' }}>
                  {Number(item.subtotal).toLocaleString()}
                </Typography>
              </Stack>

              {item.options?.map((opt, oIdx) => (
                <Stack key={oIdx} direction="row" sx={{ justifyContent: 'space-between', pl: 1 }}>
                  <Typography variant="caption" sx={{ fontFamily: 'inherit', color: '#444' }}>
                    + {opt.name}
                  </Typography>
                  <Typography variant="caption" sx={{ fontFamily: 'inherit', color: '#444' }}>
                    {Number(opt.price_delta) > 0 ? `+${Number(opt.price_delta).toLocaleString()}` : ''}
                  </Typography>
                </Stack>
              ))}
            </Box>
          ))}
        </Stack>

        <Divider sx={{ borderStyle: 'dashed', my: 1.5, borderColor: '#000' }} />

        {/* Financial Totals */}
        <Stack spacing={0.5} sx={{ mb: 2 }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
            <Typography variant="caption" sx={{ fontFamily: 'inherit' }}>Subtotal:</Typography>
            <Typography variant="caption" sx={{ fontFamily: 'inherit' }}>{Number(totals.subtotal_amount).toLocaleString()} IRR</Typography>
          </Stack>

          <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
            <Typography variant="caption" sx={{ fontFamily: 'inherit' }}>VAT Tax (10%):</Typography>
            <Typography variant="caption" sx={{ fontFamily: 'inherit' }}>{Number(totals.tax_amount).toLocaleString()} IRR</Typography>
          </Stack>

          {Number(totals.discount_amount) > 0 && (
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
              <Typography variant="caption" sx={{ fontFamily: 'inherit' }}>Discount:</Typography>
              <Typography variant="caption" sx={{ fontFamily: 'inherit' }}>-{Number(totals.discount_amount).toLocaleString()} IRR</Typography>
            </Stack>
          )}

          <Divider sx={{ my: 0.5 }} />

          <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
            <Typography variant="body2" sx={{ fontFamily: 'inherit', fontWeight: 'bold' }}>TOTAL:</Typography>
            <Typography variant="body2" sx={{ fontFamily: 'inherit', fontWeight: 'bold' }}>
              {Number(totals.total_amount).toLocaleString()} IRR
            </Typography>
          </Stack>
        </Stack>

        {/* Tenders Breakdown */}
        {tenders.length > 0 && (
          <Box sx={{ mb: 2, p: 1, border: '1px solid #ddd', borderRadius: 1 }}>
            <Typography variant="caption" sx={{ fontFamily: 'inherit', fontWeight: 'bold', display: 'block', mb: 0.5 }}>
              Payment Tenders Split:
            </Typography>
            {tenders.map((t, tIdx) => (
              <Stack key={tIdx} direction="row" sx={{ justifyContent: 'space-between' }}>
                <Typography variant="caption" sx={{ fontFamily: 'inherit' }}>
                  {t.payment_method_name} {t.reference_number ? `(${t.reference_number})` : ''}
                </Typography>
                <Typography variant="caption" sx={{ fontFamily: 'inherit', fontWeight: 'bold' }}>
                  {Number(t.amount).toLocaleString()} IRR
                </Typography>
              </Stack>
            ))}
          </Box>
        )}

        <Divider sx={{ borderStyle: 'dashed', my: 1.5, borderColor: '#000' }} />

        {/* Bilingual Footer */}
        <Box sx={{ textAlign: 'center', mt: 2 }}>
          <Typography variant="caption" sx={{ fontFamily: 'inherit', display: 'block', mb: 0.5, direction: 'rtl' }}>
            {footer.bilingual_note_fa}
          </Typography>
          <Typography variant="caption" sx={{ fontFamily: 'inherit', display: 'block' }}>
            {footer.bilingual_note_en}
          </Typography>
        </Box>
      </Paper>
    </Box>
  );
}
