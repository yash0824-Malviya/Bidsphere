import { describe, expect, it } from "vitest";

import { POST_LOGIN_DESTINATION } from "./authRedirect";

describe("authenticated landing route", () => {
  it("always starts an internal session on the dashboard", () => {
    expect(POST_LOGIN_DESTINATION).toBe("/dashboard");
  });
});
