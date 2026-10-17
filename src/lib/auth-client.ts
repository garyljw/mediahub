import { createAuthClient } from "better-auth/react";

// No baseURL: defaults to same-origin /api/auth. Holds no secrets.
export const authClient = createAuthClient();
