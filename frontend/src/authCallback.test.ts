import { describe, expect, it } from "vitest";
import { readAuthCallback } from "./authCallback";

describe("email callbacks", () => {
  it("recognizes invite and recovery without retaining credentials", () => {
    for (const type of ["invite", "recovery"]) {
      expect(
        readAuthCallback({
          pathname: "/",
          search: "",
          hash: `#type=${type}&access_token=private&refresh_token=private`,
        }),
      ).toEqual({ passwordSetup: true, error: "" });
    }
  });
  it("shows expired links as errors instead of offering a password update", () => {
    const result = readAuthCallback({
      pathname: "/reset-password",
      search: "",
      hash: "#error=access_denied&error_code=otp_expired&error_description=untrusted",
    });
    expect(result.passwordSetup).toBe(false);
    expect(result.error).toContain("already used");
    expect(result.error).not.toContain("untrusted");
  });
  it("supports query errors and normal sign-ins", () => {
    expect(
      readAuthCallback({
        pathname: "/",
        search: "?error=access_denied",
        hash: "",
      }).error,
    ).not.toBe("");
    expect(readAuthCallback({ pathname: "/", search: "", hash: "" })).toEqual({
      passwordSetup: false,
      error: "",
    });
  });
});
