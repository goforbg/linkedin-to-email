import "./globals.css";

export const metadata = {
  title: "Linkedin To Email",
  description: "Process CSV files with linkedin URLs to emails"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-100">{children}</body>
    </html>
  );
}
