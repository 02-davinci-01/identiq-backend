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

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>("BREVO_API_KEY");
    this.senderEmail = this.config.get<string>("BREVO_SENDER_EMAIL");
    this.senderName = this.config.get<string>("BREVO_SENDER_NAME") ?? "YourApp";
    // Use FRONTEND_URL fallback so links never become undefined
    this.frontendUrl =
      this.config.get<string>("FRONTEND_URL") ?? "http://localhost:3000";

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
      `Brevo init: apiKey?=${!!this.apiKey} senderEmail?=${!!this.senderEmail} frontendUrl=${this.frontendUrl}`,
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

  /**
   * Resolve a template reference (number, numeric string, alphanumeric UID, or name)
   * into the numeric transactional template id Brevo expects.
   *
   * If `ref` is numeric, returns it immediately.
   * Otherwise fetches /v3/smtp/templates and attempts to match by:
   *  - id (number)
   *  - uuid / uid
   *  - name (case-insensitive)
   *
   * Throws if the reference cannot be resolved.
   */
  private async resolveTemplateId(
    ref?: string | number,
  ): Promise<number | undefined> {
    if (!ref && ref !== 0) return undefined;

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
   * Send verification email.
   * - toEmail: recipient
   * - token: raw token (not hashed)
   * - options.extraParams: any params you want available in template (e.g. name, email)
   * - options.htmlContent: fallback HTML if no template is configured
   * - options.templateId: optional override of env BREVO_VERIFICATION_TEMPLATE_ID (can be numeric or UID)
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
      resolvedTemplateId = await this.resolveTemplateId(requestedTemplateRef);
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

      try {
        const res = await this.client.post("/smtp/email", payload, {
          headers: this.defaultHeaders(),
        });
        this.logger.log(
          `Brevo: sent transactional template ${resolvedTemplateId} to ${toEmail} (status ${res.status})`,
        );
        return res.data;
      } catch (err: any) {
        const formatted = this.formatAxiosError(err);
        this.logger.error("Brevo template send failed", formatted);
        throw new Error(formatted?.message ?? "Failed to send templated email");
      }
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

    try {
      const res = await this.client.post("/smtp/email", payload, {
        headers: this.defaultHeaders(),
      });
      this.logger.log(
        `Brevo: sent fallback HTML email to ${toEmail} (status ${res.status})`,
      );
      return res.data;
    } catch (err: any) {
      const formatted = this.formatAxiosError(err);
      this.logger.error("Brevo raw email send failed", formatted);
      throw new Error(formatted?.message ?? "Failed to send email");
    }
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

    try {
      const res = await this.client.post("/smtp/email", payload, {
        headers: this.defaultHeaders(),
      });
      this.logger.log(
        `Brevo: sent template ${templateId} to ${toEmail} (status ${res.status})`,
      );
      return res.data;
    } catch (err: any) {
      const formatted = this.formatAxiosError(err);
      this.logger.error("Brevo template send failed", formatted);
      throw new Error(formatted?.message ?? "Failed to send templated email");
    }
  }
}
