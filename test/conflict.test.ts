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

  it("parses two conflict blocks in one file and merges them", () => {
    const TWO_BLOCKS = `{
  "version": "1.0",
  "identities": {
<<<<<<< HEAD
    "alice-local": "blob-ours-1",
=======
    "alice-local": "blob-theirs-1",
>>>>>>> feature
    "bob-local": "blob-ours-2",
  }
}
<<<<<<< HEAD
    "bob-local": "blob-ours-2b"
=======
    "bob-local": "blob-theirs-2b"
>>>>>>> feature
`;
    const { ours, theirs, theirsLabel } = parseGitConflictSenv(TWO_BLOCKS);
    expect(theirsLabel).toBe("feature");
    expect(ours.identities["alice-local"]).toBe("blob-ours-1");
    expect(theirs.identities["alice-local"]).toBe("blob-theirs-1");
    expect(ours.identities["bob-local"]).toBe("blob-ours-2b");
    expect(theirs.identities["bob-local"]).toBe("blob-theirs-2b");
  });

  it("parses conflict block with no trailing newline at end of file", () => {
    const NO_TRAILING = `{
  "version": "1.0",
  "identities": {
<<<<<<< HEAD
    "alice-local": "blob-ours"
=======
    "alice-local": "blob-theirs"
>>>>>>> feature
  }
}`;
    const { ours, theirs } = parseGitConflictSenv(NO_TRAILING);
    expect(ours.identities["alice-local"]).toBe("blob-ours");
    expect(theirs.identities["alice-local"]).toBe("blob-theirs");
  });

  it("pickConflictBlobWithoutPrivateKey returns ours when idName has no -local suffix", () => {
    expect(
      pickConflictBlobWithoutPrivateKey("team-shared", "blob-ours", "blob-theirs", "user-A")
    ).toBe("blob-ours");
  });

  it("rejects conflict markers that cannot be parsed", () => {
    const malformed = `{
  "version": "1.0",
  "identities": {
<<<<<<< HEAD
    "alice-local": "blob-ours"
  }
}`;
    expect(() => parseGitConflictSenv(malformed)).toThrow(
      "Failed to parse git conflict markers."
    );
  });

  it("pickConflictBlobWithoutPrivateKey returns ours when theirsLabel is missing", () => {
    expect(
      pickConflictBlobWithoutPrivateKey("user-A-local", "blob-ours", "blob-theirs")
    ).toBe("blob-ours");
  });

  it("rejects conflict block with unsupported version", () => {
    const badVersion = `{
  "version": "99.0",
  "identities": {
<<<<<<< HEAD
    "alice-local": "blob-ours"
=======
    "alice-local": "blob-theirs"
>>>>>>> feature
  }
}`;
    expect(() => parseGitConflictSenv(badVersion)).toThrow(
      /Unsupported \.senv\.json version/
    );
  });

  it("handles conflict block with empty label on >>>>>>>", () => {
    const noLabel = `{
  "version": "1.0",
  "identities": {
<<<<<<< HEAD
    "alice-local": "blob-ours"
=======
    "alice-local": "blob-theirs"
>>>>>>>
  }
}`;
    const { ours, theirs, theirsLabel } = parseGitConflictSenv(noLabel);
    expect(ours.identities["alice-local"]).toBe("blob-ours");
    expect(theirs.identities["alice-local"]).toBe("blob-theirs");
    expect(theirsLabel).toBe("");
  });
});
