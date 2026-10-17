import { redirect } from "next/navigation";
import { getSession } from "@/server/authz";
import { signOut } from "./actions";

export const instant = false;

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-start justify-center gap-4 px-4">
      <p className="text-base text-zinc-800">
        Signed in as {session.email} ({session.role})
      </p>
      <form action={signOut}>
        <button
          type="submit"
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
