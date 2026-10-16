import { safeNativePath } from '../domain/links';

// Expo Router invokes this for both cold-start and running-app native URL events.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return safeNativePath(path);
}
