import { describe, expect, it, jest } from "@jest/globals";
import type { NextFunction, Request, Response } from "express";
import { noStoreOnAuthRoutes } from "@server/lib/auth/session-cookie";

describe("noStoreOnAuthRoutes", () => {
  function run(path: string) {
    const setHeader = jest.fn();
    const next = jest.fn();
    noStoreOnAuthRoutes(
      { path } as Request,
      { setHeader } as unknown as Response,
      next as unknown as NextFunction,
    );
    expect(next).toHaveBeenCalledTimes(1);
    return setHeader;
  }

  it("marks auth procedures as not cacheable", () => {
    expect(run("/auth.login")).toHaveBeenCalledWith("Cache-Control", "no-store");
  });

  it("leaves other routes alone", () => {
    expect(run("/conversations.list")).not.toHaveBeenCalled();
  });
});
