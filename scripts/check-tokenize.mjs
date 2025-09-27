import { tokenize } from "../pages/api/putters.js";

const cases = [
  {
    input: "Phantom X 7",
    expectContains: ["x7"],
    expectNotContains: [],
  },
  {
    input: "Odyssey #7",
    expectContains: [],
    expectNotContains: ["x7"],
  },
];

let failures = 0;

for (const test of cases) {
  const tokens = tokenize(test.input);
  for (const mustHave of test.expectContains) {
    if (!tokens.includes(mustHave)) {
      console.error(`Expected tokenize("${test.input}") to include "${mustHave}". Tokens:`, tokens);
      failures += 1;
    }
  }
  for (const mustNotHave of test.expectNotContains) {
    if (tokens.includes(mustNotHave)) {
      console.error(
        `Expected tokenize("${test.input}") to omit "${mustNotHave}". Tokens:`,
        tokens,
      );
      failures += 1;
    }
  }
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log("All tokenize regression checks passed.");
}
