import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";
import { schema } from "./db/schema";
import { env } from "./env";
import { ROLES } from "./roles";

function createAuth() {
  const { BETTER_AUTH_SECRET, BETTER_AUTH_URL } = env();
  // Secure cookies only when the public URL is https (LAN http dev stays usable).
  const secure = BETTER_AUTH_URL.startsWith("https://");

  return betterAuth({
    secret: BETTER_AUTH_SECRET,
    baseURL: BETTER_AUTH_URL,
    database: drizzleAdapter(db(), {
      provider: "sqlite",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      // Accounts are created by `npm run create-admin` only. The public sign-up endpoint is refused.
      disableSignUp: true,
    },
    user: {
      additionalFields: {
        role: {
          type: [...ROLES],
          required: false,
          defaultValue: "requester",
          // input: false means the client can never set role on sign-up or update.
          input: false,
        },
      },
    },
    advanced: {
      useSecureCookies: secure,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure },
    },
    // Lets server actions (sign-out) set/clear cookies.
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

/** Lazily-created Better Auth instance. Config is read from env() on first use, not at import. */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}
