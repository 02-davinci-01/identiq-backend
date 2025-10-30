// test/mocks/repository-mock.ts
export type RepoMock<T = any> = {
  find?: jest.Mock<Promise<T[]>, any[]>;
  findOne?: jest.Mock<Promise<T | undefined>, any[]>;
  findOneBy?: jest.Mock<Promise<T | undefined>, any[]>;
  findByIds?: jest.Mock<Promise<T[]>, any[]>;
  save?: jest.Mock<Promise<T>, any[]>;
  insert?: jest.Mock<Promise<any>, any[]>;
  update?: jest.Mock<Promise<any>, any[]>;
  delete?: jest.Mock<Promise<any>, any[]>;
  create?: jest.Mock<any, any[]>;
  // Add methods you call on your repo
};

export function createRepositoryMock<T = any>(
  overrides: Partial<RepoMock<T>> = {},
): RepoMock<T> {
  const defaultMock: RepoMock<T> = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(undefined),
    findOneBy: jest.fn().mockResolvedValue(undefined),
    findByIds: jest.fn().mockResolvedValue([]),
    save: jest
      .fn()
      .mockImplementation(async (dto) => ({ id: "mock-id", ...dto })),
    insert: jest
      .fn()
      .mockResolvedValue({ identifiers: [{ id: "mock-id" }], raw: null }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    create: jest.fn().mockImplementation((dto) => ({ ...dto })),
  };

  return { ...defaultMock, ...overrides };
}
