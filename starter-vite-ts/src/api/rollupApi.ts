import { httpClient } from './httpClient';

/**
 * Head office's read-only view of what the branches are doing.
 *
 * Both of these answer about every shop at once, which is why they live together and why
 * neither has a write beside it. Assigning a courier, counting a drawer and closing a till
 * all stay on the branch's own screens — from head office you can see the numbers and
 * phone the branch, and that is the whole intended surface. The API refuses both endpoints
 * for an account pinned to a branch, so the pages behind them are chain-only too.
 */

export interface FleetRollupRow {
  branch_id: string;
  branch: string;
  branch_code: string;
  in_flight: number;
  unassigned: number;
  late: number;
  delivered_today: number;
  failed_today: number;
  couriers_active: number;
  couriers_on_shift: number;
  cash_with_couriers: string;
}

export interface FleetRollup {
  business_date: string;
  late_after_minutes: number;
  generated_at: string;
  rows: FleetRollupRow[];
  totals: {
    branch_count: number;
    branches_with_late: number;
    in_flight: number;
    unassigned: number;
    late: number;
    delivered_today: number;
    failed_today: number;
    couriers_active: number;
    couriers_on_shift: number;
    cash_with_couriers: string;
  };
}

export const rollupApi = {
  getFleetRollup: async (): Promise<FleetRollup> => {
    const res = await httpClient.get('/api/v1/delivery/rollup');
    return res.data;
  },
};
