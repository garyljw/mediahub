import "server-only";

// The Ed25519 public key that signs update manifests. Copy of installer/update-public-key.pem;
// public-key.test.ts fails if the two differ. The private half lives only in the release environment.
export const UPDATE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAAmkbkhQJE1+FaL1xAKQsODBpWTrzzBbNKXiZzx0AfZ0=
-----END PUBLIC KEY-----
`;
