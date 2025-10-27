// jest.config.ts
import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testRegex: "\\.spec\\.ts$",
  moduleFileExtensions: ["ts", "js", "json"],
  transform: {
    "^.+\\.(t|j)s$": "ts-jest",
  },
  // important: map TS path alias "src/*" -> <rootDir>/src/*
  moduleNameMapper: {
    "^src/(.*)$": "<rootDir>/src/$1",
  },
  moduleDirectories: ["node_modules", "<rootDir>"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/main.ts",
    "!src/**/*.module.ts",
  ],
  coverageDirectory: "coverage",
  clearMocks: true,
  testTimeout: 20000,
};

export default config;
