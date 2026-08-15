import { describe, expect, it } from "vitest";
import { encodeField } from "../../open-sse/utils/cursorProtobuf.js";
import {
  CURSOR_USAGE_URL,
  decodeCursorCurrentPeriodUsage,
  encodeCursorUsageRequest,
  fetchCursorUsage,
  normalizeCursorUsage,
} from "../../open-sse/services/usage/cursor.js";

const LEN = 2;

function message(...fields) {
  return Uint8Array.from(fields.flatMap((field) => [...field]));
}

function text(field, value) {
  return encodeField(field, LEN, value);
}

function double(field, value) {
  const bytes = Buffer.alloc(8);
  bytes.writeDoubleLE(value, 0);
  return Uint8Array.from([field << 3 | 1, ...bytes]);
}

function varint(field, value) {
  const bytes = [];
  let n = BigInt(value);
  while (n > 127n) {
    bytes.push(Number(n & 127n) | 128);
    n >>= 7n;
  }
  bytes.push(Number(n));
  return Uint8Array.from([field << 3, ...bytes]);
}

describe("Cursor official Plan & Usage protobuf", () => {
  it("encodes the empty personal request", () => {
    expect(encodeCursorUsageRequest()).toEqual(new Uint8Array());
  });

  it("decodes plan usage percentages and billing cycle end", () => {
    const planUsage = message(double(12, 42.5), double(13, 7.25));
    const response = message(varint(2, Date.parse("2026-09-01T00:00:00Z")), text(3, planUsage));

    expect(decodeCursorCurrentPeriodUsage(response)).toEqual({
      autoPercentUsed: 42.5,
      apiPercentUsed: 7.25,
      billingCycleEnd: Date.parse("2026-09-01T00:00:00Z"),
    });
  });

  it("maps official usage into the two dashboard quota rows", () => {
    expect(normalizeCursorUsage({
      autoPercentUsed: 42.5,
      apiPercentUsed: 7.25,
      billingCycleEnd: "2026-09-01T00:00:00Z",
    })).toEqual({
      plan: "Cursor",
      quotas: {
        "Cursor Models": {
          used: 42.5,
          total: 100,
          remaining: 57.5,
          remainingPercentage: 57.5,
          resetAt: "2026-09-01T00:00:00.000Z",
          unlimited: false,
        },
        "Other Models": {
          used: 7.25,
          total: 100,
          remaining: 92.75,
          remainingPercentage: 92.75,
          resetAt: "2026-09-01T00:00:00.000Z",
          unlimited: false,
        },
      },
    });
  });

  it("fetches through an injectable HTTP/2 RPC transport without contacting Cursor in tests", async () => {
    let request;
    const planUsage = message(double(12, 12), double(13, 34));
    const responseBody = message(varint(2, Date.parse("2026-10-01T00:00:00Z")), text(3, planUsage));
    const result = await fetchCursorUsage({
      accessToken: "test-token",
      providerSpecificData: { machineId: "test-machine" },
    }, {
      post: async (...args) => {
        request = args;
        return { status: 200, body: responseBody };
      },
    });

    expect(request[0]).toBe(CURSOR_USAGE_URL);
    expect(request[2]).toEqual(new Uint8Array());
    expect(request[1]).toMatchObject({
      accept: "application/proto",
      "content-type": "application/proto",
      "x-cursor-client-version": "3.16.17",
      "x-cursor-client-type": "ide",
      "x-cursor-client-device-type": "desktop",
    });
    expect(result.quotas["Cursor Models"].used).toBe(12);
    expect(result.quotas["Other Models"].remainingPercentage).toBe(66);
  });
});
