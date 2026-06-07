import { describe, expect, it } from "bun:test";
import {
  hasGitConflictMarkers,
  parseGitConflictSenv,
  pickConflictBlobWithoutPrivateKey,
} from "../src/core/conflict";

const SAMPLE_CONFLICT = `{
  "version": "1.0",
  "identities": {
<<<<<<< HEAD
    "alice-local": "blob-ours"
=======
    "alice-local": "blob-theirs"
>>>>>>> feature
  }
}`;

const TRAILING_COMMA_CONFLICT = `{
  "version": "1.0",
  "identities": {
<<<<<<< HEAD
    "alice-local": "blob-ours",
=======
    "alice-local": "blob-theirs",
>>>>>>> feature
  }
}`;

describe("conflict parser", () => {
  it("detects git conflict markers", () => {
    expect(hasGitConflictMarkers(SAMPLE_CONFLICT)).toBe(true);
    expect(hasGitConflictMarkers('{"version":"1.0","identities":{}}')).toBe(false);
  });

  it("parses conflicted senv config into ours and theirs", () => {
    const { ours, theirs, theirsLabel } = parseGitConflictSenv(SAMPLE_CONFLICT);
    expect(ours.version).toBe("1.0");
    expect(theirs.version).toBe("1.0");
    expect(theirsLabel).toBe("feature");
    expect(ours.identities["alice-local"]).toBe("blob-ours");
    expect(theirs.identities["alice-local"]).toBe("blob-theirs");
  });

  it("picks incoming blob for other user local identity without private key", () => {
    expect(
      pickConflictBlobWithoutPrivateKey("user-A-local", "blob-ours", "blob-theirs", "user-A")
    ).toBe("blob-theirs");
    expect(
      pickConflictBlobWithoutPrivateKey("user-B-local", "blob-ours", "blob-theirs", "user-A")
    ).toBe("blob-ours");
  });

  it("handles trailing comma on last identity line", () => {
    const { ours, theirs } = parseGitConflictSenv(TRAILING_COMMA_CONFLICT);
    expect(ours.identities["alice-local"]).toBe("blob-ours");
    expect(theirs.identities["alice-local"]).toBe("blob-theirs");
  });

  it("rejects content without conflict markers", () => {
    expect(() => parseGitConflictSenv('{"version":"1.0","identities":{}}')).toThrow(
      "No git conflict markers found in file."
    );
  });
});
