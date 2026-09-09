export const metadata = { title: "Shohoj Porashuna API", description: "Backend service for Shohoj Porashuna" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
