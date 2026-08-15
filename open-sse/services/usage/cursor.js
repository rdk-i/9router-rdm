/**
 * Cursor official Plan & Usage quota handler.
 *
 * DashboardService/GetCurrentPeriodUsage is a unary, unframed protobuf RPC over
 * HTTP/2. The request is the empty personal request message.
 */

import http2 from "http2";
import { buildCursorHeaders } from "../../utils/cursorChecksum.js";
import { decodeMessage } from "../../utils/cursorProtobuf.js";
import { parseResetTime } from "./shared.js";

export const CURSOR_USAGE_URL = "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage";
const FETCH_TIMEOUT_MS = 10_000;
const PLAN_USAGE_FIELD = 3;
const BILLING_CYCLE_END_FIELD = 2;
const AUTO_PERCENT_USED_FIELD = 12;
const API_PERCENT_USED_FIELD = 13;

export function encodeCursorUsageRequest() {
  return new Uint8Array();
}

function bytesToText(value) {
  return value == null || typeof value === "number" ? "" : Buffer.from(value).toString("utf8");
}

function decodeScalar(entry) {
  if (!entry) return null;
  if (entry.wireType === 0) return Number(entry.value);
  if (entry.wireType === 5 && entry.value?.length >= 4) return Buffer.from(entry.value).readFloatLE(0);
  if (entry.wireType === 1 && entry.value?.length >= 8) return Buffer.from(entry.value).readDoubleLE(0);
  if (entry.wireType === 2) return bytesToText(entry.value);
  return null;
}

function decodePercent(fields, fieldNumber) {
  const value = decodeScalar(fields.get(fieldNumber)?.[0]);
  const numeric = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(numeric) ? numeric : 0;
}

/** Decode dashboard.v1.GetCurrentPeriodUsageResponse. */
export function decodeCursorCurrentPeriodUsage(payload) {
  const fields = decodeMessage(payload instanceof Uint8Array ? payload : new Uint8Array(payload));
  const planUsageEntry = fields.get(PLAN_USAGE_FIELD)?.[0];
  const planUsage = planUsageEntry?.wireType === 2 && typeof planUsageEntry.value !== "number"
    ? decodeMessage(planUsageEntry.value)
    : new Map();
  const billingCycleEnd = decodeScalar(fields.get(BILLING_CYCLE_END_FIELD)?.[0]);

  return {
    autoPercentUsed: decodePercent(planUsage, AUTO_PERCENT_USED_FIELD),
    apiPercentUsed: decodePercent(planUsage, API_PERCENT_USED_FIELD),
    billingCycleEnd: billingCycleEnd == null ? null : billingCycleEnd,
  };
}

/** Convert Cursor's percent-used fields to the quota shape consumed by Quota Tracker. */
export function normalizeCursorUsage(usage) {
  const resetAt = parseResetTime(usage?.billingCycleEnd);
  const quota = (used) => {
    const boundedUsed = Math.min(100, Math.max(0, Number(used) || 0));
    const remaining = 100 - boundedUsed;
    return {
      used: boundedUsed,
      total: 100,
      remaining,
      remainingPercentage: remaining,
      resetAt,
      unlimited: false,
    };
  };

  return {
    plan: "Cursor",
    quotas: {
      "Cursor Models": quota(usage?.autoPercentUsed),
      "Other Models": quota(usage?.apiPercentUsed),
    },
  };
}

function postCursorProto(url, headers, body, timeoutMs = FETCH_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = http2.connect(`https://${target.host}`);
    const chunks = [];
    let responseHeaders = {};
    let settled = false;
    const finish = (callback) => (...args) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      try { client.close(); } catch {}
      callback(...args);
    };
    const timeoutId = setTimeout(finish(() => reject(new Error("Cursor usage request timed out"))), timeoutMs);
    client.on("error", finish(reject));
    const request = client.request({
      ":method": "POST",
      ":scheme": "https",
      ":authority": target.host,
      ":path": `${target.pathname}${target.search}`,
      ...headers,
    });
    request.on("response", (headers_) => { responseHeaders = headers_; });
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", finish(() => resolve({
      status: Number(responseHeaders[":status"] || 0),
      body: Buffer.concat(chunks),
    })));
    request.on("error", finish(reject));
    request.end(Buffer.from(body));
  });
}

/** Fetch and normalize official Cursor usage without making this endpoint part of chat execution. */
export async function fetchCursorUsage(connection, options = {}) {
  const accessToken = connection?.accessToken;
  const machineId = connection?.providerSpecificData?.machineId;
  if (!accessToken || !machineId) return { message: "Cursor usage requires an access token and machine ID." };

  try {
    const headers = {
      ...buildCursorHeaders(accessToken, machineId, connection.providerSpecificData?.ghostMode !== false),
      accept: "application/proto",
      "content-type": "application/proto",
      "x-cursor-client-version": "3.16.17",
      "x-cursor-client-type": "ide",
      "x-cursor-client-os": process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux",
      "x-cursor-client-arch": process.arch === "arm64" ? "aarch64" : "x86_64",
      "x-cursor-client-device-type": "desktop",
    };
    delete headers["connect-accept-encoding"];
    delete headers["connect-protocol-version"];
    const post = options.post || postCursorProto;
    const response = await post(CURSOR_USAGE_URL, headers, encodeCursorUsageRequest(), options.timeoutMs);
    if (response.status !== 200) return { message: `Cursor usage endpoint returned ${response.status}` };
    return normalizeCursorUsage(decodeCursorCurrentPeriodUsage(response.body));
  } catch (error) {
    return { message: `Cursor connected. Unable to fetch usage: ${error.message}` };
  }
}

export const getCursorUsage = fetchCursorUsage;
