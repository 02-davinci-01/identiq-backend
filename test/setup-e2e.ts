// test/setup-e2e.ts
// Runs after test environment is set up (per worker).
jest.setTimeout(30_000);

afterEach(() => {
  jest.clearAllMocks();
  jest.resetAllMocks();
});
