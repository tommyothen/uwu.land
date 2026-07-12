import { describe, expect, it } from "vitest";
import { emailIdentityHash, normalizeEmail } from "../src/identity";

describe("email identity", () => {
	it("trims and lowercases email addresses", () => {
		expect(normalizeEmail("  Foo.Bar@Example.COM  ")).toBe(
			"foo.bar@example.com"
		);
	});

	it("strips plus suffixes for every domain", () => {
		expect(normalizeEmail("person+news@example.com")).toBe(
			"person@example.com"
		);
	});

	it("strips local-part dots only for Gmail domains", () => {
		expect(normalizeEmail("f.o.o@gmail.com")).toBe("foo@gmail.com");
		expect(normalizeEmail("f.o.o@googlemail.com")).toBe(
			"foo@googlemail.com"
		);
		expect(normalizeEmail("f.o.o@example.com")).toBe("f.o.o@example.com");
	});

	it("hashes equivalent Gmail addresses to the same identity", async () => {
		expect(await emailIdentityHash("Foo+bar@GMAIL.com")).toBe(
			await emailIdentityHash("f.o.o@gmail.com")
		);
	});
});
