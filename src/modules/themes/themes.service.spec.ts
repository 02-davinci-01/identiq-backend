// src/modules/themes/themes.service.spec.ts
import { Test, TestingModule } from "@nestjs/testing";
import { ThemeService } from "./themes.service";
import { getRepositoryToken } from "@nestjs/typeorm";
import { repositoryMockFactory } from "../../../test/utils/repository-mock";
import { Theme } from "./entities/theme.entity";
import { User } from "../users/entities/user.entity";

// If your paths differ, update Theme/User import paths accordingly.

describe("ThemeService", () => {
  let service: ThemeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThemeService,
        {
          provide: getRepositoryToken(Theme),
          useValue: repositoryMockFactory(),
        },
        {
          provide: getRepositoryToken(User),
          useValue: repositoryMockFactory(),
        }, // User repo if required
      ],
    }).compile();

    service = module.get<ThemeService>(ThemeService);
  });

  afterEach(() => jest.clearAllMocks());

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
