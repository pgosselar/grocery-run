import type { AdminInvite, AdminOverview } from "../../shared/types";
import { api } from "./store";

export const adminOverview = () => api<AdminOverview>("GET", "/api/admin");

export const createInvite = (input: { name: string; email?: string; send?: boolean }) =>
  api<{ invite: AdminInvite; emailError?: string }>("POST", "/api/admin/invites", input);

export const revokeInvite = (token: string) => api("DELETE", `/api/admin/invites/${encodeURIComponent(token)}`);

export const tempPassword = (userId: string) =>
  api<{ password: string }>("POST", `/api/admin/users/${userId}/temp-password`);

export const emailReset = (userId: string) => api("POST", `/api/admin/users/${userId}/reset-email`);

export const signOutEverywhere = (userId: string) => api("POST", `/api/admin/users/${userId}/sign-out`);
