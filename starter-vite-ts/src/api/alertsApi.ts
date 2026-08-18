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

export const alertsApi = {
  getAlerts: async (): Promise<OperationalAlertItem[]> => {
    try {
      const res = await httpClient.get<OperationalAlertItem[]>('/api/v1/alerts');
      return Array.isArray(res.data) ? res.data : [];
    } catch {
      // Fallback endpoint if alias controller differs
      try {
        const fallbackRes = await httpClient.get<OperationalAlertItem[]>('/api/v1/reports/alerts');
        return Array.isArray(fallbackRes.data) ? fallbackRes.data : [];
      } catch {
        return [];
      }
    }
  },

  acknowledgeAlert: async (id: string): Promise<OperationalAlertItem> => {
    try {
      const res = await httpClient.post<OperationalAlertItem>(`/api/v1/alerts/${id}/acknowledge`);
      return res.data;
    } catch {
      const res = await httpClient.post<OperationalAlertItem>(`/api/v1/reports/alerts/${id}/acknowledge`);
      return res.data;
    }
  },

  acknowledgeAll: async (alerts: OperationalAlertItem[]): Promise<void> => {
    const unacknowledged = alerts.filter((a) => !a.acknowledged);
    await Promise.allSettled(
      unacknowledged.map((a) => alertsApi.acknowledgeAlert(a.id))
    );
  },
};
