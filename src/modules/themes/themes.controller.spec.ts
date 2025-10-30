// src/themes/themes.controller.spec.ts
import { Test, TestingModule } from "@nestjs/testing";
import { ThemesController } from "./themes.controller"; // <- adjust path if needed
import { ThemeService } from "./themes.service"; // <- adjust path if needed

describe("ThemesController - distributionCounts", () => {
  let controller: ThemesController;
  let mockService: Partial<Record<keyof ThemeService, jest.Mock>>;

  beforeEach(async () => {
    // Create a mock service with only the method we need
    mockService = {
      getDistributionCounts: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ThemesController],
      providers: [
        {
          provide: ThemeService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<ThemesController>(ThemesController);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("returns ok + items + computed counts when service returns canonical items", async () => {
    // Arrange: service returns canonical shape
    const svcItems = [
      { label: "Teal", count: 3, colorHex: "#2F6F66" },
      { label: "Blue", count: 1, colorHex: "#2B65EC" },
      { label: "Teal", count: 2, colorHex: "#2F6F66" }, // duplicate label to test aggregation
    ];
    (mockService.getDistributionCounts as jest.Mock).mockResolvedValue({
      ok: true,
      items: svcItems,
    });

    // Act
    const res = await controller.distributionCounts();

    // Assert
    expect(res).toBeDefined();
    expect(res.ok).toBe(true);
    // canonical items returned unchanged (same array reference shape)
    expect(Array.isArray(res.items)).toBe(true);
    expect(res.items).toHaveLength(3);
    // counts aggregated by label: Teal => 5, Blue => 1
    expect(res.counts).toEqual(expect.objectContaining({ Teal: 5, Blue: 1 }));
  });

  it("returns ok with empty arrays when service returns no items (defensive)", async () => {
    // Arrange: service returns something unexpected (no items property)
    (mockService.getDistributionCounts as jest.Mock).mockResolvedValue({
      ok: true,
      items: undefined,
    });

    // Act
    const res = await controller.distributionCounts();

    // Assert
    expect(res).toBeDefined();
    expect(res.ok).toBe(true);
    // items must be an array (controller normalizes it)
    expect(Array.isArray(res.items)).toBe(true);
    expect(res.items).toHaveLength(0);
    expect(res.counts).toEqual({});
  });

  it("returns ok: false and empty shapes when service throws", async () => {
    // Arrange: service throws
    (mockService.getDistributionCounts as jest.Mock).mockRejectedValue(
      new Error("DB down"),
    );

    // Act
    const res = await controller.distributionCounts();

    // Assert
    expect(res).toEqual({ ok: false, items: [], counts: {} });
  });
});
