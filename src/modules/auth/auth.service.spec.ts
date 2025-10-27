// src/modules/auth/auth.service.spec.ts
import { Test, TestingModule } from "@nestjs/testing";
import { AuthService } from "./auth.service";
import { getRepositoryToken } from "@nestjs/typeorm";
import { repositoryMockFactory } from "../../../test/utils/repository-mock";
import { User } from "../users/entities/user.entity";
import { Auth } from "./entities/auth.entity";
import { Theme } from "../themes/entities/theme.entity";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { DataSource } from "typeorm";

// Correct import of BrevoService class (from your integration module)
import { BrevoService } from "src/infrastructure/integrations/brevo/brevo.service";
// ✅ Correct import — file name is themes.service.ts but it exports ThemeService (singular)
import { ThemeService } from "src/modules/themes/themes.service";

// ---- Mocks ----
const brevoMock = {
  sendEmail: jest.fn().mockResolvedValue(true),
};

const configMock = {
  get: jest.fn().mockImplementation((key: string) => {
    if (key === "JWT_SECRET") return "test-secret";
    if (key === "JWT_EXPIRATION_TIME") return "3600";
    return "value";
  }),
};

const jwtMock = {
  sign: jest.fn().mockReturnValue("signed-token"),
  verify: jest.fn(),
};

const themeServiceMock = {
  createDefaultTheme: jest.fn(),
  findForUser: jest.fn(),
};

describe("AuthService", () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(User),
          useValue: repositoryMockFactory(),
        },
        {
          provide: getRepositoryToken(Auth),
          useValue: repositoryMockFactory(),
        },
        {
          provide: getRepositoryToken(Theme),
          useValue: repositoryMockFactory(),
        },
        { provide: ConfigService, useValue: configMock },
        { provide: BrevoService, useValue: brevoMock },
        { provide: JwtService, useValue: jwtMock },
        {
          provide: DataSource,
          useValue: { manager: {}, createQueryRunner: jest.fn() },
        },
        // ✅ provide correct ThemeService token
        { provide: ThemeService, useValue: themeServiceMock },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => jest.clearAllMocks());

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should include Brevo mock properly", () => {
    expect(brevoMock.sendEmail).toBeDefined();
  });

  it("should include ThemeService mock properly", () => {
    expect(themeServiceMock.findForUser).toBeDefined();
  });
});
