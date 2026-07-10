import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// Mock the DB and session modules that handler.ts depends on. Every test controls
// the mocked query()/getSessionUserId() return values to drive the wrapper paths.
const query = vi.fn();
vi.mock("@/lib/db", () => ({
  getPool: () => ({ query }),
}));

const getSessionUserId = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getSessionUserId: () => getSessionUserId(),
}));

import { parsePagination, withOrg, withAuth, type Ctx } from "@/lib/api/handler";

function makeReq(url: string, headers?: Record<string, string>): NextRequest {
  return new NextRequest(url, { headers });
}

async function bodyOf(res: Response): Promise<{ success: boolean; error: string | null; data: unknown }> {
  return (await res.json()) as { success: boolean; error: string | null; data: unknown };
}

describe("parsePagination", () => {
  it("defaults to page 1, limit 20 when params are missing", () => {
    const p = parsePagination(makeReq("http://localhost/api/x"));
    expect(p.page).toBe(1);
    expect(p.limit).toBe(20);
    expect(p.offset).toBe(0);
  });

  it("parses explicit page=5 limit=50 correctly", () => {
    const p = parsePagination(makeReq("http://localhost/api/x?page=5&limit=50"));
    expect(p.page).toBe(5);
    expect(p.limit).toBe(50);
    expect(p.offset).toBe(200); // (5 - 1) * 50
  });

  it("clamps page=-1 up to 1", () => {
    const p = parsePagination(makeReq("http://localhost/api/x?page=-1"));
    expect(p.page).toBe(1);
    expect(p.offset).toBe(0);
  });

  it("clamps limit=0 up to 1", () => {
    const p = parsePagination(makeReq("http://localhost/api/x?limit=0"));
    // limit=0 fails the >=1 guard → default 20 candidate, then clamped floor 1 keeps 20.
    expect(p.limit).toBe(20);
  });

  it("clamps limit=150 down to 100", () => {
    const p = parsePagination(makeReq("http://localhost/api/x?limit=150"));
    expect(p.limit).toBe(100);
  });

  it("falls back to default limit 20 for NaN limit", () => {
    const p = parsePagination(makeReq("http://localhost/api/x?limit=abc"));
    expect(p.limit).toBe(20);
  });

  it("floors a fractional page 2.9 to 2", () => {
    const p = parsePagination(makeReq("http://localhost/api/x?page=2.9&limit=10"));
    expect(p.page).toBe(2);
    expect(p.offset).toBe(10); // (2 - 1) * 10
  });

  it("computes offset for a range of page/limit combos", () => {
    expect(parsePagination(makeReq("http://localhost/api/x?page=1&limit=25")).offset).toBe(0);
    expect(parsePagination(makeReq("http://localhost/api/x?page=3&limit=25")).offset).toBe(50);
    expect(parsePagination(makeReq("http://localhost/api/x?page=10&limit=100")).offset).toBe(900);
  });
});

