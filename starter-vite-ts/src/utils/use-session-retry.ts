import { useEffect } from 'react';

import { useAuthStore } from 'src/store/useAuthStore';

import { useCloudBack } from './cloud-back';

// ----------------------------------------------------------------------

/** While the session is unknown, `/auth/me` is asked again this often. */
const RETRY_MS = 3_000;

/**
 * While it is not known whether the session is good (`sessionUnknown`: Gnext could not be
 * reached when the app asked), asks `/auth/me` again every 3 s, one request at a time, and at once
 * when the cloud is back (`gnext:cloud-back`), until a real answer ends it: 200 signs in as
 * before, 401 sends the person to sign in. Returns `sessionUnknown`.
 */
export function useSessionRetry(): boolean {
  const sessionUnknown = useAuthStore((state) => state.sessionUnknown);
  const fetchMe = useAuthStore((state) => state.fetchMe);

  useEffect(() => {
    if (!sessionUnknown) return undefined;
    const ask = () => {
      if (!useAuthStore.getState().isLoading) fetchMe();
    };
    const timer = setInterval(ask, RETRY_MS);
    return () => clearInterval(timer);
  }, [sessionUnknown, fetchMe]);

  useCloudBack(() => {
    const { sessionUnknown: unknown, isLoading } = useAuthStore.getState();
    if (unknown && !isLoading) fetchMe();
  });

  return sessionUnknown;
}
