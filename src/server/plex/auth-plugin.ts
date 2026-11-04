import "server-only";
import { type BetterAuthPlugin, type InternalAdapter } from "better-auth";
import { APIError, createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { env } from "@/server/env";
import { normalizeName } from "@/server/users/names";
import { claimPlexAdminConfig, clearPlexAdminConfig, getPlexAdminConfig } from "./admin-config";
import {
  authAppUrl,
  checkPin,
  createPin,
  getOwnedServers,
  getPlexAccount,
  PlexRequestError,
} from "./client";
import {
  newStateValue,
  parseStoredState,
  pinIdentifier,
  PinStateSchema,
  PIN_COOKIE,
  setupIdentifier,
  SetupStateSchema,
  SETUP_COOKIE,
  STATE_COOKIE_MAX_AGE_SECONDS,
  STATE_TTL_MS,
  type SetupState,
} from "./state";

// Plex sign-in for MediaHub. Two flows share these endpoints:
//   - Admin sign-in: the Plex account must own the configured server and match the stored owner id.
//   - Setup: until something is configured, the first person to finish it picks a server and becomes admin.
// The Plex token is used inside the callback only. It is never stored, logged or returned.

const CALLBACK_PATH = "/api/auth/plex/callback";
/** Retries after the first PIN check, so one call can make up to four. */
const PLEX_RETRY_LIMIT = 3;
const PLEX_RETRY_DELAY_MS = 1000;
const PLACEHOLDER_EMAIL_DOMAIN = "users.plex.invalid";

export type PlexAuthOptions = {
  /** Test seam for the pause between PIN checks. Defaults to a real timer. */
  wait?: (ms: number) => Promise<void>;
};

type PlexAccount = { id: number; username: string; email: string | null };
type PlexServer = { clientIdentifier: string; name: string };
type AdminUser = NonNullable<Awaited<ReturnType<InternalAdapter["findUserById"]>>>;

function appUrl(path: string): string {
  return new URL(path, env().BETTER_AUTH_URL).toString();
}

function stateCookieOptions() {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env().BETTER_AUTH_URL.startsWith("https://"),
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
  };
}

/**
 * A JSON error reply with a real HTTP status. Better Auth's ctx.json ignores the status on this path,
 * so the Response is built directly. Its body has the shape the setup page reads: { error }.
 */
function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } });
}

type CookieSetter = { setCookie: (name: string, value: string, options?: object) => string };

function clearStateCookie(ctx: CookieSetter, name: string) {
  ctx.setCookie(name, "", { ...stateCookieOptions(), maxAge: 0 });
}

/** Asks plex.tv for the token, retrying a few times because approval can take a moment to show up. */
async function collectToken(pinId: number, wait: (ms: number) => Promise<void>): Promise<string | null> {
  for (let retry = 0; ; retry++) {
    const token = await checkPin(pinId);
    if (token) return token;
    if (retry >= PLEX_RETRY_LIMIT) return null;
    await wait(PLEX_RETRY_DELAY_MS);
  }
}

// The role is an additional field, so it is not in the inferred User type. Read it defensively.
const isAdmin = (user: object) => "role" in user && user.role === "admin";

/**
 * The admin for a finished setup. Rule 1: the user already linked to this Plex account. Rule 2: the
 * only admin without a Plex account (Gary's email admin), whose password is removed. Rule 3: a new admin.
 */
async function chooseAdminUser(adapter: InternalAdapter, pending: SetupState): Promise<AdminUser> {
  const linked = await adapter.findAccountByKey({ providerId: "plex", accountId: pending.accountId });
  if (linked) {
    const user = await adapter.findUserById(linked.userId);
    if (!user) throw new Error("The Plex account is linked to a missing user.");
    if (isAdmin(user)) return user;
    await adapter.updateUser(user.id, { role: "admin" });
    const promoted = await adapter.findUserById(user.id);
    if (!promoted) throw new Error("The promoted admin user could not be read back.");
    return promoted;
  }

  const admins = await adapter.listUsers(1000, 0, undefined, [{ field: "role", value: "admin" }]);
  const candidates = [];
  for (const admin of admins) {
    const accounts = await adapter.findAccounts(admin.id);
    if (!accounts.some((account) => account.providerId === "plex")) candidates.push({ admin, accounts });
  }
  const [only] = candidates;
  if (candidates.length === 1 && only) {
    // Link Plex first, then remove the password: if the link fails, the admin can still sign in as before.
    await adapter.createAccount({ userId: only.admin.id, providerId: "plex", accountId: pending.accountId });
    for (const account of only.accounts) {
      if (account.providerId === "credential") await adapter.deleteAccount(account.id);
    }
    return only.admin;
  }

  // The Plex email is used only when no other user has it. Otherwise a placeholder address is used.
  const plexEmail = pending.email?.trim().toLowerCase() || null;
  const emailFree = plexEmail !== null && !(await adapter.findUserByEmail(plexEmail));
  const email = emailFree && plexEmail ? plexEmail : `plex-${pending.accountId}@${PLACEHOLDER_EMAIL_DOMAIN}`;
  const user = await adapter.createUser(
    { name: pending.username || "Plex admin", email, role: "admin", emailVerified: false },
    { method: "plex" },
  );
  await adapter.createAccount({ userId: user.id, providerId: "plex", accountId: pending.accountId });
  return user;
}

