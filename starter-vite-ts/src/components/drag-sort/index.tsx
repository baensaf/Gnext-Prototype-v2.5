import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import TableCell from '@mui/material/TableCell';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';

// ----------------------------------------------------------------------

/**
 * Rows put in order by dragging them, the way every list with an order is sorted here: no
 * "sort order" numbers to type and no up/down arrows. `onDrop` gets the whole list in its new
 * order; saving it is the caller's.
 */
export function useDragSort<T extends { id: string }>(items: T[], onDrop: (next: T[]) => void, enabled = true) {
  const [dragId, setDragId] = useState<string | null>(null);
  const canDrag = enabled && items.length > 1;

  const rowProps = (id: string) =>
    canDrag
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', id);
            setDragId(id);
          },
          onDragEnd: () => setDragId(null),
          onDragOver: (e: React.DragEvent) => e.preventDefault(),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            const from = items.findIndex((i) => i.id === dragId);
            const to = items.findIndex((i) => i.id === id);
            setDragId(null);
            if (from < 0 || to < 0 || from === to) return;
            const next = [...items];
            const [moved] = next.splice(from, 1);
            next.splice(to, 0, moved);
            onDrop(next);
          },
          sx: { opacity: dragId === id ? 0.4 : 1 },
        }
      : {};

  return { rowProps, canDrag };
}

/** The grip at the start of a draggable row; an empty cell when the list can't be dragged. */
export function DragHandleCell({ show }: { show: boolean }) {
  const { t } = useTranslation();
  return (
    <TableCell sx={{ width: 40, px: 1, color: 'text.disabled', cursor: show ? 'grab' : 'default' }}>
      {show && <DragIndicatorIcon fontSize="small" titleAccess={t('common.dragToSort')} />}
    </TableCell>
  );
}
