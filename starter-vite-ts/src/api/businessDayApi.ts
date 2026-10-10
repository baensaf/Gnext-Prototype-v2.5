import { httpClient } from './httpClient';

// ----------------------------------------------------------------------

/** The branch's business day now: its date, when it turns over, and the shop's hours. */
export interface CurrentBusinessDay {
  branchId: string | null;
  businessDate: string;
  startsAt: string;
  endsAt: string;
  opensAt: string;
  closesAt: string;
  isOpen: boolean;
  cutoff: string;
  operatingHours: { opensAt: string; closesAt: string };
  timeZone: string;
  autoClose: boolean;
}

export const businessDayApi = {
  getCurrent: async (branchId?: string | null): Promise<CurrentBusinessDay> => {
    const res = await httpClient.get('/api/v1/business-days/current', { params: { branchId: branchId || undefined } });
    return res.data;
  },

};
