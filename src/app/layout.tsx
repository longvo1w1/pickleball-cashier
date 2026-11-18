import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Court Desk · Thu ngân Pickleball",
  description: "Quản lý thu ngân, kho và Social sân Pickleball",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
