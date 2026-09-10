import { httpClient } from './httpClient';

export interface OperationalAlertItem {
  id: string;
  tenant_id: string;
  branch_id?: string | null;
  type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  message: string;
  acknowledged: boolean;
  acknowledged_by?: string | null;
  acknowledged_at?: string | null;
  created_at: string;
  updated_at?: string;
}

// Alerts belong to the reports module and answer at one address. This file used to try
// /api/v1/alerts first and fall back to /api/v1/reports/alerts, because a second controller
// forwarded one to the other and nobody could say which was the real one.
export const alertsApi = {
  getAlerts: async (): Promise<OperationalAlertItem[]> => {
    try {
      const res = await httpClient.get<OperationalAlertItem[]>('/api/v1/reports/alerts');
      return Array.isArray(res.data) ? res.data : [];
    } catch {
      return [];
    }
  },

  acknowledgeAlert: async (id: string): Promise<OperationalAlertItem> => {
    const res = await httpClient.post<OperationalAlertItem>(`/api/v1/reports/alerts/${id}/acknowledge`);
    return res.data;
  },

  acknowledgeAll: async (alerts: OperationalAlertItem[]): Promise<void> => {
    const unacknowledged = alerts.filter((a) => !a.acknowledged);
    await Promise.allSettled(
      unacknowledged.map((a) => alertsApi.acknowledgeAlert(a.id))
    );
  },
};
