import { httpClient } from './httpClient';

export interface ApprovalRule {
  id: string;
  action: string;
  threshold_type: string;
  threshold_value: string;
  required_steps: number;
  approver_role: string;
  is_active: boolean;
}

export interface ApprovalRequest {
  id: string;
  code: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  requester_user_id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';
  current_step: number;
  total_steps: number;
  reason?: string;
  details?: Record<string, any>;
  expires_at: string;
  created_at: string;
}

export const approvalApi = {
  getRules: async (): Promise<ApprovalRule[]> => {
    const res = await httpClient.get('/api/v1/approvals/rules');
    return res.data;
  },
  saveRule: async (data: Partial<ApprovalRule>): Promise<ApprovalRule> => {
    const res = await httpClient.post('/api/v1/approvals/rules', data);
    return res.data;
  },
  verifyPin: async (pin: string, userId?: string, actionName?: string): Promise<{ success: boolean; role: string }> => {
    const res = await httpClient.post('/api/v1/approvals/verify-pin', { pin, userId, actionName });
    return res.data;
  },
  evaluateAction: async (action: string, value: number): Promise<{ requires_approval: boolean; threshold_value?: string; required_steps?: number; approver_role?: string }> => {
    const res = await httpClient.post('/api/v1/approvals/evaluate', { action, value });
    return res.data;
  },
  getRequests: async (): Promise<ApprovalRequest[]> => {
    const res = await httpClient.get('/api/v1/approvals/requests');
    return res.data;
  },
  createRequest: async (data: { action: string; entity_type: string; entity_id?: string; reason?: string; details?: any; total_steps?: number }): Promise<ApprovalRequest> => {
    const res = await httpClient.post('/api/v1/approvals/requests', data);
    return res.data;
  },
  approveRequest: async (id: string, pin: string, note?: string): Promise<ApprovalRequest> => {
    const res = await httpClient.post(`/api/v1/approvals/requests/${id}/approve`, { pin, note });
    return res.data;
  },
  rejectRequest: async (id: string, pin: string, note?: string): Promise<ApprovalRequest> => {
    const res = await httpClient.post(`/api/v1/approvals/requests/${id}/reject`, { pin, note });
    return res.data;
  },
};
