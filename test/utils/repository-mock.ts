// test/utils/repository-mock.ts
export const repositoryMockFactory = <T = any>(): Partial<
  Record<string, jest.Mock>
> => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  findOneOrFail: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  delete: jest.fn(),
  update: jest.fn(),
  query: jest.fn(),
});
