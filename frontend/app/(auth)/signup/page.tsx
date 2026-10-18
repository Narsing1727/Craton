import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { api } from "@/lib/api";

export const metadata: Metadata = { title: "Create your account", description: "Version terrain, LiDAR and model files with your team." };

export default async function SignupPage() {
  const providers = await api.providers();
  const dev = process.env.NODE_ENV !== "production";
  const notSetUp = dev && providers ? [...(providers.google ? [] : ["Google"]), ...(providers.github ? [] : ["GitHub"])] : [];
  return <AuthForm mode="signup" google={Boolean(providers?.google) || dev} github={Boolean(providers?.github) || dev} notSetUp={notSetUp} sso={Boolean(providers?.sso)} />;
}
