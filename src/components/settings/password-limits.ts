// Password length limits for requester accounts. Shared by the Users form (browser) and src/server/users,
// which checks them again on the server. MAX matches Better Auth's default emailAndPassword.maxPasswordLength
// (128), which is hardcoded in better-auth/dist/context/create-context.mjs and not exported, so keep the two in step.
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;
