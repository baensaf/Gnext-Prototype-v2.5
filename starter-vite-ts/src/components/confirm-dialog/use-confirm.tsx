import { useTranslation } from 'react-i18next';
import { useRef, useState, useCallback } from 'react';

import { ConfirmDialog } from './confirm-dialog';

// ----------------------------------------------------------------------

/**
 * The app's own dialog in place of the browser's `window.confirm`, for the few steps the screen
 * can't undo. `const ok = await confirm(text)`; render `dialog` once in the page.
 */
export function useConfirm() {
  const { t } = useTranslation();
  const [text, setText] = useState<string | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback(
    (message: string) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setText(message);
      }),
    []
  );

  const finish = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setText(null);
  };

  const dialog = (
    <ConfirmDialog
      open={text !== null}
      title={text || ''}
      confirmLabel={t('common.confirm', 'Confirm')}
      onClose={() => finish(false)}
      onConfirm={() => finish(true)}
    />
  );

  return { confirm, dialog };
}
