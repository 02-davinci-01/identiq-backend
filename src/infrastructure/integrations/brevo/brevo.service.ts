// src/infrastructure/integrations/brevo/brevo.service.ts
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios, { AxiosInstance } from "axios";
import https from "https";

@Injectable()
export class BrevoService {
  private readonly logger = new Logger(BrevoService.name);
  private readonly apiKey: string | undefined;
  private readonly senderEmail: string | undefined;
  private readonly senderName: string;
  private readonly frontendUrl: string;
  private readonly client: AxiosInstance;
  private readonly debugMode: boolean;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>("BREVO_API_KEY");
    this.senderEmail = this.config.get<string>("BREVO_SENDER_EMAIL");
    this.senderName = this.config.get<string>("BREVO_SENDER_NAME") ?? "YourApp";
    // Use FRONTEND_URL fallback so links never become undefined
    this.frontendUrl =
      this.config.get<string>("FRONTEND_URL") ?? "http://localhost:3000";

    // BREVO_DEBUG env toggle: when true we log payloads and DO NOT POST to Brevo
    const rawDebug =
      process.env.BREVO_DEBUG ?? this.config.get<string>("BREVO_DEBUG");
    this.debugMode = !!rawDebug && /^(1|true)$/i.test(String(rawDebug).trim());

    const relaxTLS = process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0";
    if (relaxTLS) {
      this.logger.warn(
        "BrevoService running with relaxed TLS verification (NODE_TLS_REJECT_UNAUTHORIZED=0). DEV ONLY.",
      );
    }

    const agent = new https.Agent({
      rejectUnauthorized: !relaxTLS,
    });

