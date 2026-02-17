import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Personalized Digital Twin Health App",
  description: "Educational lifestyle simulation app"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

