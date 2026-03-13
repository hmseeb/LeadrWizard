import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  ...(process.env.NODE_ENV !== "production" && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true },
    },
  }),
});

export type Logger = pino.Logger;

export function createRouteLogger(
  route: string,
  context?: {
    correlation_id?: string;
    org_id?: string;
    session_id?: string;
  }
) {
  return logger.child({ route, ...context });
}
