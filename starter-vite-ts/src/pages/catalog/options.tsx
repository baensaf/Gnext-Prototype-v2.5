import type { OptionGroup } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import AddIcon from '@mui/icons-material/Add';
import {
  Box,
  Card,
  Chip,
  Grid,
  Stack,
  Table,
  Paper,
  Alert,
  Button,
  Drawer,
  Dialog,
  TableRow,
  Checkbox,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  CardContent,
  DialogTitle,
  DialogContent,
  DialogActions,
  TableContainer,
  FormControlLabel,
} from '@mui/material';

import { catalogApi } from 'src/api/catalogApi';

export function OptionsPage() {
  const { t: _t } = useTranslation();

  const [optionGroups, setOptionGroups] = useState<OptionGroup[]>([]);
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Group Form
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [minSelection, setMinSelection] = useState(0);
  const [maxSelection, setMaxSelection] = useState(1);
  const [isRequired, setIsRequired] = useState(false);

  // Item Form Dialog
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [itemCode, setItemCode] = useState('');
  const [itemName, setItemName] = useState('');
  const [priceDelta, setPriceDelta] = useState('150000');

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await catalogApi.getOptionGroups();
      setOptionGroups(data);
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to load option groups');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await catalogApi.createOptionGroup({
        code,
        name,
        min_selection: minSelection,
        max_selection: maxSelection,
        is_required: isRequired,
      });
      setGroupDrawerOpen(false);
      setCode('');
      setName('');
      setMinSelection(0);
      setMaxSelection(1);
      setIsRequired(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to create option group');
    }
  };

  const handleAddItem = async () => {
    if (!selectedGroupId || !itemCode || !itemName) return;
    try {
      await catalogApi.createOptionItem(selectedGroupId, {
        code: itemCode,
        name: itemName,
        price_delta: priceDelta,
      });
      setItemDialogOpen(false);
      setSelectedGroupId(null);
      setItemCode('');
      setItemName('');
      setPriceDelta('150000');
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to add option item');
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            Modifier Option Groups & Items
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Configure product add-ons, sizes, toppings, and modifier selection rules
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setGroupDrawerOpen(true)}
          sx={{ fontWeight: 'bold' }}
        >
          Create Option Group
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        {optionGroups.map((group) => (
          <Grid size={{ xs: 12, md: 6 }} key={group.id}>
            <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
              <CardContent>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                      {group.name} (<code>{group.code}</code>)
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                      <Chip
                        label={`Min: ${group.min_selection} | Max: ${group.max_selection}`}
                        size="small"
                        color="info"
                      />
                      {group.is_required && (
                        <Chip label="Required" color="error" size="small" sx={{ fontWeight: 'bold' }} />
                      )}
                    </Stack>
                  </Box>

                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={() => {
                      setSelectedGroupId(group.id);
                      setItemDialogOpen(true);
                    }}
                  >
                    Add Option
                  </Button>
                </Stack>

                <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Code</TableCell>
                        <TableCell>Option Item</TableCell>
                        <TableCell align="right">Price Delta</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(!group.items || group.items.length === 0) && (
                        <TableRow>
                          <TableCell colSpan={3} align="center">
                            No options added to this group yet.
                          </TableCell>
                        </TableRow>
                      )}
                      {group.items?.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell><code>{item.code}</code></TableCell>
                          <TableCell sx={{ fontWeight: 'bold' }}>{item.name}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                            {Number(item.price_delta) > 0
                              ? `+${Number(item.price_delta).toLocaleString()} IRR`
                              : '0 IRR'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Create Option Group Drawer */}
      <Drawer anchor="right" open={groupDrawerOpen} onClose={() => setGroupDrawerOpen(false)}>
        <Box sx={{ width: 400, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            Create Option Group
          </Typography>
          <form onSubmit={handleCreateGroup}>
            <Stack spacing={2.5}>
              <TextField
                label="Group Code"
                placeholder="e.g. GRP-TOPPINGS"
                required
                fullWidth
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <TextField
                label="Group Name"
                placeholder="e.g. Extra Pizza Toppings"
                required
                fullWidth
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Stack direction="row" spacing={2}>
                <TextField
                  label="Min Selection"
                  type="number"
                  fullWidth
                  value={minSelection}
                  onChange={(e) => setMinSelection(parseInt(e.target.value, 10) || 0)}
                />
                <TextField
                  label="Max Selection"
                  type="number"
                  fullWidth
                  value={maxSelection}
                  onChange={(e) => setMaxSelection(parseInt(e.target.value, 10) || 1)}
                />
              </Stack>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={isRequired}
                    onChange={(e) => setIsRequired(e.target.checked)}
                  />
                }
                label="Required Selection (At least Min Selection mandatory)"
              />
              <Button type="submit" variant="contained" size="large" fullWidth sx={{ fontWeight: 'bold' }}>
                Save Option Group
              </Button>
            </Stack>
          </form>
        </Box>
      </Drawer>

      {/* Add Option Item Dialog */}
      <Dialog open={itemDialogOpen} onClose={() => setItemDialogOpen(false)}>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          Add Modifier Option Item
        </DialogTitle>
        <DialogContent sx={{ minWidth: 360, pt: 2 }}>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Option Code"
              placeholder="e.g. OPT-EXTRACHEESE"
              required
              fullWidth
              value={itemCode}
              onChange={(e) => setItemCode(e.target.value.toUpperCase())}
            />
            <TextField
              label="Option Display Name"
              placeholder="e.g. Extra Mozzarella Cheese"
              required
              fullWidth
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
            />
            <TextField
              label="Price Delta (IRR)"
              type="number"
              required
              fullWidth
              value={priceDelta}
              onChange={(e) => setPriceDelta(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setItemDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleAddItem} sx={{ fontWeight: 'bold' }}>
            Add Option
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