describe("withAuth", () => {
  beforeEach(() => {
    query.mockReset();
    getSessionUserId.mockReset();
  });

  it("passes the loaded user to the wrapped handler on a valid session", async () => {
    getSessionUserId.mockResolvedValue("user-1");
    query.mockResolvedValue({ rows: [{ id: "user-1", email: "a@b.com", name: "Ann" }] });

    const inner = vi.fn(
      async (_req: NextRequest, _user: Ctx["user"]) =>
        new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    const handler = withAuth(inner);
    const res = await handler(makeReq("http://localhost/api/x"), {});

    expect(res.status).toBe(200);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(inner.mock.calls[0][1]).toEqual({ id: "user-1", email: "a@b.com", name: "Ann" });
  });

  it("returns 401 when there is no session", async () => {
    getSessionUserId.mockResolvedValue(null);
    const inner = vi.fn();
    const res = await withAuth(inner)(makeReq("http://localhost/api/x"), {});
    expect(res.status).toBe(401);
    expect((await bodyOf(res)).error).toMatch(/Not authenticated/);
    expect(inner).not.toHaveBeenCalled();
  });

  it("returns 401 when the session user no longer exists (loadUser null)", async () => {
    getSessionUserId.mockResolvedValue("ghost");
    query.mockResolvedValue({ rows: [] });
    const inner = vi.fn();
    const res = await withAuth(inner)(makeReq("http://localhost/api/x"), {});
    expect(res.status).toBe(401);
    expect(inner).not.toHaveBeenCalled();
  });
});

describe("withOrg", () => {
  beforeEach(() => {
    query.mockReset();
    getSessionUserId.mockReset();
  });

  it("returns 403 when the user has no org membership", async () => {
    getSessionUserId.mockResolvedValue("user-1");
    // 1st query: loadUser → user found. 2nd query: resolveOrg → no rows.
    query
      .mockResolvedValueOnce({ rows: [{ id: "user-1", email: "a@b.com", name: "Ann" }] })
      .mockResolvedValueOnce({ rows: [] });

    const inner = vi.fn();
    const res = await withOrg(inner)(makeReq("http://localhost/api/x"), {});
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).error).toMatch(/No access/);
    expect(inner).not.toHaveBeenCalled();
  });

  it("returns 403 when x-org-id targets an org the user is not a member of", async () => {
    getSessionUserId.mockResolvedValue("user-1");
    // resolveOrg with the org filter returns no rows for a non-member org.
    query
      .mockResolvedValueOnce({ rows: [{ id: "user-1", email: "a@b.com", name: "Ann" }] })
      .mockResolvedValueOnce({ rows: [] });

    const inner = vi.fn();
    const res = await withOrg(inner)(
      makeReq("http://localhost/api/x", { "x-org-id": "other-org" }),
      {}
    );
    expect(res.status).toBe(403);
    expect(inner).not.toHaveBeenCalled();
  });

  it("returns 500 for an unhandled (non-RbacError) exception like a DB failure", async () => {
    getSessionUserId.mockResolvedValue("user-1");
    query.mockRejectedValueOnce(new Error("connection reset")); // loadUser blows up

    const inner = vi.fn();
    const res = await withOrg(inner)(makeReq("http://localhost/api/x"), {});
    expect(res.status).toBe(500);
    expect((await bodyOf(res)).error).toMatch(/Internal server error/);
    expect(inner).not.toHaveBeenCalled();
  });

  it("maps a thrown RbacError (status 403) through to the response", async () => {
    getSessionUserId.mockResolvedValue("user-1");
    query
      .mockResolvedValueOnce({ rows: [{ id: "user-1", email: "a@b.com", name: "Ann" }] })
      .mockResolvedValueOnce({
        rows: [{ id: "org-1", name: "Org", slug: "org", role: "viewer" }],
      });

    const rbac = Object.assign(new Error("Requires admin role or higher."), {
      status: 403,
      name: "ForbiddenError",
    });
    const inner = vi.fn(async () => {
      throw rbac;
    });
    const res = await withOrg(inner)(makeReq("http://localhost/api/x"), {});
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).error).toMatch(/Requires admin role/);
  });

  it("returns 401 when there is no session (distinct from 403 no-access)", async () => {
    getSessionUserId.mockResolvedValue(null);
    const inner = vi.fn();
    const res = await withOrg(inner)(makeReq("http://localhost/api/x"), {});
    expect(res.status).toBe(401);
    expect(inner).not.toHaveBeenCalled();
  });

  it("resolves user + org + role and calls the wrapped handler on success", async () => {
    getSessionUserId.mockResolvedValue("user-1");
    query
      .mockResolvedValueOnce({ rows: [{ id: "user-1", email: "a@b.com", name: "Ann" }] })
      .mockResolvedValueOnce({
        rows: [{ id: "org-1", name: "Org", slug: "org", role: "owner" }],
      });

    const inner = vi.fn(
      async (_req: NextRequest, _ctx: Ctx) => new Response("ok", { status: 200 })
    );
    const res = await withOrg(inner)(makeReq("http://localhost/api/x"), {});
    expect(res.status).toBe(200);
    expect(inner).toHaveBeenCalledTimes(1);
    const ctx = inner.mock.calls[0][1];
    expect(ctx.user.id).toBe("user-1");
    expect(ctx.org.id).toBe("org-1");
    expect(ctx.role).toBe("owner");
  });
});
