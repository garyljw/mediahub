import { requirePageUser } from "@/server/authz";
import { getAuth } from "@/server/auth";
import { listUsers } from "@/server/users";
import { UsersManager, type UserRow } from "@/components/settings/users-manager";

export const metadata = { title: "Users" };
export const instant = false;

export default async function UsersPage() {
  await requirePageUser("admin");
  const users = await listUsers(await getAuth().$context);

  // Only these fields cross to the browser. The date is cut to yyyy-mm-dd on the server, in UTC.
  const rows: UserRow[] = users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    created: user.createdAt.toISOString().slice(0, 10),
  }));

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Requesters sign in with an email and password. Admins sign in with Plex.
      </p>
      <div className="mt-6">
        <UsersManager users={rows} />
      </div>
    </div>
  );
}
