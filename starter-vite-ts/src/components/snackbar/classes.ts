import { createClasses } from 'src/theme/create-classes';

// ----------------------------------------------------------------------

export const snackbarClasses = {
  root: createClasses('snackbar__root'),
  toast: createClasses('snackbar__toast'),
  title: createClasses('snackbar__title'),
  description: createClasses('snackbar__description'),
  loader: createClasses('snackbar__loader'),
  closeButton: createClasses('snackbar__close_button'),
  actionButton: createClasses('snackbar__action_button'),
  cancelButton: createClasses('snackbar__cancel_button'),
  // States
  default: createClasses('snackbar__state_default'),
  info: createClasses('snackbar__state_info'),
  success: createClasses('snackbar__state_success'),
  warning: createClasses('snackbar__state_warning'),
  error: createClasses('snackbar__state_error'),
};
