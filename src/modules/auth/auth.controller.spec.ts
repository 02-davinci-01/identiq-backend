// src/modules/auth/auth.controller.spec.ts

// --- Important mocks that must run before importing files that require them ---
// Mock Brevo integration so tests don't attempt to resolve actual integration file.
// This prevents "Cannot find module 'src/infrastructure/integrations/brevo/brevo.service'" errors.
jest.mock("src/infrastructure/integrations/brevo/brevo.service", () => {
  return {
    BrevoService: jest.fn().mockImplementation(() => ({
      // add the methods your AuthService might call on BrevoService
      sendEmail: jest.fn().mockResolvedValue(true),
    })),
  };
});

// (Optional) If you find other "src/..." imports failing, mock them here similarly
// jest.mock('src/some/other/module', () => ({ ... }));

import { Test, TestingModule } from "@nestjs/testing";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import type { Response } from "express";

// NOTE: this spec intentionally imports the controller class. The AuthService class file
// may also be imported by the controller at runtime; we avoid brevo resolution above.

describe("AuthController (unit)", () => {
  let controller: AuthController;

  // Mocked AuthService covering the methods used by controller.
  // Keep these in sync with what your controller calls.
  const authServiceMock = {
    register: jest.fn(),
    completeRegisterWithEmail: jest.fn(),
    login: jest.fn(),
    refreshTokens: jest.fn(),
    logout: jest.fn(),
    changeName: jest.fn(),
    changePassword: jest.fn(),
    deleteAccountByEmail: jest.fn(),
    initiateEmailChange: jest.fn(),
    confirmEmailChange: jest.fn(),
    initiatePasswordReset: jest.fn(),
    completePasswordResetWithEmail: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authServiceMock }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("registerUser", () => {
    it("calls authService.register and returns value", async () => {
      const dto = { email: "a@b.com", password: "p" } as any;
      (authServiceMock.register as jest.Mock).mockResolvedValue({ ok: true });
      const res = await controller.registerUser(dto);
      expect(authServiceMock.register).toHaveBeenCalledWith(dto);
      expect(res).toEqual({ ok: true });
    });
  });

  describe("complete (complete-register)", () => {
    it("calls completeRegisterWithEmail with token, email, password", async () => {
      const dto = { password: "pw" } as any;
      (
        authServiceMock.completeRegisterWithEmail as jest.Mock
      ).mockResolvedValue({ ok: true });
      const result = await controller.complete(dto, "u@example.com", "tok123");
      expect(authServiceMock.completeRegisterWithEmail).toHaveBeenCalledWith(
        "tok123",
        "u@example.com",
        "pw",
      );
      expect(result).toEqual({ ok: true });
    });
  });

  describe("getCaptchaHmac", () => {
    it("returns svg, token and expiresIn", async () => {
      const out = await controller.getCaptchaHmac();
      expect(typeof out.svg).toBe("string");
      expect(typeof out.token).toBe("string");
      expect(typeof out.expiresIn).toBe("number");
      // basic shape assertions
      expect(out.token.split(".").length).toBe(2);
    });
  });

  describe("verifyCaptchaHmac", () => {
    it("throws when missing token or answer", async () => {
      await expect(
        controller.verifyCaptchaHmac(undefined as any),
      ).rejects.toThrow();
      await expect(
        controller.verifyCaptchaHmac({ token: "t" } as any),
      ).rejects.toThrow();
      await expect(
        controller.verifyCaptchaHmac({ answer: "a" } as any),
      ).rejects.toThrow();
    });

    it("returns ok/false shape when called with token/answer (delegates internals to controller)", async () => {
      const captcha = await controller.getCaptchaHmac();
      const token = captcha.token;
      const res = await controller.verifyCaptchaHmac({
        token,
        answer: "wronganswer",
      } as any);
      expect(res).toHaveProperty("ok");
    });
  });

  describe("logout", () => {
    it("calls authService.logout using jid header/body/user", async () => {
      const mockReq = { user: { id: "u1", jid: "jid-user" } } as any;
      // case: jid from header
      await controller.logout(mockReq, "jid-header" as any, undefined);
      expect(authServiceMock.logout).toHaveBeenCalledWith("u1", "jid-header");

      jest.clearAllMocks();
      // case: jid from body
      await controller.logout(mockReq, undefined, { jid: "jid-body" });
      expect(authServiceMock.logout).toHaveBeenCalledWith("u1", "jid-body");

      jest.clearAllMocks();
      // case: jid from user
      await controller.logout(mockReq, undefined, undefined);
      expect(authServiceMock.logout).toHaveBeenCalledWith("u1", "jid-user");
    });

    it("throws on missing user or jid", async () => {
      await expect(
        controller.logout(undefined as any, undefined, undefined),
      ).rejects.toThrow();
      const badReq = { user: {} } as any;
      await expect(
        controller.logout(badReq, undefined, undefined),
      ).rejects.toThrow();
    });
  });

  describe("me", () => {
    it("returns req.user", () => {
      const req = { user: { id: "u1" } } as any;
      expect(controller.me(req)).toEqual({ id: "u1" });
    });
  });

  describe("changeName", () => {
    it("validates jwt and dto then calls authService.changeName", async () => {
      const jwt = { email: "me@x.com" };
      const dto = { name: "New Name" } as any;
      (authServiceMock.changeName as jest.Mock).mockResolvedValue({
        name: "New Name",
      });
      const res = await controller.changeName(jwt as any, dto);
      expect(authServiceMock.changeName).toHaveBeenCalledWith(
        "me@x.com",
        "New Name",
      );
      expect(res).toEqual({ ok: true, name: "New Name", email: "me@x.com" });
    });

    it("throws when email or name missing", async () => {
      await expect(
        controller.changeName({} as any, { name: "x" } as any),
      ).rejects.toThrow();
      await expect(
        controller.changeName({ email: "e" } as any, {} as any),
      ).rejects.toThrow();
    });
  });

  describe("changePassword", () => {
    it("validates and calls changePassword", async () => {
      const jwt = { email: "me@x.com" };
      const dto = { oldPassword: "o", password: "n" } as any;
      (authServiceMock.changePassword as jest.Mock).mockResolvedValue(
        undefined,
      );
      const res = await controller.changePassword(jwt as any, dto);
      expect(authServiceMock.changePassword).toHaveBeenCalledWith(
        "me@x.com",
        "o",
        "n",
      );
      expect(res).toEqual({ ok: true, message: "Password updated" });
    });

    it("throws when missing email or password", async () => {
      await expect(
        controller.changePassword({} as any, {} as any),
      ).rejects.toThrow();
    });
  });

  describe("deleteAccount", () => {
    it("calls deleteAccountByEmail and returns ok", async () => {
      (authServiceMock.deleteAccountByEmail as jest.Mock).mockResolvedValue(
        undefined,
      );
      const res = await controller.deleteAccount({ email: "me@x" } as any);
      expect(authServiceMock.deleteAccountByEmail).toHaveBeenCalledWith("me@x");
      expect(res).toEqual({ ok: true, message: "Account deleted" });
    });

    it("throws when no email", async () => {
      await expect(controller.deleteAccount({} as any)).rejects.toThrow();
    });
  });

  describe("requestEmailChange", () => {
    it("delegates to initiateEmailChange", async () => {
      (authServiceMock.initiateEmailChange as jest.Mock).mockResolvedValue({
        ok: true,
      });
      const payload = { email: "me@x" } as any;
      const body = { newEmail: "new@x" } as any;
      const res = await controller.requestEmailChange(payload, body);
      expect(authServiceMock.initiateEmailChange).toHaveBeenCalledWith(
        "me@x",
        "new@x",
      );
      expect(res).toEqual({ ok: true });
    });
  });

  describe("confirmEmailChangeGet", () => {
    it("calls confirmEmailChange with query token and email", async () => {
      (authServiceMock.confirmEmailChange as jest.Mock).mockResolvedValue({
        ok: true,
      });
      const query = { token: "t", email: "e@x" } as any;
      const res = await controller.confirmEmailChangeGet(query);
      expect(authServiceMock.confirmEmailChange).toHaveBeenCalledWith(
        "t",
        "e@x",
      );
      expect(res).toEqual({ ok: true });
    });
  });

  describe("forgotPassword", () => {
    it("calls initiatePasswordReset and returns neutral response", async () => {
      (authServiceMock.initiatePasswordReset as jest.Mock).mockResolvedValue({
        message: "sent",
      });
      const res = await controller.forgotPassword({ email: "a@b" } as any);
      expect(authServiceMock.initiatePasswordReset).toHaveBeenCalledWith("a@b");
      expect(res).toEqual({ ok: true, message: "sent" });
    });
  });

  describe("resetPassword", () => {
    it("returns error when token or email missing", async () => {
      const res = await controller.resetPassword(undefined, undefined, {
        password: "x",
      } as any);
      expect(res).toEqual({
        ok: false,
        message: "Missing token or email in query",
      });
    });

    it("calls completePasswordResetWithEmail when token and email present", async () => {
      (
        authServiceMock.completePasswordResetWithEmail as jest.Mock
      ).mockResolvedValue({ message: "done" });
      const out = await controller.resetPassword("tk", "e@x", {
        password: "pw",
      } as any);
      expect(
        authServiceMock.completePasswordResetWithEmail,
      ).toHaveBeenCalledWith("e@x", "tk", "pw");
      expect(out).toEqual({ ok: true, message: "done" });
    });
  });
});
