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

export interface DateReviewRow {
  id: string;
  reference: string | null;
  at: string;
  stored_date: string;
  rule_date: string;
}

export interface DateReviewSection {
  count: number | string;
  rows: DateReviewRow[];
}

/** Stored dates the current cutoff rule would have given differently. Nothing is changed. */
export interface DateReview {
  branchId: string;
  from: string;
  to: string;
  rule: { cutoff: string; timeZone: string };
  changesStoredDates: false;
  orders: DateReviewSection;
  payments: DateReviewSection;
  refunds: DateReviewSection;
  shifts: DateReviewSection;
}

export const businessDayApi = {
  getCurrent: async (branchId?: string | null): Promise<CurrentBusinessDay> => {
    const res = await httpClient.get('/api/v1/business-days/current', { params: { branchId: branchId || undefined } });
    return res.data;
  },

  getDateReview: async (params: { branchId: string; from?: string; to?: string }): Promise<DateReview> => {
    const res = await httpClient.get('/api/v1/business-days/date-review', { params });
    return res.data;
  },
};
