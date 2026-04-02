import { api } from "./client";

export const notificationsApi = {
  getUnreadCount: (companyId: string) => api.get<{ count: number }>(`/companies/${companyId}/notifications/unread-count`),
};
