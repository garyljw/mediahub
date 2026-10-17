import { redirect } from "next/navigation";
import { getSession } from "@/server/authz";
import { LoginForm } from "./login-form";

// Reads the session to redirect signed-in users. Block on the server for a real redirect.
export const instant = false;

export default async function LoginPage() {
  if (await getSession()) redirect("/");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Sign in to MediaHub</h1>
      <LoginForm />
    </main>
  );
}