    this.client = axios.create({
      baseURL: "https://api.brevo.com/v3",
      httpsAgent: agent,
      timeout: 15000,
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Safe debug log (does not log keys)
    this.logger.log(
      `Brevo init: apiKey?=${!!this.apiKey} senderEmail?=${!!this.senderEmail} frontendUrl=${this.frontendUrl} debugMode=${this.debugMode}`,
    );
  }

  private ensureConfigured() {
    if (!this.apiKey) {
      this.logger.error(
        "BREVO_API_KEY not configured; aborting Brevo operation",
      );
      throw new Error("BREVO_API_KEY not configured");
    }
    if (!this.senderEmail) {
      this.logger.error(
        "BREVO_SENDER_EMAIL not configured; aborting Brevo operation",
      );
      throw new Error("BREVO_SENDER_EMAIL not configured");
    }
  }

  private defaultHeaders() {
    return { "api-key": this.apiKey! };
  }

  private formatAxiosError(err: any) {
    if (err?.response?.data) return err.response.data;
    if (err?.message) return { message: err.message };
    return { message: String(err) };
  }

  buildVerifyLink(token: string, extraParams?: Record<string, string>) {
    const base = this.frontendUrl.replace(/\/$/, "") + "/complete-register";
    const params = new URLSearchParams({ token, ...(extraParams ?? {}) });
    return `${base}?${params.toString()}`;
  }

  private async resolveTemplateId(
    ref?: string | number,
  ): Promise<number | undefined> {
    if (ref === undefined || ref === null || String(ref).trim() === "")
      return undefined;

    const refStr = String(ref).trim();
    // numeric -> use directly
    if (/^\d+$/.test(refStr)) {
      return Number(refStr);
    }

    // otherwise fetch transactional templates and try to find a match
    try {
      const res = await this.client.get("/smtp/templates", {
        headers: this.defaultHeaders(),
      });

      // API shape: { templates: [ ... ] } OR sometimes array directly
      const templates: any[] = res.data?.templates ?? res.data ?? [];
      if (!Array.isArray(templates)) {
        this.logger.warn("Unexpected /smtp/templates response shape", res.data);
        throw new Error("Unexpected templates response");
      }

      const lowerRef = refStr.toLowerCase();

      const match = templates.find((t) => {
        const idStr = t?.id ? String(t.id) : "";
        const uuid = (t?.uuid ?? t?.uid ?? "").toString();
        const name = (t?.name ?? t?.title ?? "").toString();
        const alias = (t?.alias ?? "").toString();

        return (
          idStr === refStr ||
          uuid.toLowerCase() === lowerRef ||
          name.toLowerCase() === lowerRef ||
          alias.toLowerCase() === lowerRef
        );
      });

      if (!match) {
        this.logger.warn(
          `Could not resolve template ref '${refStr}' among transactional templates.`,
        );
        throw new Error(
          `Template reference '${refStr}' not found among transactional templates`,
        );
      }

      this.logger.log(
        `Resolved template reference '${refStr}' -> numeric id=${match.id}`,
      );
      return Number(match.id);
    } catch (err: any) {
      const formatted = this.formatAxiosError(err);
      this.logger.error("Error resolving Brevo template id", formatted);
      throw new Error(
        formatted?.message ?? `Failed to resolve template id for '${refStr}'`,
      );
    }
  }

  /**
   * Centralized method to either POST to Brevo or log payload when debugMode is on.
   * Returns the actual Brevo response (data) or a mock debug response.
   */
  private async postEmail(payload: any) {
    if (this.debugMode) {
      // Use logger + console so it is visible in different runtimes; avoid printing secrets.
      this.logger.warn(
        "BREVO_DEBUG active — not sending email. Payload (safe preview):",
      );
      // Create a redacted preview to avoid logging secrets like api keys (payload itself usually safe)
      const safePreview = JSON.parse(JSON.stringify(payload));
      // Redact obvious fields if present
      if (safePreview?.sender?.email) safePreview.sender.email = "[REDACTED]";
      if (safePreview?.to)
        safePreview.to = safePreview.to.map((t: any) => ({ email: t.email }));
      // console.log so developer sees structure during local dev
      /* eslint-disable no-console */
      console.log("Brevo debug payload:", safePreview);
      /* eslint-enable no-console */
      return { debug: true, payload: safePreview };
    }

    try {
      const res = await this.client.post("/smtp/email", payload, {
        headers: this.defaultHeaders(),
      });
      return res.data;
    } catch (err: any) {
      const formatted = this.formatAxiosError(err);
      // throw the formatted message as Error for callers to handle
      this.logger.error("Brevo send failed", formatted);
      throw new Error(formatted?.message ?? "Failed to send email");
    }
  }

  /**
   * Send verification email.
   */
  async sendVerificationEmail(
    toEmail: string,
    token: string,
    options?: {
      subject?: string;
      htmlContent?: string;
      extraParams?: Record<string, string>;
      templateId?: string | number;
    },
  ) {
    this.ensureConfigured();

    // pick requested template ref: explicit option -> env var -> undefined
    const envTemplateRaw = this.config.get<string | number>(
      "BREVO_VERIFICATION_TEMPLATE_ID",
    );
    const requestedTemplateRef = options?.templateId ?? envTemplateRaw;

    // Resolve to numeric id if needed
    let resolvedTemplateId: number | undefined;
    if (requestedTemplateRef) {
      try {
        resolvedTemplateId = await this.resolveTemplateId(requestedTemplateRef);
      } catch (err) {
        this.logger.warn(
          `Failed to resolve verification template '${String(requestedTemplateRef)}' — falling back to htmlContent if provided.`,
        );
        resolvedTemplateId = undefined;
      }
    }

    // Build verifyLink (use provided extraParams only to add query params)
    const providedParams = options?.extraParams ?? {};
    const verifyLink =
      providedParams.verifyLink ?? this.buildVerifyLink(token, providedParams);

    // params to pass to template
    const params = {
      token,
      verifyLink,
      ...providedParams,
    };

    // If we have a resolved template id -> send templated transactional email
    if (resolvedTemplateId) {
      const payload = {
        sender: { name: this.senderName, email: this.senderEmail },
        to: [{ email: toEmail }],
        templateId: resolvedTemplateId,
        params,
      };

      const data = await this.postEmail(payload);
      this.logger.log(
        `Brevo: sent transactional template ${resolvedTemplateId} to ${toEmail}`,
      );
      return data;
    }

    // No template configured: fallback to raw HTML send (replace {{verifyLink}} placeholder)
    if (!options?.htmlContent) {
      this.logger.error(
        "No transactional template configured and no htmlContent provided",
      );
      throw new Error("No email content or template available");
    }

    const htmlWithLink = options.htmlContent.replace(
      /\{\{verifyLink\}\}/g,
      verifyLink,
    );

    const payload = {
      sender: { name: this.senderName, email: this.senderEmail },
      to: [{ email: toEmail }],
      subject: options?.subject ?? "Verify your email",
      htmlContent: htmlWithLink,
    };

    const data = await this.postEmail(payload);
    this.logger.log(`Brevo: sent fallback HTML email to ${toEmail}`);
    return data;
  }

  /**
   * Generic template sender if callers prefer to call this directly.
   * Accepts explicit templateId (numeric) and params.
   */
  async sendTemplate(
    toEmail: string,
    templateId: number,
    params: Record<string, any> = {},
  ) {
    this.ensureConfigured();

    const payload = {
      sender: { name: this.senderName, email: this.senderEmail },
      to: [{ email: toEmail }],
      templateId,
      params,
    };

    const data = await this.postEmail(payload);
    this.logger.log(`Brevo: sent template ${templateId} to ${toEmail}`);
    return data;
  }

  async sendForgotPasswordEmail(
    toEmail: string,
    token: string,
    options?: {
      subject?: string;
      htmlContent?: string;
      extraParams?: Record<string, string>;
      // optional override: can be numeric id, template UID, or name
      templateId?: string | number;
    },
  ) {
    this.ensureConfigured();

    // Determine requested template reference:
    // precedence: explicit options.templateId -> env BREVO_FORGOT_TEMPLATE_ID -> default numeric 3
    const envForgot = this.config.get<string | number>(
      "BREVO_FORGOT_TEMPLATE_ID",
    );
    const requestedRef = options?.templateId ?? envForgot ?? 3;

    // Resolve to a numeric template id (resolveTemplateId will call /smtp/templates if needed)
    let resolvedTemplateId: number | undefined;
    try {
      resolvedTemplateId = await this.resolveTemplateId(requestedRef);
    } catch (err: any) {
      // If resolving fails, log and proceed to fallback behavior (htmlContent branch)
      this.logger.warn(
        `Failed to resolve forgot-password template ref '${String(requestedRef)}' — falling back to htmlContent if provided.`,
      );
      resolvedTemplateId = undefined;
    }

    // Build verifyLink exactly like sendVerificationEmail does
    const providedParams = options?.extraParams ?? {};
    const verifyLink =
      providedParams.verifyLink ?? this.buildVerifyLink(token, providedParams);

    // Merge params just like other sender methods
    const params = {
      token,
      verifyLink,
      ...providedParams,
    };

    // If template resolved -> send templated transactional email
    if (resolvedTemplateId) {
      const payload = {
        sender: { name: this.senderName, email: this.senderEmail },
        to: [{ email: toEmail }],
        templateId: resolvedTemplateId,
        params,
      };

      const data = await this.postEmail(payload);
      this.logger.log(
        `Brevo: sent forgot-password template ${resolvedTemplateId} to ${toEmail}`,
      );
      return data;
    }

    // If we reach here: no template resolved. Fallback to htmlContent behavior (must be provided).
    if (!options?.htmlContent) {
      this.logger.error(
        "No transactional template resolved for forgot-password and no htmlContent provided",
      );
      throw new Error(
        "No email content or template available for forgot-password",
      );
    }

    const htmlWithLink = options.htmlContent.replace(
      /\{\{verifyLink\}\}/g,
      verifyLink,
    );

    const fallbackPayload = {
      sender: { name: this.senderName, email: this.senderEmail },
      to: [{ email: toEmail }],
      subject: options?.subject ?? "Reset your password",
      htmlContent: htmlWithLink,
    };

    const data = await this.postEmail(fallbackPayload);
    this.logger.log(`Brevo: sent fallback forgot-password HTML to ${toEmail}`);
    return data;
  }
}
