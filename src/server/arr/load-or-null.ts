import "server-only";
import { ArrRequestError } from "./request";

/**
 * Loads one app's library for a page. An Arr request failure must not take the other app down, so it is logged and
 * reported as null. Anything that isn't a request failure is rethrown.
 */
export async function loadOrNull<T>(load: () => Promise<T>, where: string): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    if (!(error instanceof ArrRequestError)) throw error;
    // ArrRequestError messages never contain the host, key or response body, so they are safe to log.
    console.error(`${where}: ${error.message}`);
    return null;
  }
}
