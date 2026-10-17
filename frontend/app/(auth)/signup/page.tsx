import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { api } from "@/lib/api";

export const metadata: Metadata = { title: "Create your account", description: "Version terrain, LiDAR and model files with your team." };

export default async function SignupPage() {
  const providers = await api.providers();
  return <AuthForm mode="signup" google={Boolean(providers?.google)} github={Boolean(providers?.github)} />;
}
