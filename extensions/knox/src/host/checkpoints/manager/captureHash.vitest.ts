/**
 * T11: leftover SHA-1 `hashContent()` must match blob SHA-256 so skipUnchanged
 * still hits after rebuilding the index from content-only snapshots.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { hashBlobBytes } from "../store/blobStore";
import { hashContent, rebuildSnapshotHashIndex } from "./capture";

describe("capture hashContent SHA-256 (T11)", () => {
  it("hashes the same bytes as the blob store, not SHA-1", () => {
    const content = "export const a = 1;\n";
    const utf8 = Buffer.from(content, "utf8");
    expect(hashContent(content)).toBe(hashBlobBytes(utf8));
    expect(hashContent(content)).toBe(createHash("sha256").update(utf8).digest("hex"));
    expect(hashContent(content)).not.toBe(createHash("sha1").update(content).digest("hex"));
    expect(hashContent(content)).toHaveLength(64);
  });

  it("rebuilds lastSnapshotHashes from content-only snapshots with SHA-256", () => {
    const content = "hello checkpoint\n";
    const host = {
      lastSnapshotHashes: new Map<string, string>([["stale.ts", "deadbeef"]]),
      checkpointHistory: [
        {
          created: new Date("2026-01-01T00:00:00Z"),
          fileSnapshots: [
            {
              relativePath: "a.ts",
              content,
              encoding: "utf8",
              lastModified: new Date("2026-01-01T00:00:00Z"),
              size: content.length,
            },
          ],
        },
      ],
    };
    rebuildSnapshotHashIndex(host as never);
    expect(host.lastSnapshotHashes.get("a.ts")).toBe(hashContent(content));
    expect(host.lastSnapshotHashes.get("a.ts")).toBe(
      hashBlobBytes(Buffer.from(content, "utf8")),
    );
    expect(host.lastSnapshotHashes.has("stale.ts")).toBe(false);
  });
});
