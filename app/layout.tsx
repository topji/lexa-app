import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import SideNav from '@/components/SideNav'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Lexa - Polymarket AI Assistant',
  description: 'Ask AI about Polymarket markets',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="bg-[#0a0a0f]">
      <body className={`${inter.className} bg-[#0a0a0f] text-gray-100 antialiased`}>
        <Providers>
          <SideNav />
          <main className="pl-56 min-h-screen">{children}</main>
        </Providers>
      </body>
    </html>
  )
}

