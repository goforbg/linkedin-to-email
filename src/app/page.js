"use client";

import { useState } from "react";
import CSVUploader from "./components/CSVUploader";
import ResultDisplay from "./components/ResultDisplay";

export default function Home() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleProcessedCSV = (processedData) => {
    window.alert("Processing complete, please check email!");
    setResult((prevResult) =>
      prevResult ? [...prevResult, ...processedData] : processedData
    );
    setError(null);
  };

  const handleError = (errorMessage) => {
    setError(errorMessage);
  };

  return (
    <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
      <div className="px-4 py-6 sm:px-0">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">
          Bulk process linkedin URLs to Emails
        </h1>
        <p className="text-sm text-gray-500">
          Make sure your CSV has the field "linkedin" in all small letters.
        </p>

        <CSVUploader onProcessed={handleProcessedCSV} onError={handleError} />
        {error && (
          <div
            className="mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative"
            role="alert"
          >
            <strong className="font-bold">Error: </strong>
            <span className="block sm:inline">{error}</span>
          </div>
        )}
        {/* {result && <ResultDisplay data={result} />} */}
      </div>
    </main>
  );
}
