// test/app.e2e-spec.ts (diagnostic + descriptive messages)
import {
  INestApplication,
  CanActivate,
  ExecutionContext,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { APP_GUARD } from "@nestjs/core";

// exact project paths (do not change)
import { AppModule } from "../src/app.module";
import { ThemeService } from "../src/modules/themes/themes.service";
import { UsersService } from "../src/modules/users/users.service";
import { AuthService } from "../src/modules/auth/auth.service";
import { BrevoService } from "../src/infrastructure/integrations/brevo/brevo.service";
import { JwtAuthGuard } from "../src/modules/common/guards/jwt-auth-guard";

// --- service mocks ---
const themeServiceMock = {
  getByEmail: jest.fn().mockResolvedValue({
    id: "t-by-email",
    email: "mock@local",
    name: "ThemeFor:mock@local",
  }),
  createDefaultForEmail: jest.fn().mockResolvedValue({
    id: "t-default",
    email: "mock@local",
    name: "Default",
  }),
  updateByEmail: jest.fn().mockResolvedValue({ id: "t-updated" }),
  createCustomTheme: jest
    .fn()
    .mockResolvedValue({ item: { hex: "#112233", label: "x" } }),
  removeCustomTheme: jest.fn().mockResolvedValue({ removed: true }),
  getCustomThemes: jest
    .fn()
    .mockResolvedValue([{ hex: "#ffffff", label: "Custom1" }]),
  fetchBatchByEmails: jest
    .fn()
    .mockResolvedValue([{ email: "a@x", theme: { id: "t1" } }]),
  getDistributionCounts: jest.fn().mockResolvedValue({
    ok: true,
    items: [{ label: "Light", count: 5, colorHex: "#ffffff" }],
  }),
};

const usersServiceMock = {
  checkCon: jest.fn().mockResolvedValue(1),
  findByEmail: jest.fn().mockResolvedValue({
    _id: "user-1",
    email: "mock@local",
    name: "MockUser",
  }),
  countUsers: jest.fn().mockResolvedValue(42),
  getAllUsers: jest.fn().mockResolvedValue([
    {
      _id: "user-1",
      name: "MockUser",
      email: "mock@local",
      colorHex: "#abc",
    },
  ]),
  deleteByEmail: jest.fn().mockResolvedValue({ ok: true }),
};

const authServiceMock = {
  initiatePasswordReset: jest.fn().mockResolvedValue({ message: "ok" }),
  confirmEmailChange: jest.fn().mockResolvedValue({ ok: true }),
  login: jest.fn().mockResolvedValue({
    accessToken: "dummy",
    jid: "jid",
    expiresIn: 3600,
    user: { email: "mock@local" },
  }),
  logout: jest.fn().mockResolvedValue({ ok: true }),
  changeName: jest.fn().mockResolvedValue({ name: "changed" }),
  changePassword: jest.fn().mockResolvedValue({ ok: true }),
  deleteAccountByEmail: jest.fn().mockResolvedValue({ ok: true }),
  initiateEmailChange: jest.fn().mockResolvedValue({ ok: true }),
  completePasswordResetWithEmail: jest
    .fn()
    .mockResolvedValue({ message: "Password updated" }),
};

const brevoServiceMock = {
  sendTransactionalEmail: jest.fn().mockResolvedValue({ ok: true }),
  sendEmail: jest.fn().mockResolvedValue({ ok: true }),
};

// --- diagnostic flags ---
let fakeGuardCalledCount = 0;

// Fake guard attaches req.user and logs invocation
const fakeAuthGuard: CanActivate = {
  canActivate(context: ExecutionContext) {
    fakeGuardCalledCount++;
    const req = context.switchToHttp().getRequest();
    req.user = { sub: "mock-user-id", email: "mock@local", name: "Mock User" };
    // eslint-disable-next-line no-console
    console.log(
      `[e2e-debug] fakeAuthGuard called (${fakeGuardCalledCount}) for ${req.method} ${req.url}`,
    );
    return true;
  },
};

describe("E2E DIAGNOSTIC — descriptive messages", () => {
  let app: INestApplication;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    const builder = Test.createTestingModule({
      imports: [AppModule],
    });

    // Replace global and class guards and mock services
    builder.overrideProvider(APP_GUARD).useValue(fakeAuthGuard);
    builder.overrideProvider(JwtAuthGuard).useValue(fakeAuthGuard);

    builder
      .overrideProvider(ThemeService)
      .useValue(themeServiceMock)
      .overrideProvider(UsersService)
      .useValue(usersServiceMock)
      .overrideProvider(AuthService)
      .useValue(authServiceMock)
      .overrideProvider(BrevoService)
      .useValue(brevoServiceMock);

    moduleRef = await builder.compile();

    // debug: report whether JwtAuthGuard is present in the compiled module
    try {
      const real = moduleRef.get(JwtAuthGuard, { strict: false });
      // eslint-disable-next-line no-console
      console.log(
        "[e2e-debug] moduleRef.get(JwtAuthGuard) ->",
        real ? "FOUND (overridden?)" : "NOT FOUND",
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log(
        "[e2e-debug] moduleRef.get(JwtAuthGuard) threw:",
        err?.message ?? err,
      );
    }

    app = moduleRef.createNestApplication();

    // attach fake guard to the app instance (covers app.useGlobalGuards in main.ts)
    app.useGlobalGuards(fakeAuthGuard as any);

    // log incoming requests
    app.use((req, _res, next) => {
      // eslint-disable-next-line no-console
      console.log(
        `[e2e-debug] incoming ${req.method} ${req.originalUrl || req.url}`,
      );
      next();
    });

    await app.init();

    // eslint-disable-next-line no-console
    console.log(
      "[e2e-debug] test app initialized; fakeGuardCalledCount=",
      fakeGuardCalledCount,
    );
  }, 30000);

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    fakeGuardCalledCount = 0;
  });

  // helper: perform request, then print a descriptive message showing expected vs actual
  async function runCheckAndDescribe(opts: {
    method: "get" | "post" | "delete";
    url: string;
    body?: any;
    expectedStatusDesc: string; // e.g. "200 OK"
    expectedServiceCall?: { name: string; args: any[] } | null;
  }) {
    const { method, url, body, expectedStatusDesc, expectedServiceCall } = opts;
    const http = app.getHttpServer();
    let res;
    if (method === "get") res = await request(http).get(url);
    else if (method === "post") res = await request(http).post(url).send(body);
    else res = await request(http).delete(url).send(body);

    const status = res.status;
    const bodyPreview = (() => {
      try {
        if (!res.body) return "<empty>";
        const s = JSON.stringify(res.body);
        return s.length > 500 ? s.slice(0, 500) + "…" : s;
      } catch {
        return String(res.body);
      }
    })();

    // Build descriptive expected/actual message
    let msg = `\n[ENDPOINT] ${method.toUpperCase()} ${url}\n`;
    msg += `  Expected: ${expectedStatusDesc}`;
    if (expectedServiceCall) {
      msg += ` and service call ${expectedServiceCall.name}(${JSON.stringify(expectedServiceCall.args)})`;
    }
    msg += `\n  Actual: status=${status}\n  Response body: ${bodyPreview}\n`;

    // If expectedServiceCall provided, check the corresponding mock and include details
    if (expectedServiceCall) {
      // attempt to find the mock by name from known mocks
      const mockMap: Record<string, any> = {
        "themeService.getByEmail": themeServiceMock.getByEmail,
        "themeService.getCustomThemes": themeServiceMock.getCustomThemes,
        "themeService.createCustomTheme": themeServiceMock.createCustomTheme,
        "themeService.fetchBatchByEmails": themeServiceMock.fetchBatchByEmails,
        "themeService.getDistributionCounts":
          themeServiceMock.getDistributionCounts,
        "usersService.findByEmail": usersServiceMock.findByEmail,
        "usersService.getAllUsers": usersServiceMock.getAllUsers,
        "usersService.deleteByEmail": usersServiceMock.deleteByEmail,
        "authService.initiatePasswordReset":
          authServiceMock.initiatePasswordReset,
      };

      const mockFn = mockMap[expectedServiceCall.name];
      if (!mockFn) {
        msg += `  NOTE: expected service mock "${expectedServiceCall.name}" not found in diagnostic map.\n`;
      } else {
        const called =
          Array.isArray(mockFn.mock?.calls) && mockFn.mock.calls.length > 0;
        msg += `  Service ${expectedServiceCall.name} called? ${called}\n`;
        if (called) {
          // show last call args
          const lastArgs = mockFn.mock.calls[mockFn.mock.calls.length - 1];
          msg += `  Service last call args: ${JSON.stringify(lastArgs)}\n`;
        } else {
          msg += `  Service expected args: ${JSON.stringify(expectedServiceCall.args)}\n`;
        }
      }
    }

    // show whether our fake guard ran
    msg += `  fakeAuthGuard called count so far: ${fakeGuardCalledCount}\n`;

    // print the message
    // eslint-disable-next-line no-console
    console.log(msg);

    return res;
  }

  // --- Tests with descriptive messages ---

  it("GET /themes/me - diagnostic + description", async () => {
    await runCheckAndDescribe({
      method: "get",
      url: "/themes/me",
      expectedStatusDesc: "200 OK and { ok: true, theme }",
      expectedServiceCall: {
        name: "themeService.getByEmail",
        args: ["mock@local"],
      },
    });
  });

  it("GET /themes/custom - diagnostic + description", async () => {
    await runCheckAndDescribe({
      method: "get",
      url: "/themes/custom",
      expectedStatusDesc: "200 OK and { ok: true, items: [] }",
      expectedServiceCall: {
        name: "themeService.getCustomThemes",
        args: ["mock@local"],
      },
    });
  });

  it("POST /themes/custom - diagnostic + description", async () => {
    await runCheckAndDescribe({
      method: "post",
      url: "/themes/custom",
      body: { hex: "#112233", label: "x" },
      expectedStatusDesc: "201 Created (or 200) and { ok: true, item }",
      expectedServiceCall: {
        name: "themeService.createCustomTheme",
        args: ["mock@local", { hex: "#112233", label: "x" }],
      },
    });
  });

  it("GET /themes/by-email?email=someone@example.com - diagnostic + description", async () => {
    await runCheckAndDescribe({
      method: "get",
      url: "/themes/by-email?email=someone@example.com",
      expectedStatusDesc: "200 OK and { ok: true, theme }",
      expectedServiceCall: {
        name: "themeService.getByEmail",
        args: ["someone@example.com"],
      },
    });
  });

  it("POST /themes/batch - diagnostic + description", async () => {
    await runCheckAndDescribe({
      method: "post",
      url: "/themes/batch",
      body: { emails: ["a@x", "b@y"] },
      expectedStatusDesc: "200 OK and { ok: true, items: [] }",
      expectedServiceCall: {
        name: "themeService.fetchBatchByEmails",
        args: [["a@x", "b@y"]],
      },
    });
  });

  it("GET /themes/distribution-counts - diagnostic + description", async () => {
    await runCheckAndDescribe({
      method: "get",
      url: "/themes/distribution-counts",
      expectedStatusDesc: "200 OK and { ok: true, items, counts }",
      expectedServiceCall: {
        name: "themeService.getDistributionCounts",
        args: [],
      },
    });
  });

  it("GET /users/me - diagnostic + description", async () => {
    await runCheckAndDescribe({
      method: "get",
      url: "/users/me",
      expectedStatusDesc: "200 OK and user DTO (from usersService.findByEmail)",
      expectedServiceCall: {
        name: "usersService.findByEmail",
        args: ["mock@local"],
      },
    });
  });

  it("GET /users/count - diagnostic + description (public)", async () => {
    await runCheckAndDescribe({
      method: "get",
      url: "/users/count",
      expectedStatusDesc: "200 OK and { count: number }",
      expectedServiceCall: { name: "usersService.countUsers", args: [] },
    });
  });

  it("GET /users - diagnostic + description (protected)", async () => {
    await runCheckAndDescribe({
      method: "get",
      url: "/users",
      expectedStatusDesc: "200 OK and array of users",
      expectedServiceCall: { name: "usersService.getAllUsers", args: [] },
    });
  });

  it("DELETE /users - diagnostic + description (protected)", async () => {
    await runCheckAndDescribe({
      method: "delete",
      url: "/users",
      body: { email: "to-delete@example.com" },
      expectedStatusDesc: "200 OK and deletion result",
      expectedServiceCall: {
        name: "usersService.deleteByEmail",
        args: ["to-delete@example.com"],
      },
    });
  });

  it("GET /auth/captcha - diagnostic + description (public)", async () => {
    await runCheckAndDescribe({
      method: "get",
      url: "/auth/captcha",
      expectedStatusDesc: "200 OK with svg and token",
      expectedServiceCall: null,
    });
  });

  it("POST /auth/forgot-password - diagnostic + description (public)", async () => {
    await runCheckAndDescribe({
      method: "post",
      url: "/auth/forgot-password",
      body: { email: "x@y.com" },
      expectedStatusDesc:
        "200 OK (neutral response) and authService.initiatePasswordReset called",
      expectedServiceCall: {
        name: "authService.initiatePasswordReset",
        args: ["x@y.com"],
      },
    });
  });
});