/**
 * Every refusal in the sign-in hook goes through here, so each one gives the same reply. The password is
 * hashed first, as the normal path does, so the response time doesn't reveal the account either.
 */
async function refuseSignIn(hash: (password: string) => Promise<string>, password: unknown): Promise<never> {
  if (typeof password === "string") await hash(password);
  throw APIError.fromStatus("UNAUTHORIZED", {
    code: "INVALID_EMAIL_OR_PASSWORD",
    message: "Invalid email or password",
  });
}

/** Plex sign-in endpoints, plus the rule that admins can't sign in with a password. Registered in src/server/auth.ts. */
export function plexAuth(options: PlexAuthOptions = {}): BetterAuthPlugin {
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  return {
    id: "plex-admin",
    endpoints: {
      /** Creates a Plex PIN and returns the plex.tv approval address. The browser opens it. */
      plexStart: createAuthEndpoint("/plex/start", { method: "POST" }, async (ctx) => {
        let pin: { id: number; code: string };
        try {
          pin = await createPin();
        } catch (error) {
          if (!(error instanceof PlexRequestError)) throw error;
          ctx.context.logger.warn(`Plex sign-in: ${error.message}`);
          return jsonError(502, "plex-unavailable");
        }

        const state = newStateValue();
        await ctx.context.internalAdapter.createVerificationValue({
          identifier: pinIdentifier(state),
          value: JSON.stringify({ pinId: pin.id }),
          expiresAt: new Date(Date.now() + STATE_TTL_MS),
        });
        ctx.setCookie(PIN_COOKIE, state, stateCookieOptions());
        return ctx.json({ url: authAppUrl({ code: pin.code, forwardPath: CALLBACK_PATH }) });
      }),

      /** Where Plex sends the browser once the PIN is approved. Either admin sign-in or the start of setup. */
      plexCallback: createAuthEndpoint("/plex/callback", { method: "GET" }, async (ctx) => {
        const cookie = ctx.getCookie(PIN_COOKIE);
        clearStateCookie(ctx, PIN_COOKIE);
        const row = cookie ? await ctx.context.internalAdapter.consumeVerificationValue(pinIdentifier(cookie)) : null;
        const pin = row ? parseStoredState(PinStateSchema, row.value) : null;
        if (!pin) throw ctx.redirect(appUrl("/login?plex=expired"));

        // Read once, so a setup that finishes during the Plex calls can't mix the two flows.
        const config = getPlexAdminConfig();
        const errorPath = config ? "/login" : "/setup";
        let account: PlexAccount;
        let servers: PlexServer[];
        try {
          const token = await collectToken(pin.pinId, wait);
          if (!token) throw ctx.redirect(appUrl(`${errorPath}?plex=not-approved`));
          account = await getPlexAccount(token);
          servers = await getOwnedServers(token);
        } catch (error) {
          if (!(error instanceof PlexRequestError)) throw error;
          ctx.context.logger.warn(`Plex sign-in: ${error.message}`);
          throw ctx.redirect(appUrl(`${errorPath}?plex=error`));
        }

        const adapter = ctx.context.internalAdapter;
        if (config) {
          const ownsServer = servers.some((server) => server.clientIdentifier === config.serverId);
          if (String(account.id) !== config.ownerAccountId || !ownsServer) {
            throw ctx.redirect(appUrl("/login?plex=denied"));
          }
          const linked = await adapter.findAccountByKey({ providerId: "plex", accountId: String(account.id) });
          const user = linked ? await adapter.findUserById(linked.userId) : null;
          if (!user || !isAdmin(user)) throw ctx.redirect(appUrl("/login?plex=denied"));

          const session = await adapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          throw ctx.redirect(appUrl("/"));
        }

        if (servers.length === 0) throw ctx.redirect(appUrl("/setup?plex=no-servers"));
        const setupState = newStateValue();
        const pending: SetupState = {
          accountId: String(account.id),
          username: account.username,
          email: account.email,
          servers,
        };
        await adapter.createVerificationValue({
          identifier: setupIdentifier(setupState),
          value: JSON.stringify(pending),
          expiresAt: new Date(Date.now() + STATE_TTL_MS),
        });
        ctx.setCookie(SETUP_COOKIE, setupState, stateCookieOptions());
        throw ctx.redirect(appUrl("/setup/server"));
      }),

      /** Finishes setup: stores the chosen server and signs the browser in as the admin. */
      plexSetupComplete: createAuthEndpoint(
        "/plex/setup/complete",
        { method: "POST", body: z.strictObject({ serverId: z.string().min(1).max(200) }) },
        async (ctx) => {
          const cookie = ctx.getCookie(SETUP_COOKIE);
          clearStateCookie(ctx, SETUP_COOKIE);
          const row = cookie ? await ctx.context.internalAdapter.consumeVerificationValue(setupIdentifier(cookie)) : null;
          const pending = row ? parseStoredState(SetupStateSchema, row.value) : null;
          if (!pending) return jsonError(400, "expired");

          const server = pending.servers.find((candidate) => candidate.clientIdentifier === ctx.body.serverId);
          if (!server) return jsonError(400, "unknown-server");
          if (getPlexAdminConfig() !== null) return jsonError(409, "already-set-up");

          const claimed = claimPlexAdminConfig({
            serverId: server.clientIdentifier,
            serverName: server.name,
            ownerAccountId: pending.accountId,
          });
          if (!claimed) return jsonError(409, "already-set-up");

          let admin: AdminUser;
          try {
            admin = await chooseAdminUser(ctx.context.internalAdapter, pending);
          } catch (error) {
            // The claim is in but no admin was made. Undo it, so setup can be tried again.
            clearPlexAdminConfig();
            throw error;
          }

          // Sessions from before setup (a password session, for example) end here.
          await ctx.context.internalAdapter.deleteUserSessions(admin.id);
          const session = await ctx.context.internalAdapter.createSession(admin.id);
          await setSessionCookie(ctx, { session, user: admin });
          return ctx.json({ ok: true });
        },
      ),
    },

    hooks: {
      // ONE before-hook on purpose. Better Auth gives every hook the original request, and merges returned
      // contexts only afterwards. If name lookup and the admin refusal were separate hooks, the admin check
      // would see the name, not the email, and an admin could sign in by name with a password.
      before: [
        {
          // Two jobs. (1) Sign-in by name: a name with no "@" is looked up, and must match exactly one user
          // after normalising. The email is then put in the body for Better Auth. (2) Admins sign in only
          // with Plex, so an admin (by email or name) gets the same reply as a wrong password, which doesn't
          // reveal which emails or names belong to admins. Until Plex is set up the old admin password still
          // works, so an upgraded install can't lock its admin out before setup.
          matcher: (ctx) => ctx.path === "/sign-in/email",
          handler: createAuthMiddleware(async (ctx) => {
            const body = ctx.body as { email?: unknown; password?: unknown } | undefined;
            const raw = typeof body?.email === "string" ? body.email.trim() : "";
            if (!raw) return;

            const adapter = ctx.context.internalAdapter;
            const refuse = () => refuseSignIn((password) => ctx.context.password.hash(password), body?.password);
            let user: { email: string } | null = null;
            let resolvedEmail: string | null = null;
            if (raw.includes("@")) {
              user = (await adapter.findUserByEmail(raw.toLowerCase()))?.user ?? null;
            } else {
              // MediaHub has a handful of users, so list them and compare in memory.
              const wanted = normalizeName(raw);
              const matches = (await adapter.listUsers(10_000, undefined, undefined, undefined)).filter(
                (candidate) => normalizeName(candidate.name) === wanted,
              );
              // Unknown and ambiguous names are refused the same way.
              if (matches.length !== 1) return refuse();
              user = matches[0];
              resolvedEmail = user.email;
            }

            if (user && isAdmin(user) && getPlexAdminConfig() !== null) return refuse();
            if (resolvedEmail) return { context: { body: { ...body, email: resolvedEmail } } };
          }),
        },
      ],
    },
  };
}
