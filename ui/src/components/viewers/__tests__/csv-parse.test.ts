import { describe, expect, it } from "vitest";
import { detectDelimiter, parseCsv } from "../csv-parse";

describe("parseCsv (RFC-4180)", () => {
  it("parses a quoted field containing the delimiter (naive split would fail)", () => {
    const input = '"Smith, John",42';
    // Ablation: the previous naive parser did `line.split(",")`, which splits the
    // quoted comma and yields THREE cells instead of two.
    const naive = input.split(",").map((cell) => cell.trim());
    expect(naive).toEqual(['"Smith', 'John"', "42"]); // demonstrably wrong
    // The RFC-4180 parser keeps the quoted field intact.
    expect(parseCsv(input)).toEqual([["Smith, John", "42"]]);
  });

  it("preserves a newline embedded inside a quoted field", () => {
    expect(parseCsv('"line1\nline2",b')).toEqual([["line1\nline2", "b"]]);
  });

  it("unescapes doubled quotes inside a quoted field", () => {
    expect(parseCsv('"a""b",c')).toEqual([['a"b', "c"]]);
  });

  it("returns ragged rows verbatim (fewer and more cells than the header)", () => {
    expect(parseCsv("a,b,c\n1,2\n3,4,5,6")).toEqual([
      ["a", "b", "c"],
      ["1", "2"],
      ["3", "4", "5", "6"],
    ]);
  });

  it("returns an empty array for empty or blank-only input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n")).toEqual([]);
    expect(parseCsv("\r\n\r\n")).toEqual([]);
  });

  it("does not emit a spurious empty row for a trailing newline", () => {
    expect(parseCsv("a,b\n")).toEqual([["a", "b"]]);
    expect(parseCsv("a,b\r\n")).toEqual([["a", "b"]]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps a field that is just an empty quoted string as an empty cell", () => {
    expect(parseCsv('x,"",z')).toEqual([["x", "", "z"]]);
  });

  it("trims unquoted whitespace but preserves whitespace inside quotes", () => {
    expect(parseCsv("a, b ,c")).toEqual([["a", "b", "c"]]);
    expect(parseCsv('"  padded  ",y')).toEqual([["  padded  ", "y"]]);
  });

  it("drops interior blank lines (single empty field) without collapsing empty cells", () => {
    // Blank physical line is dropped; a `,` row of two genuinely-empty cells is kept.
    expect(parseCsv("a\nb\n\nc")).toEqual([["a"], ["b"], ["c"]]);
    expect(parseCsv("x,y\n,\n1,2")).toEqual([
      ["x", "y"],
      ["", ""],
      ["1", "2"],
    ]);
  });

  it("parses tab-separated content and does not split values on their commas", () => {
    expect(parseCsv("name\tcity\nSmith, John\tNYC")).toEqual([
      ["name", "city"],
      ["Smith, John", "NYC"],
    ]);
  });

  it("sniffs the delimiter from the first line and ignores tabs inside quotes", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    // A tab lives inside a quoted header field; the record is still comma-delimited.
    expect(detectDelimiter('"a\tb",c\n1,2')).toBe(",");
    expect(parseCsv('"a\tb",c\n1,2')).toEqual([
      ["a\tb", "c"],
      ["1", "2"],
    ]);
  });
});
