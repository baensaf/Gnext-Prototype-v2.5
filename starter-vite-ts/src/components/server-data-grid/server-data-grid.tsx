import type {
  GridColDef,
  GridRowParams,
  GridSortModel,
  GridFilterModel,
  GridRowHeightParams,
  GridPaginationModel,
  GridRowSelectionModel,
  GridPinnedColumnFields,
  GridRowHeightReturnValue,
  GridColumnVisibilityModel,
} from '@mui/x-data-grid-premium';

import React from 'react';
import { useTranslation } from 'react-i18next';

import { faIR } from '@mui/x-data-grid-premium/locales';
import {
  Box,
  Card,
  Badge,
  Tooltip,
  Typography,
  CircularProgress,
} from '@mui/material';
import {
  Toolbar,
  ToolbarButton,
  DataGridPremium,
  useGridRootProps,
  useGridApiContext,
  FilterPanelTrigger,
  ColumnsPanelTrigger,
  GridToolbarQuickFilter,
} from '@mui/x-data-grid-premium';

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
  /** A row of filters under the column headers, one per filterable column. */
  headerFilters?: boolean;
  /** Hint in the toolbar's search box. */
  quickFilterPlaceholder?: string;
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
  /** Columns held at the start or end while the rest scroll sideways. */
  pinnedColumns?: GridPinnedColumnFields;
  /** Put on the toolbar's line, before the columns, filters and search: a page's tabs, say. */
  toolbarStart?: React.ReactNode;
}

/**
 * The grid's toolbar (columns, filters, search), with what the page puts before it on the
 * same line: a page's tabs, say. Built from the grid's own pieces, as its default toolbar is.
 */
function ToolbarWithStart({
  start,
  quickFilterProps,
}: {
  start?: React.ReactNode;
  quickFilterProps?: React.ComponentProps<typeof GridToolbarQuickFilter>;
}) {
  const apiRef = useGridApiContext();
  const rootProps = useGridRootProps();
  return (
    <Toolbar>
      <Box sx={{ flexGrow: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>{start}</Box>
      <Tooltip title={apiRef.current.getLocaleText('toolbarColumns')}>
        <ColumnsPanelTrigger render={<ToolbarButton />}>
          <rootProps.slots.columnSelectorIcon fontSize="small" />
        </ColumnsPanelTrigger>
      </Tooltip>
      <Tooltip title={apiRef.current.getLocaleText('toolbarFilters')}>
        <FilterPanelTrigger
          render={(triggerProps, state) => (
            <ToolbarButton {...(triggerProps as any)} color={state.filterCount > 0 ? 'primary' : 'default'}>
              <Badge badgeContent={state.filterCount} color="primary" variant="dot">
                <rootProps.slots.openFilterButtonIcon fontSize="small" />
              </Badge>
            </ToolbarButton>
          )}
        />
      </Tooltip>
      <GridToolbarQuickFilter {...quickFilterProps} />
    </Toolbar>
  );
}

// The grid's own words (the pager, the column menu, the toolbar) in the page's language.
// MUI's Persian pack leaves the pager's "1–25 of 84" in English.
const faLocaleText = {
  ...faIR.components.MuiDataGrid.defaultProps.localeText,
  paginationDisplayedRows: ({ from, to, count }: { from: number; to: number; count: number }) =>
    `${from}–${to} از ${count === -1 ? `بیش از ${to}` : count}`,
};

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
  headerFilters = false,
  quickFilterPlaceholder,
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
  pinnedColumns,
  toolbarStart,
}: ServerDataGridProps<T>) {
  const { t, i18n } = useTranslation();
  const localeText = i18n.language?.startsWith('fa') ? faLocaleText : undefined;

  const isServerPagination = rowCount !== undefined;
  const isServerFiltering = !!(filterModel && onFilterModelChange);

  return (
    <Card sx={{ height, width: '100%', display: 'flex', flexDirection: 'column', ...sx }}>
      <DataGridPremium
        rows={rows}
        columns={columns}
        loading={loading}
        getRowId={getRowId}
        density={density}
        paginationMode={isServerPagination ? 'server' : 'client'}
        sortingMode={sortModel && onSortModelChange ? 'server' : 'client'}
        filterMode={isServerFiltering ? 'server' : 'client'}
        rowCount={isServerPagination ? rowCount : undefined}
        paginationModel={paginationModel}
        onPaginationModelChange={onPaginationModelChange}
        pageSizeOptions={pageSizeOptions}
        sortModel={sortModel}
        onSortModelChange={onSortModelChange}
        filterModel={filterModel}
        onFilterModelChange={onFilterModelChange}
        headerFilters={headerFilters}
        // Grouping, aggregation and pivoting work on the rows in the browser. With the server
        // paging, that is one page, and the totals would read as the whole list's.
        disableRowGrouping={isServerPagination}
        disableAggregation={isServerPagination}
        disablePivoting={isServerPagination}
        rowSelectionModel={rowSelectionModel}
        onRowSelectionModelChange={onRowSelectionModelChange}
        checkboxSelection={checkboxSelection}
        disableRowSelectionOnClick={disableRowSelectionOnClick}
        onRowClick={onRowClick}
        hideFooterPagination={hideFooterPagination}
        localeText={localeText}
        // The theme turns the toolbar on for every grid; this lets a page leave it out.
        showToolbar={showToolbar}
        getRowHeight={getRowHeight}
        getRowClassName={getRowClassName}
        columnVisibilityModel={columnVisibilityModel}
        onColumnVisibilityModelChange={onColumnVisibilityModelChange}
        pinnedColumns={pinnedColumns}
        slots={{
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
          ...(toolbarStart ? { toolbar: ToolbarWithStart as any } : {}),
        }}
        slotProps={{
          toolbar: {
            ...(toolbarStart ? { start: toolbarStart } : {}),
            showQuickFilter: true,
            quickFilterProps: {
              debounceMs: 400,
              ...(quickFilterPlaceholder ? { slotProps: { root: { placeholder: quickFilterPlaceholder } } } : {}),
              // The server searches the whole phrase, not each word on its own.
              ...(isServerFiltering
                ? {
                    quickFilterParser: (input: string) => (input.trim() ? [input.trim()] : []),
                    quickFilterFormatter: (values: string[]) => values.join(' '),
                  }
                : {}),
            },
            // The grid's own export writes the rows it holds: one page when the server pages.
            ...(isServerPagination
              ? {
                  csvOptions: { disableToolbarButton: true },
                  printOptions: { disableToolbarButton: true },
                  excelOptions: { disableToolbarButton: true },
                }
              : {}),
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
