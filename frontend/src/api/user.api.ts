import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";

export type UserType = "student" | "builder" | "other";
export type CommunicationStyle = "concise" | "detailed";

export interface Me {
  user: { id: string; email: string; fullName: string | null; imageUrl: string | null };
  preferences: { timezone: string; userType: UserType | null; communicationStyle: CommunicationStyle };
  onboarded: boolean;
}

export interface ProfileInput {
  fullName: string;
  timezone: string;
  userType: UserType;
  communicationStyle: CommunicationStyle;
}

export const getMe = () => apiFetch<Me>("/users/me");

export const saveProfile = (input: ProfileInput) =>
  apiFetch<Me>("/users/me/profile", { method: "PUT", data: input });

// Shared by every component that needs the current user, so it is fetched once and cached.
export const meQueryOptions = queryOptions({
  queryKey: ["me"],
  queryFn: getMe,
  staleTime: 60_000,
  retry: 1,
});