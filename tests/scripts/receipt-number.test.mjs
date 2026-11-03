import assert from "node:assert/strict";
import test from "node:test";
import { SalesValidationError } from "../../packages/sales/src/domain/errors.ts";
import {
  formatReceiptReference,
  nextReceiptSequence,
  parseReceiptClaim,
  parseReceiptReference,
  readStoredReceiptIdentity,
} from "../../packages/sales/src/domain/receipt-number.ts";

const REGISTRATION_ID = "11111111-1111-4111-8111-111111111111";
const DEVICE_ID = "22222222-2222-4222-8222-222222222222";

test("formats a till prefix and sequence without truncating growth", () => {
  assert.equal(formatReceiptReference("1", "1"), "BRV-001-000001");
  assert.equal(formatReceiptReference("12", "123456"), "BRV-012-123456");
  assert.equal(formatReceiptReference("1000", "1"), "BRV-1000-000001");
  assert.equal(formatReceiptReference("1", "1000000"), "BRV-001-1000000");
  const beyondSafeInteger = "9007199254740993";
  assert.equal(Number.isSafeInteger(Number(beyondSafeInteger)), false);
  assert.equal(formatReceiptReference("1", beyondSafeInteger), `BRV-001-${beyondSafeInteger}`);
  assert.equal(nextReceiptSequence(beyondSafeInteger), "9007199254740994");
  assert.equal(formatReceiptReference("1", nextReceiptSequence(beyondSafeInteger)), "BRV-001-9007199254740994");
});

test("parses only canonical receipt references", () => {
  assert.deepEqual(parseReceiptReference("BRV-001-000001"), { prefix: "1", sequence: "1" });
  assert.deepEqual(parseReceiptReference("BRV-1000-1000000"), { prefix: "1000", sequence: "1000000" });
  for (const rejected of [
    "BRV-000-000001",
    "BRV-001-000000",
    "BRV-01-000001",
    "BRV-001-00001",
    "POS-000001",
    "BRV-001-000001-extra",
    "brv-001-000001",
    "",
  ]) {
    assert.equal(parseReceiptReference(rejected), null, rejected);
  }
});

test("rejects non-decimal receipt parts", () => {
  for (const [prefix, sequence] of [
    ["0", "1"],
    ["01", "1"],
    ["1", "0"],
    ["1", "01"],
    ["", "1"],
    ["1", ""],
    ["1.5", "1"],
  ]) {
    assert.throws(() => formatReceiptReference(prefix, sequence), SalesValidationError);
  }
  assert.throws(() => nextReceiptSequence("0"), SalesValidationError);
});

test("validates an optional receipt claim without treating it as a financial fact", () => {
  assert.deepEqual(parseReceiptClaim(undefined), { kind: "absent" });
  const claim = {
    registrationId: REGISTRATION_ID,
    deviceId: DEVICE_ID,
    prefix: "1",
    sequence: "1",
    reference: "BRV-001-000001",
  };
  assert.deepEqual(parseReceiptClaim(claim), { kind: "valid", claim });
  assert.deepEqual(parseReceiptClaim({ ...claim, reference: "BRV-001-000002" }), {
    kind: "malformed",
    claimedReference: "BRV-001-000002",
  });
  assert.deepEqual(parseReceiptClaim({ reference: "not-a-number" }), {
    kind: "malformed",
    claimedReference: "not-a-number",
  });
  assert.deepEqual(parseReceiptClaim(null), { kind: "malformed", claimedReference: null });
  assert.deepEqual(parseReceiptClaim({ ...claim, prefix: "001" }), {
    kind: "malformed",
    claimedReference: "BRV-001-000001",
  });
  assert.equal(parseReceiptClaim({ reference: "x".repeat(81) }).kind, "malformed");
  assert.equal(parseReceiptClaim({ reference: "x".repeat(81) }).claimedReference, null);
  assert.deepEqual(parseReceiptClaim({
    ...claim,
    registrationId: REGISTRATION_ID.toUpperCase(),
    deviceId: DEVICE_ID.toUpperCase(),
  }), { kind: "valid", claim });
  const longSequence = "9".repeat(80);
  const longReference = formatReceiptReference("1", longSequence);
  assert.equal(longReference.length > 80, true);
  assert.deepEqual(parseReceiptClaim({ ...claim, sequence: longSequence, reference: longReference }), {
    kind: "valid",
    claim: { ...claim, sequence: longSequence, reference: longReference },
  });
});

test("keeps a long canonical conflict reference and still drops oversized arbitrary text", () => {
  const longReference = formatReceiptReference("1", "9".repeat(80));
  assert.deepEqual(readStoredReceiptIdentity({ status: "conflict", reference: longReference }), {
    status: "conflict",
    reference: longReference,
    registrationId: null,
    deviceId: null,
    prefix: null,
    sequence: null,
  });
  assert.equal(readStoredReceiptIdentity({ status: "conflict", reference: "x".repeat(81) }).reference, null);
  assert.equal(readStoredReceiptIdentity({ status: "conflict", reference: "bad\nref" }).reference, null);
  assert.deepEqual(readStoredReceiptIdentity({
    status: "assigned",
    registrationId: REGISTRATION_ID.toUpperCase(),
    deviceId: DEVICE_ID.toUpperCase(),
    prefix: "1",
    sequence: "1",
    reference: "BRV-001-000001",
    numberingConflict: true,
  }), {
    status: "assigned",
    registrationId: REGISTRATION_ID,
    deviceId: DEVICE_ID,
    prefix: "1",
    sequence: "1",
    reference: "BRV-001-000001",
    numberingConflict: true,
  });
});
