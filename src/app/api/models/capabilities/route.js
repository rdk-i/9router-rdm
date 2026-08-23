import { NextResponse } from "next/server";
import {
  getModelCapabilityOverrides,
  setModelCapabilityOverrides,
  deleteModelCapabilityOverrides,
} from "@/models";
import { normalizeCapabilityOverrides } from "open-sse/providers/modelCapabilities.js";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ overrides: await getModelCapabilityOverrides() });
}

export async function PUT(request) {
  try {
    const { providerAlias, id, overrides } = await request.json();
    if (!providerAlias || !id) {
      return NextResponse.json({ error: "providerAlias and id required" }, { status: 400 });
    }
    const normalized = normalizeCapabilityOverrides(overrides);
    if (Object.keys(normalized).length === 0 || Object.values(normalized).every((value) => value === null)) {
      await deleteModelCapabilityOverrides(providerAlias, id);
    } else {
      await setModelCapabilityOverrides(providerAlias, id, normalized);
    }
    return NextResponse.json({ success: true, overrides: normalized });
  } catch (error) {
    console.log("Error updating model capabilities:", error);
    return NextResponse.json({ error: "Failed to update model capabilities" }, { status: 500 });
  }
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const providerAlias = searchParams.get("providerAlias");
  const id = searchParams.get("id");
  if (!providerAlias || !id) {
    return NextResponse.json({ error: "providerAlias and id required" }, { status: 400 });
  }
  await deleteModelCapabilityOverrides(providerAlias, id);
  return NextResponse.json({ success: true });
}