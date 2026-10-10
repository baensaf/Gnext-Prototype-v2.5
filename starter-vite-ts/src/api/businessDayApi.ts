import { httpClient } from './httpClient';

// ----------------------------------------------------------------------

/** The branch's business day now: its date and when it turns over. */
export interface CurrentBusinessDay {
  branchId: string | null;
  businessDate: string;
  startsAt: string;
  endsAt: string;
  cutoff: string;
  timeZone: string;
}

export const businessDayApi = {
  getCurrent: async (branchId?: string | null): Promise<CurrentBusinessDay> => {
    const res = await httpClient.get('/api/v1/business-days/current', { params: { branchId: branchId || undefined } });
    return res.data;
  },

};
