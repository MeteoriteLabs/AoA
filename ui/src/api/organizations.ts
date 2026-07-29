import { api } from "./client";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
}

export interface OrganizationMembership {
  id: string;
  organizationId: string;
  userId: string;
  role: "owner" | "admin" | "member" | "billing";
  status: string;
}

export const organizationsApi = {
  create: (data: { name: string }) => api.post<Organization>("/organizations", data),
  list: () => api.get<OrganizationMembership[]>("/organizations"),
};
