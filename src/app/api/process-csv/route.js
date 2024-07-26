import { processCSV } from "../../utils/csvProcessor";
import { NextResponse } from "next/server";

export async function POST(request) {
  const { data, email } = await request.json();
  try {
    const processedData = await processCSV(data, email);
    return NextResponse.json(processedData);
  } catch (error) {
    console.error("Error processing CSV:", error);
    return NextResponse.json(
      { error: "Error processing CSV: " + error.message },
      { status: 500 }
    );
  }
}
