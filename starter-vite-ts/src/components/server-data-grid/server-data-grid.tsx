import type {
  GridColDef,
  GridRowParams,
  GridSortModel,
  GridFilterModel,
  GridRowHeightParams,
  GridPaginationModel,
  GridRowSelectionModel,
  GridRowHeightReturnValue,
  GridColumnVisibilityModel,
} from '@mui/x-data-grid';

import React from 'react';
import { useTranslation } from 'react-i18next';

import { faIR } from '@mui/x-data-grid/locales';
import {
  DataGrid,
  GridToolbar,
} from '@mui/x-data-grid';
import {
  Box,
  Card,
  Typography,
  CircularProgress,
} from '@mui/material';

// ----------------------------------------------------------------------

export interface ServerDataGridProps<T = any> {
  rows: T[];
  columns: GridColDef[];
  loading?: boolean;
  rowCount?: number;
  paginationModel?: GridPaginationModel;
  onPaginationModelChange?: (model: GridPaginationModel) => void;
  pageSizeOptions?: number[];
  sortModel?: GridSortModel;
  onSortModelChange?: (model: GridSortModel) => void;
  filterModel?: GridFilterModel;
  onFilterModelChange?: (model: GridFilterModel) => void;
  rowSelectionModel?: GridRowSelectionModel;
  onRowSelectionModelChange?: (model: GridRowSelectionModel) => void;
  checkboxSelection?: boolean;
  disableRowSelectionOnClick?: boolean;
  onRowClick?: (params: any) => void;
  getRowId?: (row: T) => string | number;
  height?: number | string;
  emptyTitle?: string;
  emptyDescription?: string;
  showToolbar?: boolean;
  density?: 'compact' | 'standard' | 'comfortable';
  hideFooterPagination?: boolean;
  sx?: any;
  getRowHeight?: (params: GridRowHeightParams) => GridRowHeightReturnValue;
  getRowClassName?: (params: GridRowParams) => string;
  columnVisibilityModel?: GridColumnVisibilityModel;
  onColumnVisibilityModelChange?: (model: GridColumnVisibilityModel) => void;
}

// The grid's own words (the pager, the column menu, the toolbar) in the page's language.
const faLocaleText = faIR.components.MuiDataGrid.defaultProps.localeText;

export function ServerDataGrid<T extends { id?: string | number }>({
  rows,
  columns,
  loading = false,
  rowCount,
  paginationModel,
  onPaginationModelChange,
  pageSizeOptions = [10, 25, 50, 100],
  sortModel,
  onSortModelChange,
  filterModel,
  onFilterModelChange,
  rowSelectionModel,
  onRowSelectionModelChange,
  checkboxSelection = false,
  disableRowSelectionOnClick = true,
  onRowClick,
  getRowId = (row: any) => row.id || row._id || Math.random().toString(),
  height = 560,
  emptyTitle,
  emptyDescription,
  showToolbar = true,
  density = 'comfortable',
  hideFooterPagination = false,
  sx,
  getRowHeight,
  getRowClassName,
  columnVisibilityModel,
  onColumnVisibilityModelChange,
}: ServerDataGridProps<T>) {
  const { t, i18n } = useTranslation();
  const localeText = i18n.language?.startsWith('fa') ? faLocaleText : undefined;

  const isServerPagination = rowCount !== undefined;

  return (
    <Card sx={{ height, width: '100%', display: 'flex', flexDirection: 'column', ...sx }}>
      <DataGrid
        rows={rows}
        columns={columns}
        loading={loading}
        getRowId={getRowId}
        density={density}
        paginationMode={isServerPagination ? 'server' : 'client'}
        sortingMode={sortModel && onSortModelChange ? 'server' : 'client'}
        filterMode={filterModel && onFilterModelChange ? 'server' : 'client'}
        rowCount={isServerPagination ? rowCount : undefined}
        paginationModel={paginationModel}
        onPaginationModelChange={onPaginationModelChange}
        pageSizeOptions={pageSizeOptions}
        sortModel={sortModel}
        onSortModelChange={onSortModelChange}
        filterModel={filterModel}
        onFilterModelChange={onFilterModelChange}
        rowSelectionModel={rowSelectionModel}
        onRowSelectionModelChange={onRowSelectionModelChange}
        checkboxSelection={checkboxSelection}
        disableRowSelectionOnClick={disableRowSelectionOnClick}
        onRowClick={onRowClick}
        hideFooterPagination={hideFooterPagination}
        localeText={localeText}
        getRowHeight={getRowHeight}
        getRowClassName={getRowClassName}
        columnVisibilityModel={columnVisibilityModel}
        onColumnVisibilityModelChange={onColumnVisibilityModelChange}
        slots={{
          toolbar: showToolbar ? GridToolbar : undefined,
          loadingOverlay: () => (
            <Box
              sx={{
                display: 'flex',
                height: '100%',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(255, 255, 255, 0.7)',
              }}
            >
              <CircularProgress size={36} />
            </Box>
          ),
          noRowsOverlay: () => (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                alignItems: 'center',
                justifyContent: 'center',
                py: 4,
                gap: 1,
              }}
            >
              <Typography variant="subtitle1" color="text.secondary">
                {emptyTitle || t('common.noData', 'No records found')}
              </Typography>
              {emptyDescription && (
                <Typography variant="body2" color="text.disabled">
                  {emptyDescription}
                </Typography>
              )}
            </Box>
          ),
        }}
        slotProps={{
          toolbar: {
            showQuickFilter: true,
            quickFilterProps: { debounceMs: 400 },
          },
        }}
        sx={{
          border: 'none',
          '& .MuiDataGrid-cell': {
            borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
          },
          '& .MuiDataGrid-columnHeaders': {
            backgroundColor: (theme) => theme.palette.background.neutral,
            borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
            fontWeight: 600,
          },
          '& .MuiDataGrid-virtualScroller': {
            minHeight: 200,
          },
        }}
      />
    </Card>
  );
}

export default ServerDataGrid;
