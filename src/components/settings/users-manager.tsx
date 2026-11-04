"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import {
  addRequester,
  deleteRequesterAccount,
  resetRequesterPassword,
  signOutRequester,
  type UsersResult,
} from "@/app/(app)/settings/users/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Role } from "@/server/roles";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./password-limits";

/** A user as the browser sees it. Only these fields are sent from the server page. */
export type UserRow = { id: string; name: string; email: string; role: Role; created: string };


const ROLE_LABELS: Record<Role, string> = { admin: "Admin", requester: "Requester" };
const CELL = "py-1.5 px-2";
const HEAD = "h-8 py-1.5 px-2";

type Note = { ok: boolean; message: string };

const FAILED = "Something went wrong. Try again.";

/** The client-side check. The server checks the same things again. */
function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return `Enter a password of ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirm) return "The two passwords don't match.";
  return null;
}

/** Lists requesters and admins, with add, reset password, sign out and delete for requesters. */
export function UsersManager({ users }: { users: UserRow[] }) {
  const [note, setNote] = useState<Note | null>(null);
  const [pending, startTransition] = useTransition();

  /** Runs one server action. `done` is shown on success, and `after` runs once it succeeds. */
  function run(action: () => Promise<UsersResult>, done: string, after?: () => void) {
    startTransition(async () => {
      try {
        const outcome = await action();
        if (outcome.ok) {
          setNote({ ok: true, message: done });
          after?.();
        } else {
          setNote({ ok: false, message: outcome.message });
        }
      } catch {
        setNote({ ok: false, message: FAILED });
      }
    });
  }

  return (
    <div className="space-y-8">
      <section className="rounded-lg border p-5">
        <h2 className="text-lg font-semibold">Add requester</h2>
        <div className="mt-4">
          <AddRequesterForm />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Accounts</h2>
        {note && (
          <p role={note.ok ? "status" : "alert"} className={note.ok ? "text-sm" : "text-sm text-destructive"}>
            {note.message}
          </p>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={HEAD}>Name</TableHead>
              <TableHead className={HEAD}>Email</TableHead>
              <TableHead className={HEAD}>Role</TableHead>
              <TableHead className={HEAD}>Created</TableHead>
              <TableHead className={`${HEAD} text-right`}>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <UserRowView key={user.id} user={user} busy={pending} run={run} setNote={setNote} />
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function UserRowView({
  user,
  busy,
  run,
  setNote,
}: {
  user: UserRow;
  busy: boolean;
  run: (action: () => Promise<UsersResult>, done: string, after?: () => void) => void;
  setNote: (note: Note) => void;
}) {
  const [resetting, setResetting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const newId = useId();
  const confirmId = useId();

  function submitReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = passwordProblem(password, confirm);
    if (problem) {
      setNote({ ok: false, message: problem });
      return;
    }
    run(
      () => resetRequesterPassword({ userId: user.id, password }),
      `Password changed for ${user.email}. They are signed out everywhere.`,
      () => {
        setResetting(false);
        setPassword("");
        setConfirm("");
      },
    );
  }

  return (
    <>
      <TableRow>
        <TableCell className={CELL}>{user.name}</TableCell>
        <TableCell className={CELL}>{user.email}</TableCell>
        <TableCell className={CELL}>{ROLE_LABELS[user.role]}</TableCell>
        <TableCell className={CELL}>{user.created}</TableCell>
        <TableCell className={`${CELL} text-right`}>
          {user.role === "admin" ? (
            <span className="text-sm text-muted-foreground">Signs in with Plex</span>
          ) : (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                aria-expanded={resetting}
                onClick={() => setResetting((open) => !open)}
              >
                Reset password
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run(() => signOutRequester({ userId: user.id }), `Signed ${user.email} out everywhere.`)
                }
              >
                Sign out everywhere
              </Button>
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => setConfirmingDelete(true)}>
                Delete
              </Button>
              <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Delete {user.name}?</DialogTitle>
                    <DialogDescription>
                      This removes {user.email} and signs them out everywhere. It cannot be undone.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setConfirmingDelete(false)} disabled={busy}>
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => deleteRequesterAccount({ userId: user.id }),
                          `Deleted ${user.email}.`,
                          () => setConfirmingDelete(false),
                        )
                      }
                    >
                      Delete requester
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </TableCell>
      </TableRow>
      {resetting && (
        <TableRow>
          <TableCell colSpan={5} className="px-2 pb-3">
            <form onSubmit={submitReset} className="flex flex-wrap items-end gap-3">
              <div className="grid gap-1.5">
                <label htmlFor={newId} className="text-sm font-medium">
                  New password for {user.email}
                </label>
                <Input
                  id={newId}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-64"
                  required
                />
              </div>
              <div className="grid gap-1.5">
                <label htmlFor={confirmId} className="text-sm font-medium">
                  Confirm new password
                </label>
                <Input
                  id={confirmId}
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  className="w-64"
                  required
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={busy}>
                  Save password
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setResetting(false)} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </form>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function AddRequesterForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [result, setResult] = useState<Note | null>(null);
  const [pending, startTransition] = useTransition();
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const confirmId = useId();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = passwordProblem(password, confirm);
    if (problem) {
      setResult({ ok: false, message: problem });
      return;
    }
    const added = email.trim().toLowerCase();
    startTransition(async () => {
      try {
        const outcome = await addRequester({ name, email, password });
        if (outcome.ok) {
          setResult({ ok: true, message: `Added ${added}.` });
          setName("");
          setEmail("");
          setPassword("");
          setConfirm("");
        } else {
          setResult({ ok: false, message: outcome.message });
        }
      } catch {
        setResult({ ok: false, message: FAILED });
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor={nameId} className="text-sm font-medium">
            Name
          </label>
          <Input id={nameId} value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" required />
          <p className="text-xs text-muted-foreground">Used to sign in, with the password. Must be unique.</p>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={emailId} className="text-sm font-medium">
            Email
          </label>
          <Input
            id={emailId}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={passwordId} className="text-sm font-medium">
            Password
          </label>
          <Input
            id={passwordId}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            required
          />
          <p className="text-xs text-muted-foreground">
            {MIN_PASSWORD_LENGTH} to {MAX_PASSWORD_LENGTH} characters.
          </p>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={confirmId} className="text-sm font-medium">
            Confirm password
          </label>
          <Input
            id={confirmId}
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            required
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          Add requester
        </Button>
      </div>
      {result?.ok === true && (
        <p role="status" className="text-sm">
          {result.message}
        </p>
      )}
      {result?.ok === false && (
        <p role="alert" className="text-sm text-destructive">
          {result.message}
        </p>
      )}
    </form>
  );
}
