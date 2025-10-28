// // src/modules/themes/themes.controller.spec.ts
// import { Test, TestingModule } from "@nestjs/testing";
// import { ThemesController } from "./themes.controller";
// import { ThemeService } from "./themes.service";
// import { BadRequestException } from "@nestjs/common";

// // Confirmed controller shape: getMyTheme(jwt) and updateMyTheme(jwt, dto)
// // (source: src/modules/themes/themes.controller.ts). :contentReference[oaicite:4]{index=4}

// const themeServiceMock = {
//   getByEmail: jest.fn(),
//   updateByEmail: jest.fn(),
// };

// describe("ThemesController", () => {
//   let controller: ThemesController;

//   beforeEach(async () => {
//     const module: TestingModule = await Test.createTestingModule({
//       controllers: [ThemesController],
//       providers: [{ provide: ThemeService, useValue: themeServiceMock }],
//     }).compile();

//     controller = module.get<ThemesController>(ThemesController);
//   });

//   afterEach(() => jest.clearAllMocks());

//   it("should be defined", () => {
//     expect(controller).toBeDefined();
//   });

//   it("getMyTheme returns theme for valid jwt.email", async () => {
//     const jwt = { email: "alice@example.com" };
//     const fakeTheme = {
//       email: "alice@example.com",
//       themeId: "light",
//       label: "Light",
//     };
//     (themeServiceMock.getByEmail as jest.Mock).mockResolvedValue(fakeTheme);

//     const res = await controller.getMyTheme(jwt);
//     expect(themeServiceMock.getByEmail).toHaveBeenCalledWith(
//       "alice@example.com",
//     );
//     expect(res).toEqual(fakeTheme);
//   });

//   it("getMyTheme throws BadRequestException when jwt has no email", async () => {
//     await expect(controller.getMyTheme({} as any)).rejects.toThrow(
//       BadRequestException,
//     );
//   });

//   it("updateMyTheme delegates to themeService.updateByEmail and returns result", async () => {
//     const jwt = { email: "bob@example.com" };
//     const dto = { themeId: "teal", colorHex: undefined };
//     const svcRes = {
//       ok: true,
//       theme: { themeId: "teal", colorHex: "#2f6f66" },
//     };
//     (themeServiceMock.updateByEmail as jest.Mock).mockResolvedValue(svcRes);

//     const out = await controller.updateMyTheme(jwt, dto as any);
//     expect(themeServiceMock.updateByEmail).toHaveBeenCalledWith(
//       "bob@example.com",
//       { themeId: dto.themeId, colorHex: dto.colorHex },
//     );
//     expect(out).toEqual(svcRes);
//   });

//   it("updateMyTheme throws BadRequestException when jwt has no email", async () => {
//     await expect(
//       controller.updateMyTheme({} as any, { themeId: "x" } as any),
//     ).rejects.toThrow(BadRequestException);
//   });
// });
