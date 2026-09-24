import nodemailer from "nodemailer";
import type { Logger } from "../../types.js";
import type { MailConfig } from "../../config/env.js";

export interface AccountMailer {
  sendWelcome(email: string): Promise<void>;
}

export function createAccountMailer(config: MailConfig, logger: Logger): AccountMailer {
  if (config.status === "disabled") return { async sendWelcome() {} };
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
  });
  return {
    async sendWelcome(email) {
      try {
        await transport.sendMail({
          from: config.from,
          to: email,
          subject: "Welcome to NutriTrack",
          text: "Your NutriTrack account is ready. This message does not verify ownership of this email address.",
        });
      } catch {
        logger.warn("Welcome email delivery failed.");
      }
    },
  };
}
