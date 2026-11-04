import "server-only";
import pkg from "../../package.json";

/** The MediaHub version from package.json. The packaged build carries the same value. */
export const APP_VERSION: string = pkg.version;
