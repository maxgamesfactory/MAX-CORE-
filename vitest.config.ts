import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8', reporter: ['text', 'json-summary', 'html'],
      include: ['state/**/*.ts', 'events/**/*.ts', 'simulation/**/*.ts', 'runtime/**/*.ts', 'storage/**/*.ts', 'intelligence/**/*.ts', 'adapters/**/*.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80,
        'state/**': { lines: 95, functions: 95, branches: 95, statements: 95 },
        'events/**': { lines: 95, functions: 95, branches: 95, statements: 95 },
        'simulation/**': { lines: 95, functions: 95, branches: 95, statements: 95 },
        'runtime/**': { lines: 95, functions: 95, branches: 95, statements: 95 },
        'storage/**': { lines: 95, functions: 95, branches: 95, statements: 95 }
      }
    }
  }
});
