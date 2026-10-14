import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Create your account", description: "Version terrain, LiDAR and model files with your team." };

export default function SignupPage() {
  return <AuthForm mode="signup" />;
}
