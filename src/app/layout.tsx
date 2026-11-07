import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const satoshi = localFont({
  src: [
    {
      path: "../../public/fonts/satoshi/Satoshi-Regular.woff2",
      weight: "400",
      style: "normal"
    },
    {
      path: "../../public/fonts/satoshi/Satoshi-Medium.woff2",
      weight: "500",
      style: "normal"
    },
    {
      path: "../../public/fonts/satoshi/Satoshi-Bold.woff2",
      weight: "700",
      style: "normal"
    }
  ],
  variable: "--font-satoshi",
  display: "swap"
});

export const metadata: Metadata = {
  title: "Virtual Cinema",
  description: "Meet friends, take a seat, talk, and watch movies together in a multiplayer 3D cinema.",
  icons: {
    icon: "/favicon.ico"
  }
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={satoshi.className}>
      <body>{children}</body>
    </html>
  );
}

