const stamp = () => new Date().toISOString();

export const logger = {
  info: (...args: unknown[]) => console.log(stamp(), "INFO ", ...args),
  warn: (...args: unknown[]) => console.warn(stamp(), "WARN ", ...args),
  error: (...args: unknown[]) => console.error(stamp(), "ERROR", ...args),
};