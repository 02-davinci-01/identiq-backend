// src/modules/users/users.service.spec.ts
import { Test, TestingModule } from "@nestjs/testing";
import { UsersService } from "./users.service";
import { getRepositoryToken } from "@nestjs/typeorm";
import { repositoryMockFactory } from "../../../test/utils/repository-mock";
import { User } from "./entities/user.entity";
import { Auth } from "../auth/entities/auth.entity";
import { Theme } from "../themes/entities/theme.entity";
import { DataSource } from "typeorm";

// adjust these entity imports if your project places them elsewhere

describe("UsersService", () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
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
        {
          provide: DataSource,
          useValue: { manager: {}, createQueryRunner: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => jest.clearAllMocks());

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
