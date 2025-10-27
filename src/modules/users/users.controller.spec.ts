// src/modules/users/users.controller.spec.ts
import { Test, TestingModule } from "@nestjs/testing";

import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";
import {
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from "@nestjs/common";

import { Logger } from "@nestjs/common";

beforeAll(() => {
  jest.spyOn(Logger.prototype, "error").mockImplementation(() => {});
});

// Mocks based on your service methods
const usersServiceMock = {
  getAllUsers: jest.fn(),
  findByEmail: jest.fn(),
  countUsers: jest.fn(),
  deleteByEmail: jest.fn(),
  checkCon: jest.fn(),
};

describe("UsersController", () => {
  let controller: UsersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersServiceMock }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  afterEach(() => jest.clearAllMocks());

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("getAll", () => {
    it("calls getAllUsers with parsed numeric limit/offset and returns mapped users", async () => {
      const mockedUsers = [
        {
          id: "u1",
          name: "Alice",
          email: "a@b",
          colorHex: "#fff",
          createdAt: "2020",
        },
      ];
      (usersServiceMock.getAllUsers as jest.Mock).mockResolvedValue(
        mockedUsers,
      );

      // controller.getAll accepts strings from @Query('limit')/@Query('offset')
      const res = await controller.getAll("2", "0");
      expect(usersServiceMock.getAllUsers).toHaveBeenCalledWith(2, 0);

      expect(Array.isArray(res)).toBe(true);
      expect(res[0]).toHaveProperty("id", "u1");
      expect(res[0]).toHaveProperty("name", "Alice");
    });

    it("passes undefined when limit/offset not provided", async () => {
      (usersServiceMock.getAllUsers as jest.Mock).mockResolvedValue([]);
      await controller.getAll(undefined, undefined);
      expect(usersServiceMock.getAllUsers).toHaveBeenCalledWith(
        undefined,
        undefined,
      );
    });
  });

  describe("getProfile", () => {
    it("returns user response when user exists", async () => {
      const jwtPayload = { email: "carol@example.com" };
      const userEntity = {
        id: "carol-id",
        name: "Carol",
        email: "carol@example.com",
      };
      (usersServiceMock.findByEmail as jest.Mock).mockResolvedValue(userEntity);

      const res = await controller.getProfile(jwtPayload);
      expect(usersServiceMock.findByEmail).toHaveBeenCalledWith(
        "carol@example.com",
      );
      expect(res).toHaveProperty("email", "carol@example.com");
      expect(res).toHaveProperty("id", "carol-id");
    });

    it("throws InternalServerErrorException when user not found and no fallback (matches controller)", async () => {
      const jwtPayload = { email: "missing@example.com" };
      (usersServiceMock.findByEmail as jest.Mock).mockResolvedValue(null);
      // Your controller logs and throws InternalServerErrorException in this path
      await expect(controller.getProfile(jwtPayload)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe("getCount", () => {
    it("returns count from usersService", async () => {
      (usersServiceMock.countUsers as jest.Mock).mockResolvedValue(42);
      const res = await controller.getCount();
      expect(usersServiceMock.countUsers).toHaveBeenCalled();
      expect(res).toEqual({ count: 42 });
    });
  });

  describe("deleteUser", () => {
    it("delegates deleteByEmail and returns result", async () => {
      (usersServiceMock.deleteByEmail as jest.Mock).mockResolvedValue({
        ok: true,
        deletedCount: 1,
      });
      const res = await controller.deleteUser({ email: "del@me" } as any);
      expect(usersServiceMock.deleteByEmail).toHaveBeenCalledWith("del@me");
      expect(res).toEqual({ ok: true, deletedCount: 1 });
    });

    it("throws BadRequestException when dto.email missing", async () => {
      await expect(controller.deleteUser({} as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("getcon (db check)", () => {
    it("calls checkCon and returns string", async () => {
      (usersServiceMock.checkCon as jest.Mock).mockResolvedValue(
        "found the data",
      );
      const out = await controller.getcon();
      expect(usersServiceMock.checkCon).toHaveBeenCalled();
      expect(out).toBeDefined();
    });
  });
});
